# M2 viewer probes

Manual validation steps for the public viewer. Run before declaring an M2-touching PR shippable. Each probe takes a few minutes; the matrix takes ~30 minutes total on first run.

## Probe matrix

| # | Probe | Validates | Pass criterion |
|---|---|---|---|
| 1 | 1s-tick end-to-end timing | Pixel write → visible-on-screen lag | Pixel writes appear in viewer within ≤2s for 60+ consecutive writes |
| 2 | iOS Safari mobile | Touch pan/pinch, mobile rendering | One-finger pan, two-finger pinch, double-tap; no janky scroll |
| 3 | Android Chrome mobile | Same as #2 on Android | Same |
| 4 | Desktop browsers | Chrome + Safari + Firefox parity | Pan/zoom/keys all work; canvas renders crisp |
| 5 | CDN ETag round-trip | `If-None-Match` returns 304 in production | `curl -I -H 'If-None-Match: "<v>"'` returns 304 with empty body |
| 6 | Cold-start TTFB | Origin response on cache miss | `/manifest` p95 < 100ms under realistic viewer load |
| 7 | Vercel Firewall rate-limit | Edge rule actually fires | Burst of 700 req/min from one IP gets rate-limited at edge |
| 8 | Empty-canvas first paint | Cold sector renders default_color | Fresh sector shows uniform palette-0 background, no errors |

## Probe 1 — 1s-tick end-to-end timing

```bash
# Setup: get a bot key (one-time)
export BOTPLACE_PAT='bp_pat_…'
export BOTPLACE_URL='https://botplace.app'
RESP=$(pnpm -s bot:create probe-bot)
KEY=$(echo "$RESP" | jq -r .api_key.plaintext)

# Write one pixel per second for 60s, varying coords + colors
for i in $(seq 0 59); do
  X=$((i % 100))
  Y=$((i / 100))
  COLOR=$((i % 8))
  TS=$(date -u +%s.%N)
  curl -fsS -X POST "$BOTPLACE_URL/api/v1/pixels" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"sector_id\":\"sector-1\",\"x\":$X,\"y\":$Y,\"color\":$COLOR}" \
    > /dev/null
  echo "T=$TS wrote ($X,$Y) color=$COLOR"
  sleep 1
done
```

In a desktop browser tab: open <https://botplace.app/>, watch the canvas. In a phone tab (separate device), open the same URL.

**Pass:** every pixel appears in both tabs within ≤2s of the corresponding `T=` line. Eyeball it; if you see a pixel arrive 5+ seconds late, log the offending iteration and check origin response time + CDN headers in DevTools Network tab.

If pixels are visibly late and the origin response time is fine, drop manifest `s-maxage` to 0 and retest. If origin is slow, escalate per IM-3 (Edge runtime + Neon serverless driver).

## Probes 2 + 3 — Mobile touch

On a real iPhone (Safari) and a real Android (Chrome):

1. Open <https://botplace.app/>.
2. Pan with one finger — canvas should follow.
3. Pinch zoom — canvas should scale around the pinch midpoint, not jump.
4. Double-tap somewhere — canvas should zoom in 2× anchored on the tap.
5. Lock phone, wait 30s, unlock — viewer should resume polling, no stuck state.

**Pass:** no jank, no double-firing, no scroll-the-page bleed-through. If pinch feels broken, check `touch-action: none` is applied (DevTools → Computed Styles on the wrapper div).

Mobile parity is an M2 merge bar. Do not declare done with broken mobile.

## Probe 4 — Desktop browsers

In Chrome, Safari, and Firefox (latest each):

1. Open <https://botplace.app/>.
2. Mouse-drag pans.
3. Wheel-scroll zooms anchored on cursor.
4. `+` / `-` zoom; `0` resets to fit.
5. Arrow keys pan.

**Pass:** each gesture works in every browser. `image-rendering: pixelated` keeps pixels crisp at high zoom. No infinite re-render loops in the React DevTools profiler.

## Probe 5 — CDN ETag round-trip

```bash
# Find a chunk with a non-zero version
MANIFEST=$(curl -fsS https://botplace.app/api/v1/public/sectors/sector-1/manifest)
ENTRY=$(echo "$MANIFEST" | jq -r '.[0]')
CX=$(echo "$ENTRY" | jq -r .chunk_x)
CY=$(echo "$ENTRY" | jq -r .chunk_y)
V=$(echo "$ENTRY" | jq -r .version)

# First fetch — expect 200 with body
curl -I "https://botplace.app/api/v1/public/sectors/sector-1/chunks/$CX/$CY"

# Second fetch with matching If-None-Match — expect 304, empty body
curl -i -H "If-None-Match: \"$V\"" \
  "https://botplace.app/api/v1/public/sectors/sector-1/chunks/$CX/$CY" \
  | head -20
```

**Pass:** the second curl returns `HTTP/2 304` and zero body bytes after the headers. If Vercel is rewriting the ETag (rare but possible), the second fetch returns 200 — fall back to `?v=<version>` cache-busted URLs (Risk R5).

## Probe 6 — Cold-start TTFB

```bash
# Hit the manifest 10 times serially after a >5min idle, capturing TTFB
for i in $(seq 1 10); do
  curl -o /dev/null -s -w "%{time_starttransfer}\n" \
    "https://botplace.app/api/v1/public/sectors/sector-1/manifest?probe=$i"
done
```

**Pass:** p95 TTFB < 100ms. The `?probe=$i` query param busts the CDN cache so each request hits origin.

If origin is consistently slow (>100ms p95), escalate per IM-3 — switch to Edge runtime + Neon serverless HTTP driver as a follow-up.

## Probe 7 — Vercel Firewall rate-limit

Configure the rate-limit rule per [admin/v1.md § Public endpoint Firewall rules](../../admin/v1.md). Then:

```bash
# Burst 700 req in 60s from one IP (run from a single machine)
for i in $(seq 1 700); do
  curl -o /dev/null -s -w "%{http_code}\n" \
    "https://botplace.app/api/v1/public/sectors/sector-1/manifest?probe=$i" &
done
wait | sort | uniq -c
```

**Pass:** at least some requests come back as 429 (or whatever Vercel Firewall returns for blocks — typically 403 or a custom status). Check the Vercel dashboard's Firewall analytics to confirm rules fired.

## Probe 8 — Empty-canvas first paint

```bash
# Create a fresh empty sector via Prisma directly (one-off; no API yet)
pnpm -s prisma:studio  # then add a Sector row with id="sector-empty-probe"
```

Open <https://botplace.app/sectors/sector-empty-probe> (you'll need to temporarily allow the id past the M2-only sector-1 guard in `app/sectors/[id]/page.tsx`).

**Pass:** the page renders a uniform palette-0 (black) background, no errors in console, manifest returns `[]`, no chunk fetches happen (verify via Network tab).

Clean up: delete the probe sector after.
