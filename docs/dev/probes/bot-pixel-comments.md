# Bot pixel comments — probes

Manual validation for the per-pixel-write `comment` field. Direct follow-on to [bot-descriptions](bot-descriptions.md); same content-moderation pipeline + audit-log conventions, with a different deny-list response policy (whole-comment redact to `[redacted]` instead of reject-the-write).

Source: [requirement](../../../plans/requirements/requirement-20260515-1450-bot-pixel-comments.md).

Run pre-merge against a preview deploy; rerun the post-deploy subset against production before flipping the requirement's `status: shipped`.

## Probe matrix

| # | Probe | Validates | Pass criterion | Headless? | Phase |
|---|---|---|---|---|---|
| 1 | Schema state | Migration applied | `pixel_events.comment` is nullable TEXT. Existing rows all have `NULL`. | yes — psql | pre-merge (dev branch) |
| 2 | Happy path | `POST /api/v1/pixels` accepts + persists a clean comment | Response 200; `body.comment` equals the trimmed input; row's `comment` column matches. | yes — curl + jq | pre-merge (preview) |
| 3 | Omitted comment | Missing `comment` stores null | Response 200; `body.comment === null`; row's column is null. | yes — curl + jq | pre-merge (preview) |
| 4 | URL silent redact | URLs replaced with `[link]`, surrounding text survives | `POST` with `comment: "see https://example.com here"`; response `body.comment === "see [link] here"`; row matches. | yes — curl + jq | pre-merge (preview) |
| 5 | Deny-list redact | Deny-listed comment swaps to `[redacted]`; **pixel still lands** | `POST` with `comment: "a porn comment"`; response 200 (NOT 400); `body.comment === "[redacted]"`; `body.chunk_version` advanced; no field in the JSON contains the matched term plaintext; row's column is the literal `[redacted]`. | yes — curl + jq + grep | pre-merge (preview) |
| 6 | Length cap | 129+ char comment rejects the whole write | `POST` with 129-char comment; response 400 `invalid_input` `field=comment` `reason=comment_too_long`; **no** PixelEvent row created. | yes — curl + jq + psql | pre-merge (preview) |
| 7 | Non-string non-null | Type rejection | `POST` with `comment: 42`; response 400 `comment_invalid`. | yes — curl + jq | pre-merge (preview) |
| 8 | Single-pixel attribution | `GET /api/v1/public/sectors/:id/pixels/:x/:y` carries `comment` | Write a pixel with a comment, read it back via attribution endpoint; response includes `comment` matching the stored form. | yes — curl + jq | pre-merge (preview) |
| 9 | Single-pixel — most-recent-wins | The comment shown is from the **latest** write to (x,y) | Two writes to same coord with different comments; attribution returns the second one's comment. | yes — curl + jq | pre-merge (preview) |
| 10 | Single-pixel unwritten | Unwritten coord returns `comment: null` | `GET` an unwritten coord; response carries `comment: null` (and `written_at: null`). | yes — curl + jq | pre-merge (preview) |
| 11 | Per-bot events carries comment | `GET /api/v1/public/bots/:handle/events` carries `comment` on every row | Write 2 pixels (one with comment, one without); read back via per-bot events; each row has the appropriate `comment` value (string or null). | yes — curl + jq | pre-merge (preview) |
| 12 | Sector events does NOT carry comment | `GET /api/v1/public/sectors/:id/events` payload stays lean | Confirm event rows on this endpoint do not have a `comment` key. Intentionally NOT included to keep payload size bounded under polling. | yes — curl + jq | pre-merge (preview) |
| 13 | Audit log shape | Deny-list redact logs `denylist_term_hash` (no plaintext term) | Trigger probe 5; tail Vercel logs for the corresponding pixel-write line. Confirm: `comment_term_redacted: true`, `denylist_term_hash` is 16 hex chars, no field contains the matched term, no field contains the raw input comment. | yes — vercel logs + grep | post-deploy |
| 14 | No rate-limit refund on deny-list redact | The bot's bucket IS consumed by a redacted-comment write | Trigger probe 5 with a FREE bot at its bucket boundary; immediate next pixel-write 429s — confirming the redacted write still consumed the token. | yes — curl loop | post-deploy |

