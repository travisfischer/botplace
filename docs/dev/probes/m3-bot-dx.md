# M3 — Bot DX probes

Manual validation for the Milestone 3 surface: handle migration, the
three new attribution endpoints, click-to-inspect, hosted docs, and the
agent-fetchable `/agents.md` master file. Run before declaring M3
shipped, and again post-deploy to confirm production matches.

The exit signal for M3 itself is end-to-end: an LLM agent given only
`https://botplace.app/agents.md` ships a working third-party bot in
under an hour. The probes below are necessary-but-not-sufficient — they
validate mechanics; the end-to-end test validates the deliverable.

## Probe matrix

| # | Probe | Validates | Pass criterion | Headless? | Phase |
|---|---|---|---|---|---|
| 1 | Schema state | Migrations applied; M2.5 launch bots backfilled | `bots.handle` is NOT NULL globally unique; `display_name` populated; `bots.name` column gone; M25 launch bots' rows still have correct handles | yes — `pnpm op db:check` + psql | pre-merge (dev branch) |
| 2 | Owner-create handle validation | `POST /api/v1/bots` rejects bad handles per-field | 6 cases each return `400 invalid_input` with `field: "handle"` and the right `reason` slug | yes — curl + jq | pre-merge (preview) |
| 3 | Single-pixel attribution | `GET /api/v1/public/sectors/:id/pixels/:x/:y` returns bot_handle | Write a pixel, then GET it; response carries `bot_handle` + `bot_display_name` matching the writer | yes — curl + jq | pre-merge (preview) |
| 4 | Bots roster | `GET /api/v1/public/sectors/:id/bots` lists all writers | Two bots write distinct pixels; roster contains both, sorted by last_seen_at desc | yes — curl + jq | pre-merge (preview) |
| 5 | Bot-events endpoint | `GET /api/v1/public/bots/:handle/events` returns the bot's writes | Returns the bot's recent writes; unknown handle returns `[]` (200, NOT 404); malformed handle returns 400 | yes — curl + jq | pre-merge (preview) |
| 6 | /events rename | `bot_handle` is on every event item | `GET /api/v1/public/sectors/:id/events?limit=5` items have `bot_handle`, no `bot_name` field | yes — curl + jq | pre-merge (preview) |
| 7 | X-Request-Id everywhere | Every success + non-auth error carries the header | Sample 6 endpoints; each response has `X-Request-Id: <uuid>` matching `request_id` body field | yes — curl -i | pre-merge (preview) |
| 8 | Hosted docs render | `/build/*` pages return real HTML | All 5 `/build/<slug>` pages 200 with rendered prose; `/build` index lists all 5 | yes — curl | pre-merge (preview) |
| 9 | /agents.md aggregator | One-shot agent ingestion | `/agents.md` returns text/markdown, host-aware preamble points at the requesting host, includes every page's content | yes — curl + grep | pre-merge (preview) |
| 10 | /api/build-md/<slug> | Per-page markdown source | All 5 slugs return text/markdown matching the rendered HTML's content | yes — curl | pre-merge (preview) |
| 11 | /palettes/1 deep-link | Color-index anchors work | Page renders 8 swatches; `/palettes/1#color-3` scrolls to color 3 row | partial — anchor scroll needs a browser | pre-merge (preview) |
| 12 | Click-to-inspect | Click on a written pixel surfaces attribution | Click on a non-empty pixel; info-box pops with bot_handle, display_name, "Written X ago", color swatch link | **no — real browser** | pre-merge (preview) |
| 13 | Audit actor_kind backfill | Pre-M3 rows are `admin_token` | `SELECT actor_kind, COUNT(*) FROM admin_audit_events GROUP BY 1` shows `admin_token` for all pre-M3 rows; `seed_script` for any new seed-script runs; `owner` for new owner-initiated mutations | yes — psql | post-deploy |
| 14 | M2.5 launch bots still write | Schema migration didn't break the live bots | Watch `m25-conway`, `m25-sparkle`, `m25-visitor-pulse` for one cron tick each; pixels appear on canvas; `/events` shows their `bot_handle` | yes — wait + curl | post-deploy |
| 15 | LLM-agent end-to-end | The exit criterion for M3 itself | Spin up a fresh Claude Code session in an empty repo, give it only `https://botplace.app/agents.md`, ask for a bot that does X. Confirm it builds, mints a key (via your owner sign-in), writes pixels you can see on the canvas. Time-box: 1 hour. | **no — manual + visual** | post-deploy |

**Pre-merge subset:** 1–12. **Post-deploy subset:** 13–15.

All recipes honor `BOTPLACE_URL`:

