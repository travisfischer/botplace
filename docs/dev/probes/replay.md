# Replay probe

Confirms the `PixelEvent` append-only log can reconstruct `SectorChunk.data` byte-for-byte. This is the M2 hand-off contract — if replay fails, the canvas's audit story is broken.

## Automated path

```bash
pnpm test:api:replay
```

The test (`tests/api/replay.test.ts`) seeds a disposable sector, writes ~12 pixels (with same-pixel overwrites across two chunks), replays `PixelEvent` rows in `(sector_id, id) ASC` order, reconstructs chunks in memory, and byte-compares against live `SectorChunk.data`. Skips itself if `DATABASE_URL` is unset.

## Manual path (against an arbitrary sector)

Use this against prod after a deploy that touches the pixel-write transaction, or as a forensic tool against an existing sector you suspect of drift.

```bash
SECTOR=sector-1
DATABASE_URL='postgresql://…' \
psql "$DATABASE_URL" <<SQL
SELECT chunk_x, chunk_y, version, encode(substring(data, 1, 8), 'hex') AS first_bytes
FROM sector_chunks
WHERE sector_id = '$SECTOR'
ORDER BY chunk_x, chunk_y;
SQL
```

Then dump the events for the same sector and reconstruct in any language:

```bash
psql "$DATABASE_URL" -c "\\COPY (SELECT id, x, y, color FROM pixel_events WHERE sector_id = '$SECTOR' ORDER BY id ASC) TO STDOUT WITH CSV HEADER" > events.csv
```

A 50-line script in any language can walk `events.csv`, mutate a per-chunk byte buffer at offset `(y % 100) * 100 + (x % 100)`, and compare against `first_bytes` for the matching `(chunk_x, chunk_y)` row.

## Expected outcome

Byte-for-byte equality between the live chunk blob and the replayed buffer for every chunk row.

## What a failure means

- **Replay drift on a single chunk** → the pixel-write transaction wrote a byte without emitting an event (or vice versa). Look for a missing `prisma.$transaction` boundary in `src/pixels/index.ts`.
- **Replay drift across all chunks of a sector** → the chunk row's `data` blob is corrupted upstream of the write path, or the schema's `Bytes` column type changed semantics.
- **Different chunk count** → events reference chunks that no longer exist (a `Cascade` was introduced by mistake, or a manual SQL run dropped rows).