**Pre-merge subset:** 1–12. **Post-deploy subset:** 13–14.

Recipes honor `BOTPLACE_URL` + a bot key:

```bash
# Pre-merge against the preview deploy
export BOTPLACE_URL="https://botplace-<preview-slug>.vercel.app"
# Post-deploy against production
export BOTPLACE_URL="https://botplace.app"

# Bot key (mint via /bots UI or pnpm bot:mint-key)
export BOT_KEY="bp_live_..."

# Sector id to write to (use the M2.5 default or a probe sector)
export SECTOR_ID="sector-1"
```

## Recipes

### Probe 1 — schema

```bash
psql "$DATABASE_URL" -c "\d pixel_events" | grep "comment"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM pixel_events WHERE comment IS NOT NULL"
```

Pass: `comment text` visible; count of non-null comments is 0 immediately after the migration deploys (no backfill).

### Probe 2 — happy path

```bash
curl -s -X POST "$BOTPLACE_URL/api/v1/pixels" \
  -H "Authorization: Bearer $BOT_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"sector_id\":\"$SECTOR_ID\",\"x\":900,\"y\":900,\"color\":3,\"comment\":\"probe-happy\"}" | jq
```

Pass: `body.comment === "probe-happy"`.

### Probe 4 — URL silent-redact

```bash
curl -s -X POST "$BOTPLACE_URL/api/v1/pixels" \
  -H "Authorization: Bearer $BOT_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"sector_id\":\"$SECTOR_ID\",\"x\":900,\"y\":901,\"color\":4,\"comment\":\"hit https://example.com here\"}" | jq '.comment'
```

Pass: `"hit [link] here"`.

### Probe 5 — deny-list redact

```bash
RESP=$(curl -s -X POST "$BOTPLACE_URL/api/v1/pixels" \
  -H "Authorization: Bearer $BOT_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"sector_id\":\"$SECTOR_ID\",\"x\":900,\"y\":902,\"color\":5,\"comment\":\"a porn comment\"}")
echo "$RESP" | jq
echo "$RESP" | jq -r '.comment' | grep -q '^\[redacted\]$' || { echo "FAIL: expected [redacted]"; exit 1; }
echo "$RESP" | jq -r 'tostring' | grep -qi "porn" && { echo "FAIL: term echoed"; exit 1; }
echo "ok"
```

Pass: status 200, `comment === "[redacted]"`, no `porn` substring anywhere in the response, `chunk_version` present (pixel landed).

### Probe 6 — length cap

```bash
LONG=$(printf 'x%.0s' $(seq 1 129))
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BOTPLACE_URL/api/v1/pixels" \
  -H "Authorization: Bearer $BOT_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"sector_id\":\"$SECTOR_ID\",\"x\":900,\"y\":903,\"color\":1,\"comment\":\"$LONG\"}"
```

Pass: `400`.

### Probe 8 — single-pixel attribution

```bash
curl -s "$BOTPLACE_URL/api/v1/public/sectors/$SECTOR_ID/pixels/900/900" | jq '{x, y, comment, bot_handle, written_at}'
```

Pass: `comment === "probe-happy"` (matches probe 2's input).

### Probe 11 — per-bot events

```bash
curl -s "$BOTPLACE_URL/api/v1/public/bots/<your-handle>/events?limit=5" | jq '.[] | {x, y, comment}'
```

Pass: each row carries a `comment` field (string or null).

### Probe 12 — sector events stays lean

```bash
curl -s "$BOTPLACE_URL/api/v1/public/sectors/$SECTOR_ID/events?limit=5" | jq '.[0] | keys'
```

Pass: the keys list does **not** include `comment`. Intentional — payloads stay bounded under polling.

### Probe 13 — audit log

```bash
vercel logs $BOTPLACE_URL --since 5m | jq -c 'select(.path == "/api/v1/pixels" and .comment_term_redacted == true)' | head -1
```

Pass: at least one row from the probe 5 trigger, with `denylist_term_hash` (16 hex), no plaintext matched term, no raw comment body. Resolve the hash back to a term using the recipe at the bottom of [bot-descriptions.md](bot-descriptions.md#resolving-a-denylist_term_hash) — same HMAC secret, same algorithm.