```bash
# Pre-merge against the preview deploy
export BOTPLACE_URL="https://botplace-<preview-slug>.vercel.app"

# Post-deploy against production
export BOTPLACE_URL="https://botplace.app"
```

You'll also need:

- A PAT (`BOTPLACE_PAT="bp_pat_..."`) for owner-create + bot-mint tests.
- A bot key (`BOTPLACE_KEY="bp_live_..."`) for write tests.

---

## Probe 1 — Schema state

```bash
pnpm op db:check
```

Then a manual psql check:

```sql
\d bots
-- Expect: handle (text not null), display_name (text not null),
--   indexes bots_handle_key (unique on handle),
--   bots_owner_id_display_name_key (unique on owner_id, display_name).
-- DO NOT see: a `name` column.

SELECT handle, display_name, rate_tier
FROM bots
WHERE handle LIKE 'm25-%'
ORDER BY handle;
-- Expect 3 rows: m25-conway, m25-sparkle, m25-visitor-pulse.
-- handle == display_name (backfill copied them straight across).
-- rate_tier = POWER for all three.
```

Pass: schema matches; M25 bots backfilled correctly.

---

## Probe 2 — Owner-create handle validation

Six cases, each returns `400 invalid_input` with the right `reason` slug:

```bash
POST() { curl -fsS -X POST "$BOTPLACE_URL/api/v1/bots" \
  -H "Authorization: Bearer $BOTPLACE_PAT" \
  -H "Content-Type: application/json" \
  -d "$1"; }

# Should each fail with 400 invalid_input. Status check via -o /dev/null.
STATUS() { curl -s -o /dev/null -w "%{http_code} %{header.x-request-id}\n" \
  -X POST "$BOTPLACE_URL/api/v1/bots" \
  -H "Authorization: Bearer $BOTPLACE_PAT" \
  -H "Content-Type: application/json" -d "$1"; }

STATUS '{"handle":"-bad","display_name":"x"}'                   # leading hyphen
STATUS '{"handle":"bad-","display_name":"x"}'                   # trailing hyphen
STATUS '{"handle":"BAD","display_name":"x"}'                    # uppercase
STATUS '{"handle":"a--b","display_name":"x"}'                   # consecutive hyphens
STATUS '{"handle":"admin","display_name":"x"}'                  # reserved
STATUS '{"handle":"m25-foo","display_name":"x"}'                # protected prefix
```

For each, also pull the response body and inspect the `field` + `reason`:

```bash
curl -s -X POST "$BOTPLACE_URL/api/v1/bots" \
  -H "Authorization: Bearer $BOTPLACE_PAT" \
  -H "Content-Type: application/json" \
  -d '{"handle":"-bad","display_name":"x"}' \
  | jq '{error, field, reason, message}'
# {"error":"invalid_input","field":"handle","reason":"handle_leading_hyphen", ...}
```

Pass: all six return 400; each has `field: "handle"`; reasons match
(`handle_leading_hyphen`, `handle_trailing_hyphen`,
`handle_invalid_characters`, `handle_consecutive_hyphens`,
`handle_reserved`, `handle_protected_prefix`).

---

## Probe 3 — Single-pixel attribution

```bash
# 1. Mint a probe bot.
RESP=$(curl -fsS -X POST "$BOTPLACE_URL/api/v1/bots" \
  -H "Authorization: Bearer $BOTPLACE_PAT" \
  -H "Content-Type: application/json" \
  -d "{\"handle\":\"probe-$(uuidgen | tr A-Z a-z | head -c 8)\",\"display_name\":\"M3 Probe\"}")
HANDLE=$(echo "$RESP" | jq -r .handle)
KEY=$(echo "$RESP" | jq -r .api_key.plaintext)

# 2. Write a pixel.
curl -fsS -X POST "$BOTPLACE_URL/api/v1/pixels" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"sector_id":"sector-1","x":555,"y":777,"color":4}' >/dev/null

# 3. Read it back via the public attribution endpoint.
curl -fsS "$BOTPLACE_URL/api/v1/public/sectors/sector-1/pixels/555/777" \
  | jq '{x, y, color, bot_handle, bot_display_name}'
```

Pass: response has `bot_handle == $HANDLE`, `bot_display_name == "M3 Probe"`,
`color == 4`. Don't see `bot_id`, `owner_id`, `api_key_id` in the body.

Edge cases:

```bash
# Out-of-bounds → 400 invalid_input field=x|y reason=out_of_bounds.
curl -s -o /dev/null -w "%{http_code}\n" \
  "$BOTPLACE_URL/api/v1/public/sectors/sector-1/pixels/9999/0"

# Unwritten coord → 404 pixel_not_found.
curl -s -w "\n%{http_code}\n" \
  "$BOTPLACE_URL/api/v1/public/sectors/sector-1/pixels/123/456" | tail -2
```

