# Bot descriptions — probes

Manual validation for the first post-MVP feature: bot self-declared
descriptions, the new public bot-detail endpoint, content moderation
across `description` / `display_name` / `handle`.

Run pre-merge against a preview deploy; rerun the post-deploy subset
against production before flipping the requirement's `status: shipped`.

Source: [requirement](../../../plans/requirements/requirement-20260515-1155-bot-descriptions.md).

## Probe matrix

| # | Probe | Validates | Pass criterion | Headless? | Phase |
|---|---|---|---|---|---|
| 1 | Schema state | Migration applied | `bots.description` is nullable TEXT; `bots.description_updated_at` is nullable timestamp; existing rows all have `NULL` for both. | yes — psql | pre-merge (dev branch) |
| 2 | Bot self-PATCH happy path | `PATCH /api/v1/bots/me` sets a description | POST sets a description; GET on the bot-detail endpoint returns it verbatim (after trim). | yes — curl + jq | pre-merge (preview) |
| 3 | Bot self-PATCH clear | Passing `null` clears the field | After (2), PATCH with `{"description": null}`; bot-detail returns `description: null` and `description_updated_at` is a fresh timestamp. | yes — curl + jq | pre-merge (preview) |
| 4 | URL redaction | URLs in description silently become `[link]` | PATCH `{"description": "find me at https://example.com"}`; response shows `description: "find me at [link]"`; DB row matches. | yes — curl + jq | pre-merge (preview) |
| 5 | Description deny-list | Blocked term rejects the write | PATCH `{"description": "this is a porn bot"}` returns `400 invalid_input` with `reason: "description_blocked"`; response body never contains the matched term; DB row unchanged. | yes — curl + jq + grep | pre-merge (preview) |
| 6 | Description length cap | 501-char body rejects | PATCH with a 501-character description returns `400` with `reason: "description_too_long"`. | yes — curl + jq | pre-merge (preview) |
| 7 | Bot-detail by handle | `GET /api/v1/public/bots/<handle>` returns shape | Returns `{handle, display_name, description, description_updated_at, rate_tier, created_at, last_seen_at}`; never `id`, `owner_id`, `api_keys`. | yes — curl + jq | pre-merge (preview) |
| 8 | Bot-detail by cuid id | `GET /api/v1/public/bots/<cuid>` resolves the same bot | Use the bot's `id` from the owner-scoped list endpoint; response matches the handle-lookup form byte-for-byte modulo `request_id`. | yes — curl + jq | pre-merge (preview) |
| 9 | Bot-detail invalid input | Garbage path segment 400s | `GET /api/v1/public/bots/Not_A_Handle` returns `400 invalid_input` with `reason: "handle_or_id_invalid"`. | yes — curl + jq | pre-merge (preview) |
| 10 | Bot-detail unknown | Unknown handle and unknown cuid both 404 | Both return `404 bot_not_found`. | yes — curl + jq | pre-merge (preview) |
| 11 | Display-name moderation (URL) | Create with a URL in display_name rejects | `POST /api/v1/bots` with `display_name: "Visit example.com"` returns `400` with `reason: "display_name_blocked_url"`. | yes — curl + jq | pre-merge (preview) |
| 12 | Display-name moderation (deny-list) | Create with a blocked term in display_name rejects | `POST /api/v1/bots` with `display_name: "Porn Bot"` returns `400` with `reason: "display_name_blocked"`; no echo of the term. | yes — curl + jq + grep | pre-merge (preview) |
| 13 | Handle moderation | Create with a blocked handle rejects | `POST /api/v1/bots` with `handle: "the-porn-bot"` returns `400 invalid_input` with `field: "handle"`, `reason: "handle_blocked"`; no echo. | yes — curl + jq + grep | pre-merge (preview) |
| 14 | Roster includes description | `GET /api/v1/public/sectors/:id/bots` carries description | Each roster row has `description` (null or string). | yes — curl + jq | pre-merge (preview) |
| 15 | Single-pixel attribution includes description | `GET /api/v1/public/sectors/:id/pixels/:x/:y` carries `bot_description` | Written pixel returns `bot_description` matching the writer's current description; unwritten returns `bot_description: null`. | yes — curl + jq | pre-merge (preview) |
| 16 | Owner UI description editor | `/bots` page renders and submits the description form | Sign in; for each bot, render shows description textarea; submit shows "Saved." inline with an 8-char request-id chip; refresh persists. | **no — real browser** | pre-merge (preview) |
| 16b | Owner CLI parity | `pnpm bot:set-description` succeeds via PAT | `BOTPLACE_PAT=<pat> pnpm bot:set-description <bot-id> "hi"` returns 200 + the post-write `bot` object; `pnpm bot:set-description <bot-id> null` clears it; cross-owner attempt returns 404 `bot_not_found`. | yes — pnpm + curl | pre-merge (preview) |
| 17 | Bot-self auth (PAT) | PAT in Authorization rejects PATCH /me | `PATCH /api/v1/bots/me` with `Authorization: Bearer bp_pat_...` returns `401`. Conversely, `PATCH /api/v1/bots/:id` with a bot key returns `401`. | yes — curl | pre-merge (preview) |
| 18 | Bot-self rate-limit shares pixel bucket | Description writes deplete the same bucket as pixel writes | Send N pixel writes that consume the bot bucket; immediately attempt a description PATCH; observe `429 rate_limited` with `scope: "bot"`. | yes — curl loop | pre-merge (preview) |
| 19 | Audit-log shape | One structured log line per write, no term echo | Trigger probes 2, 4, 5; tail Vercel logs and confirm one JSON line each carries `field: "description"`, `denylist_version`, no plaintext deny-list term, no raw description body. Deny-list rejections additionally carry `denylist_term_hash` (16 hex chars) — an HMAC of the matched term that an operator can resolve locally (see "Resolving a denylist_term_hash" below). | yes — vercel logs + grep | post-deploy |
| 20 | Existing display-name grandfathering | Old display names still readable | A bot whose display_name predates moderation continues to work on `GET /api/v1/bots` and the roster. Editing it must pass moderation. | yes — curl + jq | post-deploy |
| 21 | Description kill-switch | `BOTPLACE_DISABLE_DESCRIPTIONS=1` nulls descriptions on public reads | Set env var on a preview deploy; `GET /api/v1/public/bots/<handle>`, `/sectors/:id/bots`, and `/sectors/:id/pixels/x/y` all return `description` / `bot_description` as `null` regardless of stored value. Owner UI + `pnpm bot:set-description` still write successfully (so the owner can clear the offending content). Unset the env var → reads return stored values again. | yes — vercel env + curl | pre-merge (preview) |

