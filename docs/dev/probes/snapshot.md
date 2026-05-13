# Snapshot endpoint probes

Manual validation steps for `GET /api/v1/public/sectors/:id/snapshot` and the viewer's first-paint preload path. Run before declaring a snapshot-touching PR shippable, and again post-deploy to confirm the speedup actually lands in production.

The snapshot endpoint replaces N sequential per-chunk fetches with one binary response. For a fully painted 1000×1000 sector that's ~100 round trips collapsed into one. The promise is "canvas paints from a single fetch on initial load"; these probes confirm it.

## Probe matrix

| # | Probe | Validates | Pass criterion | Headless? | Phase |
|---|---|---|---|---|---|
| 1 | Endpoint smoke test | Wire format + headers | 200 with `BPSS` magic, `Content-Type: application/octet-stream`, ETag `"snap-<N>"`, `X-Snapshot-Chunk-Count` matches manifest length | yes — pure curl + xxd | pre-merge (preview) |
| 2 | Empty sector | Header-only response | Cold sector returns exactly 16 bytes; ETag `"snap-0"`; viewer paints uniform default_color | yes — `pnpm sector:create-probe` + curl | pre-merge (preview) |
| 3 | ETag 304 round-trip | CDN can serve 304s | `curl -H 'If-None-Match: "snap-<N>"'` returns 304 with empty body | yes — pure curl | pre-merge (preview) |
| 4 | First-paint network shape | Viewer uses snapshot, not per-chunk | DevTools Network tab shows 1 snapshot request, then manifest polls, **no per-chunk fetches** on initial load | **no — real browser DevTools required** | pre-merge (preview) |
| 5 | CDN edge cache | `s-maxage=1` is honored at edge | Two back-to-back requests show `x-vercel-cache: MISS` then `HIT` | yes — pure curl | post-deploy |
| 6 | Write-to-paint freshness | Snapshot+poll-loop catches recent writes | Pixel written T+0s appears in a fresh-loaded viewer within ≤2s | partial — write loop headless; visual confirmation needs a tab | post-deploy |

**Pre-merge subset:** 1, 2, 3, 4. **Post-deploy subset:** 5, 6.

All recipes honor `BOTPLACE_URL`:

```bash
# Pre-merge against the preview deploy
export BOTPLACE_URL="https://botplace-<preview-slug>.vercel.app"

# Post-deploy against production
unset BOTPLACE_URL
```

## Probe 1 — Endpoint smoke test

```bash
URL="${BOTPLACE_URL:-https://botplace.app}"

# Headers + first 32 bytes of the body
curl -isS "$URL/api/v1/public/sectors/sector-1/snapshot" \
  --output - \
  | head -c 4096 \
  | tee /tmp/snapshot.head

# Magic check: bytes 0..3 must spell "BPSS" (0x42 0x50 0x53 0x53)
curl -fsS "$URL/api/v1/public/sectors/sector-1/snapshot" \
  --output /tmp/snapshot.bin
xxd -l 16 /tmp/snapshot.bin
# Expected first row: 4250 5353 0100 0000 6400 0000 NN00 0000
#                     B P S S  ver=1, reserved, chunk_size=100, chunk_count=N

# Sanity: chunk_count matches the manifest entry count
MANIFEST_LEN=$(curl -fsS "$URL/api/v1/public/sectors/sector-1/manifest" | jq length)
HEADER_CHUNK_COUNT=$(curl -fsSI "$URL/api/v1/public/sectors/sector-1/snapshot" \
  | awk -F': ' 'tolower($1)=="x-snapshot-chunk-count"{print $2}' | tr -d '\r')
echo "manifest=$MANIFEST_LEN snapshot=$HEADER_CHUNK_COUNT"
```

**Pass:** `Content-Type: application/octet-stream`, ETag `"snap-<integer>"`, `X-Snapshot-Chunk-Count` matches `MANIFEST_LEN`, magic decodes to `BPSS`. If chunk_size in the header isn't 100 (`6400 0000`), the format is talking to a sector with a different chunk size or the codec has drifted from `src/pixels/index.ts`.

## Probe 2 — Empty sector

```bash
URL="${BOTPLACE_URL:-https://botplace.app}"
PROBE_ID="probe-snapshot-empty-$(date +%s)"

pnpm sector:create-probe "$PROBE_ID"
# Then add $PROBE_ID to M2_SECTOR_ALLOWLIST in the target deploy's env
# and wait for the redeploy (or set locally for `pnpm dev`).

# Snapshot of an empty sector — exactly 16 bytes
curl -fsSI "$URL/api/v1/public/sectors/$PROBE_ID/snapshot"
# Expected: ETag: "snap-0", X-Snapshot-Chunk-Count: 0, Content-Length: 16

curl -fsS "$URL/api/v1/public/sectors/$PROBE_ID/snapshot" --output /tmp/empty.bin
wc -c < /tmp/empty.bin  # 16
xxd /tmp/empty.bin
# Expected: 4250 5353 0100 0000 6400 0000 0000 0000

# Then open $URL/sectors/$PROBE_ID in a browser. Viewer should paint
# uniform palette-0 background within milliseconds. Network tab shows
# one snapshot request (16 bytes), then the periodic manifest polls.
# No chunk fetches at all.

pnpm sector:delete-probe "$PROBE_ID"
```