---

## Probe 4 — Bots roster

```bash
# Continuing from Probe 3, write another pixel from a DIFFERENT bot:
RESP2=$(curl -fsS -X POST "$BOTPLACE_URL/api/v1/bots" \
  -H "Authorization: Bearer $BOTPLACE_PAT" \
  -H "Content-Type: application/json" \
  -d "{\"handle\":\"probe-$(uuidgen | tr A-Z a-z | head -c 8)\",\"display_name\":\"M3 Probe 2\"}")
KEY2=$(echo "$RESP2" | jq -r .api_key.plaintext)
HANDLE2=$(echo "$RESP2" | jq -r .handle)

curl -fsS -X POST "$BOTPLACE_URL/api/v1/pixels" \
  -H "Authorization: Bearer $KEY2" \
  -H "Content-Type: application/json" \
  -d '{"sector_id":"sector-1","x":556,"y":777,"color":5}' >/dev/null

# Roster includes both probes.
curl -fsS "$BOTPLACE_URL/api/v1/public/sectors/sector-1/bots" \
  | jq ".bots[] | select(.handle == \"$HANDLE\" or .handle == \"$HANDLE2\")"
```

Pass: both probe bots appear in the roster with correct display_name +
rate_tier (FREE) + last_seen_at.

---

## Probe 5 — Bot-events endpoint

```bash
# The probe bot from Probe 3.
curl -fsS "$BOTPLACE_URL/api/v1/public/bots/$HANDLE/events" \
  | jq ".[0] | {x, y, color, sector_id, accepted_at, chunk_version_after}"

# Unknown handle returns [] not 404.
curl -s -w "\n%{http_code}\n" "$BOTPLACE_URL/api/v1/public/bots/no-such-bot-zzz/events" | tail -2
# Expect: [] then 200

# Malformed handle returns 400.
curl -s -w "\n%{http_code}\n" "$BOTPLACE_URL/api/v1/public/bots/Invalid_Handle/events" | tail -2
# Expect: invalid_input then 400
```

Pass: real handle returns the bot's writes (no `bot_id` in the items);
unknown returns `[]` 200; malformed returns 400.

---

## Probe 6 — /events rename

```bash
curl -fsS "$BOTPLACE_URL/api/v1/public/sectors/sector-1/events?limit=5" \
  | jq '.[0] | keys'
```

Pass: keys list includes `bot_handle`. Does **not** include `bot_name`.

---

## Probe 7 — X-Request-Id everywhere

```bash
for path in \
  /api/v1/public/sectors/sector-1 \
  /api/v1/public/sectors/sector-1/manifest \
  /api/v1/public/sectors/sector-1/events?limit=1 \
  /api/v1/public/sectors/sector-1/bots \
  /api/v1/public/bots/m25-conway/events \
  /api/v1/public/sectors/sector-1/pixels/0/0
do
  printf "%-60s  " "$path"
  curl -sI "$BOTPLACE_URL$path" | grep -i 'x-request-id' || echo "MISSING"
done
```

Pass: every path returns `X-Request-Id: <uuid>`. Auth-failure responses
(intentionally) do not — that's by design; use `/api/v1/bots` without
`Authorization` to confirm the omission.

---

## Probe 8 — Hosted docs render

```bash
for slug in '' /quickstart /agents /patterns /api /key-handling; do
  printf "%-30s  " "/build$slug"
  curl -s -o /dev/null -w "%{http_code}  size=%{size_download}\n" "$BOTPLACE_URL/build$slug"
done
```

Pass: all six are 200; sizes are non-trivial (>3KB each).

Visit `/build` in a real browser to confirm the layout renders, the nav
works, and the "📋 Copy as markdown" button is visible on each `/build/<slug>`.

---

## Probe 9 — /agents.md aggregator

```bash
# Body, headers, and content-type.
curl -sI "$BOTPLACE_URL/agents.md" | grep -i 'content-type\|cache-control'
# Expect: text/markdown; charset=utf-8 + s-maxage=300

# Spot-check the preamble points at the right host:
curl -s "$BOTPLACE_URL/agents.md" | head -20

# Spot-check it includes every section's title:
for section in "Quickstart" "Agent authoring contract" "Patterns" "API reference" "Key handling"; do
  if curl -s "$BOTPLACE_URL/agents.md" | grep -qF "# $section"; then
    echo "  ✓ $section"
  else
    echo "  ✗ MISSING: $section"
  fi
done

# Total size sanity check.
curl -s "$BOTPLACE_URL/agents.md" | wc -c
# Expect: 30000–60000 bytes.
```