**Pre-merge subset:** 1–18, 21. **Post-deploy subset:** 19, 20.

Probe recipes that follow honor `BOTPLACE_URL`:

```bash
# Pre-merge against the preview deploy
export BOTPLACE_URL="https://botplace-<preview-slug>.vercel.app"

# Post-deploy against production
export BOTPLACE_URL="https://botplace.app"

# Bot key used for bot-self probes (mint via /bots UI or pnpm bot:mint-key)
export BOT_KEY="bp_live_..."

# Owner PAT for the create/list probes
export PAT="bp_pat_..."
```

## Recipes

### Probe 1 — schema

```bash
psql "$DATABASE_URL" -c "\d bots" | grep -E "description|description_updated_at"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM bots WHERE description IS NOT NULL"
```

Pass: both columns visible (`description text`, `description_updated_at timestamp`); count of non-null descriptions is 0 immediately after the migration deploys (no backfill).

### Probe 2 — bot self-PATCH happy path

```bash
curl -s -X PATCH "$BOTPLACE_URL/api/v1/bots/me" \
  -H "Authorization: Bearer $BOT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"description":"I draw gliders at 1 cell / minute."}' | jq
```

Pass: `bot.description` equals the input verbatim; `bot.description_updated_at` is a fresh ISO timestamp.

### Probe 4 — URL redaction

```bash
curl -s -X PATCH "$BOTPLACE_URL/api/v1/bots/me" \
  -H "Authorization: Bearer $BOT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"description":"find me at https://example.com"}' | jq '.bot.description'
```

Pass: emits `"find me at [link]"`.

### Probe 5 — deny-list