**Pass:** snapshot body is exactly 16 bytes, ETag `"snap-0"`, viewer paints instantly with no per-chunk fetches, no console errors.

## Probe 3 — ETag 304 round-trip

```bash
URL="${BOTPLACE_URL:-https://botplace.app}"

# Capture the current ETag
ETAG=$(curl -fsSI "$URL/api/v1/public/sectors/sector-1/snapshot" \
  | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
echo "etag=$ETAG"

# Second fetch with matching If-None-Match — expect 304, zero body
curl -i -H "If-None-Match: $ETAG" \
  "$URL/api/v1/public/sectors/sector-1/snapshot" \
  | head -20
```

**Pass:** second curl returns `HTTP/2 304` with zero body bytes after the headers. The ETag in the 304 response matches the request's `If-None-Match`. **Log evidence:** origin log line should show `status: 304, auth_type: "public", path: ".../snapshot"`. If a 200 comes back instead, Vercel is rewriting the ETag — same fallback as the chunk endpoint applies (investigate, escalate).

## Probe 4 — First-paint network shape

**This is the headline probe.** It confirms the actual user-facing improvement.

In Chrome (or Firefox) DevTools, against the preview URL:

1. Open DevTools → Network tab. Check "Disable cache". Filter on `sector-1` or the relevant sector slug.
2. Navigate to `$BOTPLACE_URL/sectors/sector-1` (or your probe sector).
3. Observe the network waterfall during the first ~2 seconds.

**Pass:**
- Exactly **one** request to `/api/v1/public/sectors/<id>/snapshot` near the top of the waterfall, returning a single binary blob.
- The canvas paints fully and visibly **before** any `/chunks/<x>/<y>` request fires.
- Subsequent requests are the manifest poll (`/manifest`) every ~1s, with `x-vercel-cache` showing edge hits in steady state.
- **Zero** per-chunk requests (`/chunks/<x>/<y>`) on initial load, assuming the snapshot fetch succeeded.

**Fail signals:**
- Sequential per-chunk fetches dominate the waterfall (snapshot fetch failed or didn't fire — check console for `snapshot preload failed`).
- Snapshot fetch returned non-200 (check status code, look at the response body for the JSON error).
- Canvas paints in horizontal bands as chunks trickle in (the old behavior — snapshot path isn't being taken).

Take a screenshot of the network panel for the PR description. The contrast against the pre-snapshot waterfall is the artifact worth showing.

## Probe 5 — CDN edge cache (post-deploy)

```bash
URL="${BOTPLACE_URL:-https://botplace.app}"

# Two back-to-back requests. First may be MISS, second should be HIT
# (or REVALIDATED) because of s-maxage=1.
for i in 1 2 3; do
  curl -sSI "$URL/api/v1/public/sectors/sector-1/snapshot" \
    | awk -F': ' 'tolower($1) ~ /^(x-vercel-cache|age|etag)$/ {print}'
  echo "---"
  sleep 0.2
done
```

**Pass:** at least one of the responses shows `x-vercel-cache: HIT`. If all three show `MISS`, the CDN isn't caching the snapshot — verify `CDN-Cache-Control: public, s-maxage=1, stale-while-revalidate=5` is on the response. **Log evidence:** origin log lines for these three requests should be fewer than 3 (cache hits never reach the function).

## Probe 6 — Write-to-paint freshness (post-deploy)

The snapshot endpoint is CDN-cached for `s-maxage=1, swr=5`, so a fresh-loaded viewer may receive a snapshot up to ~6 seconds stale. The polling loop catches the gap. This probe confirms the gap actually closes.

```bash
URL="${BOTPLACE_URL:-https://botplace.app}"
# Setup: get a bot key (one-time)
export BOTPLACE_PAT='bp_pat_…'
export BOTPLACE_URL="$URL"
RESP=$(pnpm -s bot:create probe-snapshot-bot)
KEY=$(echo "$RESP" | jq -r .api_key.plaintext)

# Write one pixel
TS=$(date -u +%s.%N)
curl -fsS -X POST "$URL/api/v1/pixels" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"sector_id":"sector-1","x":50,"y":50,"color":3}'
echo "wrote at T=$TS"
```

Immediately (within ~1s of the write) open `$URL/sectors/sector-1` in a fresh browser tab. Note the wall clock when the new pixel becomes visible.

**Pass:** the pixel appears within ≤2s of `T=`. If the snapshot was stale, the manifest poll within the first second will detect the version bump and fetch the updated chunk individually. If the pixel doesn't appear within ≤2s, the polling-after-preload handoff is broken (snapshot seeded a stale version but the diff loop isn't picking it up).

## Notes

- The snapshot endpoint is **agent-native by default** per the project principles — viewers (humans) and operators (coding agents) hit the same URL. There is no separate "give me the canvas" RPC.
- Snapshot is a read optimization, not a correctness contract. If snapshot fetch fails for any reason (network, format mismatch, abort), the viewer falls through to the existing manifest+per-chunk polling path. Worst case is "slow first paint", not "broken canvas".
- For sectors larger than 1000×1000 (M3+), on-demand snapshot generation against Postgres on every CDN miss may become too expensive. The natural next step is generating snapshots to Vercel Blob on writes (or via cron) and serving the static URL. Not needed for M2.