Pass: text/markdown content type; preamble points at requesting host;
all 5 sections present; size in range.

---

## Probe 10 — /api/build-md/<slug>

```bash
for slug in quickstart agents patterns api key-handling; do
  printf "%-15s  " "$slug"
  curl -s -o /dev/null -w "%{http_code}  ct=%{content_type}\n" \
    "$BOTPLACE_URL/api/build-md/$slug"
done
```

Pass: all 5 are 200 with `text/markdown`. Unknown slug returns 404 with
`text/plain`:

```bash
curl -s -o /dev/null -w "%{http_code}  ct=%{content_type}\n" \
  "$BOTPLACE_URL/api/build-md/no-such-page"
# 404  ct=text/plain; charset=utf-8
```

---

## Probe 11 — /palettes/1 deep-link

Headless:

```bash
curl -s "$BOTPLACE_URL/palettes/1" | grep -E 'id="color-' | wc -l
# Expect: 8 (one per palette index 0–7)
```

In a browser: open `/palettes/1#color-3`; the page should scroll to the
"orange" row.

---

## Probe 12 — Click-to-inspect (real browser only)

1. Open `https://botplace.app` (or the preview URL).
2. Pan/zoom to a written pixel (any of the M25 launch bots' pixels are
   safe — the canvas is alive in production).
3. Single-click a non-blank pixel. The info-box should appear:
   - Bot's display name + handle (e.g. "M25 Conway @m25-conway").
   - "Written X ago" relative timestamp.
   - Color swatch + `color N` link to `/palettes/1#color-N`.
   - "See @<handle>'s recent activity →" button.
4. Click the activity button → opens `/api/v1/public/bots/<handle>/events`
   in a new tab (raw JSON; M3 minimum scope).
5. Press Esc OR click outside the box → closes.
6. Click on a never-written pixel → "No bot has written this pixel yet."

---

## Probe 13 — Audit actor_kind backfill (post-deploy)

```sql
SELECT actor_kind, COUNT(*) AS n
FROM admin_audit_events
GROUP BY actor_kind
ORDER BY n DESC;
-- Expect: admin_token rows for all pre-M3 audit events.
-- Expect: seed_script rows after pnpm m25:seed-launch-bots is re-run.
-- Expect: owner rows after any owner-initiated mutation through the API.
```

Pass: at least one row of each actor_kind seen as the surface area is
exercised post-deploy.

---

## Probe 14 — M2.5 launch bots still write

Wait one minute. Then:

```bash
curl -fsS "$BOTPLACE_URL/api/v1/public/sectors/sector-1/events?limit=20" \
  | jq '[.[].bot_handle] | unique'
```

Pass: the result includes all three of `m25-conway`, `m25-sparkle`,
`m25-visitor-pulse` (within ~3 minutes of the deploy completing).

If a launch bot is missing, check Vercel cron logs for the corresponding
route — most likely cause is the cron not having fired yet (1-minute
schedule).

---

## Probe 15 — LLM-agent end-to-end (the exit signal)

This is the test that decides whether M3 actually shipped its goal.

**Setup:**

1. Empty directory. No git, no node_modules, no Botplace clone.
2. A signed-in Botplace owner account so the LLM can mint a bot via your
   PAT (you mint the PAT yourself; the LLM never sees plaintext).
3. A fresh LLM session — Claude Code, Cursor, or ChatGPT.
4. Stopwatch.

**Procedure:**

1. To the LLM: "Read `https://botplace.app/agents.md`. Build me a bot
   that paints a bouncing pixel that traces a smooth diagonal across
   sector-1 every minute. I'll set `BOTPLACE_KEY` and `BOTPLACE_PAT`
   as env vars." (Substitute "X" with whatever you want the bot to do.)
2. Let the LLM drive. Mint the PAT yourself when it asks. Mint the bot
   yourself when it tells you the handle (or have it call the API with
   your PAT in the env).
3. Run the bot the LLM produces.
4. Open the canvas, watch for the pixel.

**Pass criteria:**

- The bot writes pixels that match the spec.
- The LLM didn't have to ask follow-up clarifying questions about the
  Botplace API itself (it can ask about the bot's behavior, not the API).
- Total elapsed time ≤ 1 hour from "read /agents.md" to "first pixel on
  the canvas."

**If it fails:**

- Note where the agent stumbled.
- Update `/build/agents` (or the relevant subpage) to remove the
  ambiguity.
- Re-run the probe with a fresh LLM session.

This iteration loop is the M3 follow-up window. Post-deploy R6 says
"first third-party author has a bad onboarding experience and we don't
know about it" is High likelihood — this probe is the early-warning
system.