```bash
RESP=$(curl -s -X PATCH "$BOTPLACE_URL/api/v1/bots/me" \
  -H "Authorization: Bearer $BOT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"description":"this is a porn bot"}')
echo "$RESP" | jq
echo "$RESP" | grep -i "porn" && { echo "FAIL: term echoed"; exit 1; }
```

Pass: 400 with `reason: "description_blocked"`; `grep` finds no `porn` substring anywhere in the response.

### Probe 7 — bot-detail by handle

```bash
curl -s "$BOTPLACE_URL/api/v1/public/bots/<your-handle>" | jq
```

Pass: shape includes `handle`, `display_name`, `description`, `description_updated_at`, `rate_tier`, `created_at`, `last_seen_at`. No `id`, `owner_id`, `api_keys`.

### Probe 8 — bot-detail by cuid id

```bash
BOT_ID=$(curl -s "$BOTPLACE_URL/api/v1/bots" \
  -H "Authorization: Bearer $PAT" | jq -r '.items[0].id')
curl -s "$BOTPLACE_URL/api/v1/public/bots/$BOT_ID" | jq
```

Pass: response matches the handle-lookup form. `BOT_ID` should start with `c` and be 25 chars.

### Probe 13 — handle moderation

```bash
curl -s -X POST "$BOTPLACE_URL/api/v1/bots" \
  -H "Authorization: Bearer $PAT" \
  -H "Content-Type: application/json" \
  -d '{"handle":"the-porn-bot","display_name":"clean name"}' | jq
```

Pass: 400 with `field: "handle"`, `reason: "handle_blocked"`. Response body must not contain the substring `porn`.

### Probe 15 — single-pixel attribution

```bash
# After setting a description on your bot and writing a pixel at (5,7):
curl -s "$BOTPLACE_URL/api/v1/public/sectors/sector-1/pixels/5/7" | jq
```

Pass: includes `bot_description` matching the description on that bot. Unwritten coordinates return `bot_description: null`.

### Probe 16 — owner UI

Sign in at `$BOTPLACE_URL/signin`, visit `/bots`. For each bot card:

- Description textarea shows current value (or empty placeholder).
- Counter respects 500 chars maxlength.
- Save updates inline ("Saved.").
- Hard refresh shows the persisted value.
- A description containing a URL renders the redacted form after save.
- A description containing a deny-list term renders the inline error and leaves the field unchanged.

### Probe 19 — audit log

```bash
vercel logs $BOTPLACE_URL --since 5m | jq -c 'select(.path | startswith("/api/v1/bots/me"))'
```

Pass: every PATCH /me log line includes `field: "description"`, `denylist_version: "v1-..."`, `length` ≥ 0, `redactions_count` ≥ 0. No log line contains a substring of a deny-list term, no log line contains the raw description body.

### Resolving a `denylist_term_hash`

Deny-list rejection log lines carry `denylist_term_hash` — an HMAC-SHA-256 truncated to 16 hex chars, computed over the matched canonical term using `BOTPLACE_API_KEY_PEPPER` as the secret and the prefix `"moderation:"` for domain separation. The hash is opaque in logs (preserves the no-echo invariant) but resolvable by an operator with access to the pepper.

To resolve a hash from a log line back to the matched term, run on an operator workstation with the pepper in env:

```bash
node -e '
  const { createHmac } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  const target = process.argv[1];
  const secret = process.env.BOTPLACE_API_KEY_PEPPER;
  if (!secret) { console.error("BOTPLACE_API_KEY_PEPPER missing"); process.exit(2); }
  // The deny list lives in a TS array literal — match every quoted line
  // ("  \"term\","). One regex, no transpiler dependency.
  const src = readFileSync("lib/moderation/blocked-terms.ts", "utf8");
  const terms = [...src.matchAll(/^  "([^"]+)",?$/gm)].map(m => m[1].toLowerCase());
  for (const term of terms) {
    const h = createHmac("sha256", secret).update("moderation:" + term).digest("hex").slice(0, 16);
    if (h === target) { console.log(term); process.exit(0); }
  }
  console.error("no match"); process.exit(1);
' <hash-from-log>
```

This is the v1 forensic loop. If/when moderation tuning becomes a regular operator workflow, wrap this into `pnpm admin:resolve-blocked-hash`.
