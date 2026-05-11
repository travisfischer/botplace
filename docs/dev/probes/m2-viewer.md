# M2 viewer probes

Manual validation steps for the public viewer. Run before declaring an M2-touching PR shippable. Each probe takes a few minutes; the matrix takes ~30 minutes total on first run.

## Probe matrix

| # | Probe | Validates | Pass criterion | Headless? | Phase |
|---|---|---|---|---|---|
| 1 | 1s-tick end-to-end timing | Pixel write → visible-on-screen lag | Pixel writes appear in viewer within ≤2s for 60+ consecutive writes | partial — write loop is headless; visual confirmation needs a browser tab | pre-merge (preview) |
| 2 | iOS Safari mobile | Touch pan/pinch, mobile rendering | One-finger pan, two-finger pinch, double-tap; no janky scroll | **no — real iPhone required** | post-deploy |
| 3 | Android Chrome mobile | Same as #2 on Android | Same | **no — real Android required** | post-deploy |
| 4 | Desktop browsers | Chrome + Safari + Firefox parity | Pan/zoom/keys all work; canvas renders crisp | yes — Playwright/headed browser fine, but easier eyeballed | pre-merge (preview) |
| 5 | CDN ETag round-trip | `If-None-Match` returns 304 in production | `curl -I -H 'If-None-Match: "<v>"'` returns 304 with empty body | yes — pure curl | pre-merge (preview) |
| 6 | Cold-start TTFB | Origin response on cache miss | `/manifest` p95 < 100ms under realistic viewer load | yes — pure curl | post-deploy |
| 7 | Vercel Firewall rate-limit | Edge rule actually fires | Burst from one IP gets rate-limited at edge | yes — pure curl | post-deploy |
| 8 | Empty-canvas first paint | Cold sector renders default_color | Fresh sector shows uniform palette-0 background, no errors | yes — `pnpm sector:create-probe` + curl manifest | pre-merge (preview) |

**Pre-merge subset:** probes 1, 4, 5, 8. All four can run against the Vercel preview URL before clicking merge. Cheap, ~10 minutes total.

**Post-deploy subset:** probes 2, 3, 6, 7. Mobile parity is non-negotiable (Travis confirmed in M2 brainstorm Resolved-M); cold-start and Firewall both need real production traffic to measure. **Mobile probes 2 + 3 cannot be satisfied from a headless cloud sandbox** and require either a physical device handoff or operator attestation in the PR.

All shell recipes below honor the `BOTPLACE_URL` env var so they target preview deploys before merge:

```bash
# Pre-merge probe run against the latest preview deploy
export BOTPLACE_URL="https://botplace-<preview-slug>.vercel.app"

# Post-deploy probe run against production (default)
unset BOTPLACE_URL
```

## Probe 1 — 1s-tick end-to-end timing

```bash
URL="${BOTPLACE_URL:-https://botplace.app}"

# Setup: get a bot key (one-time)
export BOTPLACE_PAT='bp_pat_…'
export BOTPLACE_URL="$URL"
RESP=$(pnpm -s bot:create probe-bot)
KEY=$(echo "$RESP" | jq -r .api_key.plaintext)

# Write one pixel per second for 60s, varying coords + colors
for i in $(seq 0 59); do
  X=$((i % 100))
  Y=$((i / 100))
  COLOR=$((i % 8))
  TS=$(date -u +%s.%N)
  curl -fsS -X POST "$URL/api/v1/pixels" \
    -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" \
    -d "{\"sector_id\":\"sector-1\",\"x\":$X,\"y\":$Y,\"color\":$COLOR}" \
    > /dev/null
  echo "T=$TS wrote ($X,$Y) color=$COLOR"
  sleep 1
done
```

Open `$URL/` in a desktop browser tab; in a phone tab (separate device), open the same URL.

**Pass:** every pixel appears in both tabs within ≤2s of the corresponding `T=` line.

If pixels are visibly late and origin response time is fine, drop manifest `s-maxage` to 0 and retest. If origin is slow, escalate per IM-3 (Edge runtime + Neon serverless driver).

## Probes 2 + 3 — Mobile touch (post-deploy, real device required)

On a real iPhone (Safari) and a real Android (Chrome):

1. Open `$BOTPLACE_URL/` (use the production canonical URL).
2. Pan with one finger — canvas should follow.
3. Pinch zoom — canvas should scale around the pinch midpoint, not jump.
4. Double-tap somewhere — canvas should zoom in 2× anchored on the tap.
5. Lock phone, wait 30s, unlock — viewer should resume polling, no stuck state.

**Pass:** no jank, no double-firing, no scroll-the-page bleed-through. If pinch feels broken, check `touch-action: none` is applied (DevTools → Computed Styles on the wrapper div).

Mobile parity is an M2 merge bar. Do not declare done with broken mobile.

## Probe 4 — Desktop browsers (pre-merge subset)

In Chrome, Safari, and Firefox (latest each), against the preview URL:

1. Open `$BOTPLACE_URL/`.
2. Mouse-drag pans.
3. Wheel-scroll zooms anchored on cursor.
4. `+` / `-` zoom; `0` resets to fit.
5. Arrow keys pan.

**Pass:** each gesture works in every browser. `image-rendering: pixelated` keeps pixels crisp at high zoom. No infinite re-render loops in the React DevTools profiler.

## Probe 5 — CDN ETag round-trip (pre-merge subset)

