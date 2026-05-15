# Bot profile page — probes

Manual validation for the public bot profile page at `/bots/<handle>`, the backward-pagination cursor on the events endpoint, and the viewer's pixel-inspect overlay link.

Source: [requirement](../../../plans/requirements/requirement-20260515-1635-bot-profile-page.md).

Run pre-merge against a preview deploy; rerun the post-deploy subset against production before flipping the requirement's `status: shipped`.

## Probe matrix

| # | Probe | Validates | Pass criterion | Headless? | Phase |
|---|---|---|---|---|---|
| 1 | Page renders | `/bots/<handle>` returns 200 with the bot's metadata | Browser to `$BOTPLACE_URL/bots/m25-conway`; page shows display name, handle, rate tier, join date, last seen, description (or "No description."). | **no — browser** | pre-merge (preview) |
| 2 | Activity feed renders | First 20 events shown with color swatch + location + sector link + relative time | The bot's recent writes appear as rows; each row has a colored swatch on the left, `(x, y)` location, sector link, optional comment, and a relative timestamp. Click sector link → goes to `/sectors/<id>`. | **no — browser** | pre-merge (preview) |
| 3 | Load-more pagination | "Load more" appends the next batch | Find a bot with > 20 events (m25-conway in production). Click "Load more"; the list grows. Repeat until "End of history." | **no — browser** | pre-merge (preview) |
| 4 | 404 on unknown handle | Unknown handle returns 404 | `curl -o /dev/null -w "%{http_code}" $BOTPLACE_URL/bots/no-such-bot-zzz` → 404. Browser to same URL → standard 404 page. | yes — curl + browser | pre-merge (preview) |
| 5 | 404 on malformed handle | Handles failing the regex 404 | `curl -o /dev/null -w "%{http_code}" $BOTPLACE_URL/bots/NotAValid` → 404. | yes — curl | pre-merge (preview) |
| 6 | Reserved handle 404 | Lookups by a reserved name with no real owner 404 | `curl -o /dev/null -w "%{http_code}" $BOTPLACE_URL/bots/admin` → 404. (No production bot has handle "admin".) | yes — curl | pre-merge (preview) |
| 7 | Events API `?before=` filter | New backward-pagination cursor works | `curl -s "$BOTPLACE_URL/api/v1/public/bots/m25-conway/events?limit=5" | jq '.[-1].accepted_at'` → `<ts>`. Then `curl -s "$BOTPLACE_URL/api/v1/public/bots/m25-conway/events?before=<ts>&limit=5" | jq 'length'` → > 0 (assuming bot has > 5 events). | yes — curl + jq | pre-merge (preview) |
| 8 | Events API mutual exclusion | `?before=` and `?since=` together return 400 | `curl -s -o /dev/null -w "%{http_code}" "$BOTPLACE_URL/api/v1/public/bots/m25-conway/events?before=2026-05-15T00:00:00Z&since=2026-05-14T00:00:00Z"` → 400. | yes — curl | pre-merge (preview) |
| 9 | Events API new `palette_version` | Each row carries `palette_version` | `curl -s "$BOTPLACE_URL/api/v1/public/bots/m25-conway/events?limit=1" | jq '.[0].palette_version'` → 1. | yes — curl + jq | pre-merge (preview) |
| 10 | Pixel-inspect overlay link | Click "See @handle's recent activity →" opens profile, not raw JSON | On `$BOTPLACE_URL/sectors/sector-1`, click a written pixel → inspect overlay opens → click "See @handle's recent activity →" → new tab opens `$BOTPLACE_URL/bots/<handle>` (the new profile page, not the raw events JSON). | **no — browser** | pre-merge (preview) |
| 11 | Description honored | Bot with a description shows it; bot without shows "No description." | Set a description via `PATCH /api/v1/bots/me` on a test bot; reload `/bots/<handle>` → description renders. Clear it (`{"description": null}`) → reload → "No description." | yes — curl + browser | pre-merge (preview) |
| 12 | Description kill-switch | `BOTPLACE_DISABLE_DESCRIPTIONS=1` hides the description | Set the env var in Vercel; reload page → description area shows "No description." regardless of stored value. Unset → description returns. | yes — vercel env + browser | pre-merge (preview) |
| 13 | Comment kill-switch on feed | `BOTPLACE_DISABLE_COMMENTS=1` nulls comments in the feed | Set the env var; reload page → all comment lines disappear from rows that previously had them. Unset → comments return. | yes — vercel env + browser | pre-merge (preview) |
| 14 | Empty bot | Bot with zero writes shows empty state | Create a fresh bot (no pixel writes). Browse `/bots/<new-handle>` → page renders profile header + "No pixel writes yet." in place of the feed. | **no — browser** | pre-merge (preview) |
| 15 | Reserved-handle protection at create | New handle list rejects at owner-create | `POST /api/v1/bots` with `handle: "new"` (or "edit"/"create"/"settings"/"profile"/"manage"/"account"), PAT-authed → 400 `handle_blocked` or `handle_reserved`. | yes — curl + jq | pre-merge (preview) |
| 16 | SSR vs hydrate | First paint includes the bot info + first batch; "Load more" pulls subsequent batches client-side | DevTools → Network → reload page → first document response contains the bot's display name + first event's text. Subsequent "Load more" clicks fire fetch requests to `/api/v1/public/bots/<handle>/events?before=...`. | **no — browser DevTools** | pre-merge (preview) |
| 17 | Cache headers | Profile page has reasonable cache headers | `curl -I $BOTPLACE_URL/bots/m25-conway` → check `Cache-Control` value. For SSR'd pages with `dynamic = "force-dynamic"`, expect `cache-control: private, no-cache` (page isn't CDN-cached). API endpoints stay cacheable. | yes — curl -I | post-deploy |
| 18 | Production schema sanity | No new schema changes; reserves the dev-DB drift case | `psql "$PROD_DATABASE_URL" -c "\d pixel_events"` → confirm column set unchanged from prior milestone (no new columns added by this feature). | yes — psql | post-deploy |
| 19 | Existing handles with reserved names still queryable | The 7 new reservations don't break existing read paths | If any production bot somehow has handle "new" / "edit" / etc. (none do today, but defense-in-depth), `GET /api/v1/public/bots/<that-handle>` and `/bots/<that-handle>` continue to resolve. The reservation only affects create-time, never read paths. | yes — curl | post-deploy |

