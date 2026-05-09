# Concurrency probe

Confirms the pixel-write transaction serializes writes to the same chunk under concurrent load. The contract: every write is atomic, and version numbers advance monotonically with no gaps and no duplicates.

## Why this matters

`writePixel` uses `SELECT … FOR UPDATE` on the chunk row to serialize concurrent writes. If two requests racing for the same chunk both saw `version = N` and both wrote `version = N+1`, the canvas would be inconsistent and the event log would have ambiguous replay semantics.

## Manual probe

Hit the same chunk with N concurrent writes (different bot keys, so per-bot rate limits don't fire) and assert the resulting `version` equals N and there are no duplicate `chunk_version_after` values in the event log.

```bash
SECTOR=sector-1
N=20
BASE=http://localhost:3000   # or your preview deploy URL

# 20 different bot keys (mint via UI or pnpm bot:mint-key); paste their plaintexts:
KEYS=( bp_live_aaa bp_live_bbb … )

# Fire them all at the same chunk in parallel.
for K in "${KEYS[@]}"; do
  ( curl -fsS -X POST "$BASE/api/v1/pixels" \
      -H "Authorization: Bearer $K" \
      -H "Content-Type: application/json" \
      -d "{\"sector_id\":\"$SECTOR\",\"x\":50,\"y\":50,\"color\":1}" \
      >/dev/null ) &
done
wait

# Inspect the chunk + events.
psql "$DATABASE_URL" <<SQL
SELECT version FROM sector_chunks
WHERE sector_id = '$SECTOR' AND chunk_x = 0 AND chunk_y = 0;

SELECT chunk_version_after, COUNT(*)
FROM pixel_events
WHERE sector_id = '$SECTOR'
GROUP BY chunk_version_after
HAVING COUNT(*) > 1;   -- expect 0 rows
SQL
```

## Expected outcome

- `sector_chunks.version` equals exactly `N` (one bump per write, no gaps and no overshoot).
- The "duplicates" query returns zero rows — every event has a unique `chunk_version_after`.

## What a failure means

- **Version below N** → some writes returned 200 but didn't actually advance the row. Look for an exception path in `writePixel` that swallows a tx rollback.
- **Version above N** → impossible under correct row-locking; suggests the FOR UPDATE was bypassed. Inspect the `$queryRaw` SELECT in `src/pixels/index.ts`.
- **Duplicate `chunk_version_after`** → the chunk lock didn't serialize. Two requests both saw `version = M` and both wrote `M + 1`. This is the worst case and means the canvas is now inconsistent with the event log.

## Notes

Per-bot rate limit (1 token / 60s) means you need N distinct bot keys to fire N concurrent writes — same key gets 429'd after the first. If you'd rather test with one key, swap `bp_live_*` for the per-IP probe by sending from N different X-Forwarded-For values to a non-prod deploy that respects them.