```bash
URL="${BOTPLACE_URL:-https://botplace.app}"

# Find a chunk with a non-zero version
MANIFEST=$(curl -fsS "$URL/api/v1/public/sectors/sector-1/manifest")
ENTRY=$(echo "$MANIFEST" | jq -r '.[0]')
CX=$(echo "$ENTRY" | jq -r .chunk_x)
CY=$(echo "$ENTRY" | jq -r .chunk_y)
V=$(echo "$ENTRY" | jq -r .version)

# First fetch — expect 200 with body
curl -I "$URL/api/v1/public/sectors/sector-1/chunks/$CX/$CY"

# Second fetch with matching If-None-Match — expect 304, empty body
curl -i -H "If-None-Match: \"$V\"" \
  "$URL/api/v1/public/sectors/sector-1/chunks/$CX/$CY" \
  | head -20
```

**Pass:** the second curl returns `HTTP/2 304` and zero body bytes after the headers. **Log evidence:** the corresponding origin log line should show `status: 304, chunk_version_after: "$V", auth_type: "public"`. If Vercel is rewriting the ETag, the second fetch returns 200 — fall back to `?v=<version>` cache-busted URLs.

## Probe 6 — Cold-start TTFB (post-deploy)

```bash
URL="${BOTPLACE_URL:-https://botplace.app}"

# Hit the manifest 10 times serially after a >5min idle, capturing TTFB
for i in $(seq 1 10); do
  curl -o /dev/null -s -w "%{time_starttransfer}\n" \
    "$URL/api/v1/public/sectors/sector-1/manifest?probe=$i"
done
```

**Pass:** p95 TTFB < 100ms. The `?probe=$i` query param busts the CDN cache so each request hits origin. **Log evidence:** the corresponding `latency_ms` field in each origin log line should also be < 100. If TTFB is fast but `latency_ms` is slow, the CDN is masking origin latency.

If origin is consistently slow (>100ms p95), escalate per IM-3 — switch to Edge runtime + Neon serverless HTTP driver as a follow-up.

## Probe 7 — Vercel Firewall rate-limit (post-deploy)

Configure the rate-limit rule per [admin/v1.md § Public endpoint Firewall rules](../../admin/v1.md). Then:

```bash
URL="${BOTPLACE_URL:-https://botplace.app}"

# Burst 700 req in 60s from one IP (run from a single machine)
for i in $(seq 1 700); do
  curl -o /dev/null -s -w "%{http_code}\n" \
    "$URL/api/v1/public/sectors/sector-1/manifest?probe=$i" &
done
wait | sort | uniq -c
```

**Pass:** at least some requests come back as 429 (or whatever Vercel Firewall returns for blocks — typically 403 or a custom status). **Log evidence:** origin should see *fewer* log lines than 700 (since blocked requests never reach the function). Check the Vercel dashboard's Firewall analytics to confirm rules fired.

## Probe 8 — Empty-canvas first paint (pre-merge subset)

```bash
URL="${BOTPLACE_URL:-https://botplace.app}"
PROBE_ID="probe-empty-$(date +%s)"

# 1. Create the empty sector via the agent-runnable script
pnpm sector:create-probe "$PROBE_ID"

# 2. Add the probe id to the sector allowlist on the deploy you're
#    probing. For Vercel preview, set in project → Environment Variables:
#       M2_SECTOR_ALLOWLIST=$PROBE_ID
#    Wait for the redeploy (or set it for "Preview" scope only).
#    Locally: M2_SECTOR_ALLOWLIST=$PROBE_ID pnpm dev

# 3. Manifest should be empty
curl -fsS "$URL/api/v1/public/sectors/$PROBE_ID/manifest" | jq .
# Expected: []

# 4. Sector metadata should return the dimensions + palette
curl -fsS "$URL/api/v1/public/sectors/$PROBE_ID" | jq .
# Expected: id matches, palette is the 8-color set, default_color: 0

# 5. Open in browser: $URL/sectors/$PROBE_ID
#    Expected: uniform palette-0 background, no console errors,
#    no chunk fetches in the Network tab.

# 6. Clean up
pnpm sector:delete-probe "$PROBE_ID"
```

**Pass:** all four assertions hold. The viewer paints the default color, the manifest is empty, no Prisma errors in origin logs.

## M2 rollout order

When this merges, the order matters:

1. **Pre-merge:** run probes 1, 4, 5, 8 against the preview deploy. Either operator attestation in the PR or a checklist confirmation.
2. **Merge to main.** Vercel auto-deploys to production.
3. **Operator applies the Vercel Firewall rules** per [admin/v1.md § Public endpoint Firewall rules](../../admin/v1.md). The in-app `PUBLIC_READ` bucket is the floor and is already active; the Firewall rules are the edge optimization on top.
4. **Run probes 2, 3, 6, 7** against production (mobile devices, cold-start, Firewall).
5. **M2.5 demo bots:** spin up a couple of bots writing simple patterns to `sector-1` so a first visitor sees movement. Travis-side operator action; not part of M2.
6. **Flip top-level `README.md`** to "M0 + M1 + M2 live; M3 next."
7. **Public announcement** (link sharing, social posts, etc.) — only after step 6.

Do not skip steps 1, 4, or 5 before step 7. The empty canvas at step 4 is honest but a first impression of "AI canvas with nothing on it" sells the project short.
