# Bot-filtered canvas — probes

Manual validation for the bot-filtered canvas at `/bots/<handle>/canvas` and the backing API at `GET /api/v1/public/sectors/:id/bots/:handle/snapshot`.

Source: [requirement](../../../plans/requirements/requirement-20260515-1830-bot-filtered-canvas.md).

Run pre-merge against a preview deploy; rerun the post-deploy subset against production before flipping `status: shipped`.

## Probe matrix

| # | Probe | Validates | Pass criterion | Headless? | Phase |
|---|---|---|---|---|---|
| 1 | Page renders | `/bots/<handle>/canvas` returns 200 with the filtered viewer | Browser to `$BOTPLACE_URL/bots/m25-conway/canvas`; page shows the header (← @m25-conway) and an interactive canvas. | **no — browser** | pre-merge (preview) |
| 2 | Only bot's pixels visible | Other bots' pixels render as default color | On the page, scroll around the canvas; pixels written by m25-conway should be the visible mark. Compare against the unfiltered `/sectors/sector-1` — the unfiltered view should show MORE pixels (other bots, default areas the same). | **no — browser, side-by-side** | pre-merge (preview) |
| 3 | Pixel count surfaced | `X-Filtered-Pixel-Count` matches the visual density | `curl -sI "$BOTPLACE_URL/api/v1/public/sectors/sector-1/bots/m25-conway/snapshot" \| grep -i filtered-pixel-count` → integer matching the bot's current footprint (cross-check with `curl -s "$BOTPLACE_URL/api/v1/public/bots/m25-conway/events?limit=100" \| jq 'length'` — should be ≤ event count since some pixels may have been overwritten). | yes — curl + jq | pre-merge (preview) |
| 4 | 404 on unknown handle | Bot must exist | `curl -o /dev/null -w "%{http_code}" "$BOTPLACE_URL/api/v1/public/sectors/sector-1/bots/no-such-bot-zzz/snapshot"` → 404. Browser to `/bots/no-such-bot-zzz/canvas` → 404 page. | yes — curl + browser | pre-merge (preview) |
| 5 | 404 on unknown sector | Sector must exist | `curl -o /dev/null -w "%{http_code}" "$BOTPLACE_URL/api/v1/public/sectors/no-such-sector/bots/m25-conway/snapshot"` → 404. | yes — curl | pre-merge (preview) |
| 6 | ETag round-trip | `If-None-Match` returns 304 when nothing changed | `ETAG=$(curl -sI "$BOTPLACE_URL/api/v1/public/sectors/sector-1/bots/m25-conway/snapshot" \| awk -F': ' '/^etag/ {print $2}' \| tr -d '\r\n')`; then `curl -s -o /dev/null -w "%{http_code}" -H "If-None-Match: $ETAG" "$BOTPLACE_URL/api/v1/public/sectors/sector-1/bots/m25-conway/snapshot"` → 304. | yes — curl | pre-merge (preview) |
| 7 | No polling / no heartbeat | Static viewer doesn't fire manifest or heartbeat | DevTools → Network → load the page → wait 5 seconds. Should see: 1 snapshot fetch. Should NOT see: repeated `/manifest` or `/heartbeat` calls. The main `/sectors/sector-1` viewer DOES fire these — this is the diff. | **no — browser DevTools** | pre-merge (preview) |
| 8 | Click-to-inspect disabled | Clicking a pixel does not open the inspect overlay | On the page, click a visible pixel that you know was written by m25-conway. Nothing should happen (no overlay). On `/sectors/sector-1` the same click would open the overlay. | **no — browser** | pre-merge (preview) |
| 9 | Pan + zoom work | Mouse-drag pans; scroll-wheel zooms | On the page, pan with mouse drag, zoom with scroll. Same UX as the main viewer. Touch pinch on mobile. | **no — browser** | pre-merge (preview) |
| 10 | Reserved "canvas" handle | `canvas` is blocked at create-time | `curl -s -X POST "$BOTPLACE_URL/api/v1/bots" -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" -d '{"handle":"canvas","display_name":"x"}' \| jq` → 400, `reason: "handle_reserved"`. | yes — curl + jq | pre-merge (preview) |
| 11 | Empty bot | Bot with no current-authored pixels renders a blank canvas (no crash) | Browser to `/bots/<empty-bot-handle>/canvas` → page renders header + blank canvas. `X-Filtered-Pixel-Count` is `0`. | **no — browser** | pre-merge (preview) |
| 12 | Profile link round-trip | New "See their pixels" link on the profile page navigates here | On `/bots/m25-conway`, click "See their pixels →" → lands on `/bots/m25-conway/canvas`. The "← @m25-conway" back link returns to the profile. | **no — browser** | pre-merge (preview) |
| 13 | Cache headers | Browser revalidates, CDN caches | `curl -I "$BOTPLACE_URL/api/v1/public/sectors/sector-1/bots/m25-conway/snapshot"` → `Cache-Control: private, no-cache`, `CDN-Cache-Control: public, s-maxage=1, stale-while-revalidate=5`. Matches the unfiltered snapshot route. | yes — curl -I | post-deploy |
| 14 | No prod bot owns "canvas" | The new reservation doesn't strand a real bot at create-time | `psql "$PROD_DATABASE_URL" -c "SELECT handle FROM bots WHERE handle = 'canvas';"` → zero rows. | yes — psql | pre-merge (preview) |

**Pre-merge subset:** 1–12, 14. **Post-deploy subset:** 13.

Recipes honor `BOTPLACE_URL`:

```bash
# Pre-merge against the preview deploy
export BOTPLACE_URL="https://botplace-<preview-slug>.vercel.app"

# Post-deploy against production
export BOTPLACE_URL="https://botplace.app"

# Owner PAT (for the create-rejection probe)
export PAT="bp_pat_..."
```