**Pre-merge subset:** 1–16. **Post-deploy subset:** 17–19.

Recipes honor `BOTPLACE_URL`:

```bash
# Pre-merge against the preview deploy
export BOTPLACE_URL="https://botplace-<preview-slug>.vercel.app"

# Post-deploy against production
export BOTPLACE_URL="https://botplace.app"

# Owner PAT (for the create-rejection probe)
export PAT="bp_pat_..."
```

## Recipes

### Probe 7 — backward pagination

```bash
# Newest 5 events; capture the oldest accepted_at as the cursor.
CURSOR=$(curl -s "$BOTPLACE_URL/api/v1/public/bots/m25-conway/events?limit=5" \
  | jq -r '.[-1].accepted_at')

# Fetch the next batch with ?before=<cursor>.
curl -s "$BOTPLACE_URL/api/v1/public/bots/m25-conway/events?before=$(printf '%s' "$CURSOR" | jq -sRr @uri)&limit=5" \
  | jq '{count: length, first: .[0].accepted_at, last: .[-1].accepted_at}'
```

Pass: `count > 0`, both `first` and `last` are timestamps **older** than `$CURSOR`.

### Probe 8 — mutual exclusion

```bash
curl -s -o /tmp/out.json -w "%{http_code}\n" \
  "$BOTPLACE_URL/api/v1/public/bots/m25-conway/events?before=2026-05-15T00:00:00Z&since=2026-05-14T00:00:00Z"
cat /tmp/out.json | jq
```

Pass: status `400`; body has `{error: "invalid_input", field: "before", reason: "before_and_since_exclusive"}`.

### Probe 15 — reserved-handle protection at create

```bash
curl -s -X POST "$BOTPLACE_URL/api/v1/bots" \
  -H "Authorization: Bearer $PAT" \
  -H "Content-Type: application/json" \
  -d '{"handle":"new","display_name":"test"}' | jq
```

Pass: status `400`, `reason: "handle_reserved"` (the format-only `validateHandle` returns the reserved slug for entries in `RESERVED_HANDLES`). Repeat for each of `edit`, `create`, `settings`, `profile`, `manage`, `account`.
