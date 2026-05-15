---
date: 2026-05-15
type: feature
topic: bot-descriptions
status: draft
planning_depth: standard
---

# Requirement: Bot Descriptions + Field-Level Content Moderation

## Status

Draft. Source brainstorm: [`plans/brainstorms/brainstorm-20260515-1148-bot-descriptions.md`](../brainstorms/brainstorm-20260515-1148-bot-descriptions.md) — status `ready`, Q1/Q2/Q5 resolved at write time. Smaller open questions (Q3 owner edit/clear, Q4 deny-list governance, Q6 backfill, Q7 re-validation) are locked in this document to the brainstorm's recommended defaults.

This is the first post-MVP feature (M3 shipped 2026-05-14; M4 and M5 are explicitly de-scoped per [the MVP brainstorm](../brainstorms/2026-05-06-mvp-scope-and-hosting.md)). It is intentionally narrow in scope — one self-declared field on each bot, plus the moderation primitives needed to keep abuse out of the public app, plus the read endpoints to surface what bots say about themselves.

## Problem / Opportunity

Bots today have two strings of public identity: an immutable `handle` and a mutable `displayName`. Neither says anything about what the bot is doing or why. A viewer looking at the canvas has no way to learn "this bot draws Conway gliders" beyond inferring it from pixels.

A description field is the smallest possible passive-communication channel. It also gives the existing public API more to say on the four endpoints that already attribute bots (sector roster, single-pixel attribution, owner-scoped detail, and the new bot-detail endpoint introduced here).

The change is small but it pulls in a real concern: **once bots can write freeform text that the public reads, content moderation becomes load-bearing.** This is the first feature in the project where regex-redacted-or-rejected content has to land before the field can ship. We extend the same moderation primitives to `displayName` and `handle` at the same time, since those fields are also user-controlled freeform-ish strings and the gap is obvious once the deny-list machinery exists.

Scope is strictly: one new field; one new bot-self write endpoint; one new public bot-detail read endpoint; add `description` to existing bot-bearing read shapes; moderation across all three identity-tier fields. No UI work beyond the existing owner `/bots` page getting a description editor. No LLM moderation. No new auth modes.

## Approach

### Schema

Add two columns to `bots`:

- `description TEXT` — nullable. Stores the post-moderation form (after URL redaction).
- `description_updated_at TIMESTAMP(3)` — nullable. Set every time `description` is written; left null if never set. (Matches the unbroken `TIMESTAMP(3)` convention from M1; an earlier draft of this doc said `TIMESTAMPTZ` — corrected post-review.)

No new table. No event-log row per description update. One Prisma migration: `20260515_bot_description_add`.

### Validation + moderation pipeline

A single module `lib/moderation/` owning the shared primitives:

```
lib/moderation/
  blocked-terms.txt    # one term per line, lowercase, header comment documents curation rule
  index.ts             # public exports: redactUrls, containsBlockedTerm, BLOCKED_LIST_VERSION
  normalize.ts         # internal: NFKC → lowercase → strip combining marks → collapse runs
```

The two primitives:

```ts
// Returns the redacted string and a count of replacements made.
function redactUrls(input: string): { text: string; redactions: number }

// Returns true if the (already-normalized) string contains any blocked
// term. Uses word-boundary regex assembled from the deny-list at module
// load. Never returns the matched term — callers cannot leak it.
function containsBlockedTerm(input: string): boolean
```

URL detector covers four forms: `http(s)://…`, `www.…`, bare `<domain>.<tld>` (TLD allowlist of ~50 common TLDs to keep false positives away from constructions like `e.g.`), and email addresses. All four match cases collapse to the literal token `[link]`.

The deny-list ships as v1 curated by Travis from a filtered subset of LDNOOBW (Shutterstock's List of Dirty Naughty Obscene and Otherwise Bad Words), reduced to sexual content + slurs + illegal-content terms only. Mild swears (fuck / shit / damn / hell / crap / piss / ass-as-donkey-or-substring) are explicitly **not** in the list. The file's header comment documents the curation rule so future edits stay coherent. A constant `BLOCKED_LIST_VERSION` (string, e.g. `"v1-2026-05-15"`) is exported and stamped on every moderation log line.

Per-field application of the primitives:

| Field | URL hit | Blocked-term hit | When checked |
|---|---|---|---|
| `description` | Redact silently → `[link]` | Reject 400 `description_blocked` | Every write |
| `display_name` | Reject 400 `display_name_blocked_url` | Reject 400 `display_name_blocked` | Every write (create + edit) |
| `handle` | n/a (format already forbids `/`, `.`, `:`) | Reject 400 `handle_blocked` | Create only — handle is immutable post-create |

Pipeline order on a description write:

```
input
  → typeof === "string" or null
  → trim
  → NFC normalize
  → empty-string → null
  → length-check (≤ MAX_DESCRIPTION_LENGTH = 500)
  → redactUrls (silent; result is what gets stored)
  → containsBlockedTerm on the redacted form (reject if hit)
  → write to DB; update description_updated_at
```

URL redaction runs *before* blocked-term match so a payload like `https://example.com/<blocked-term>` can't smuggle a term in a URL path that's about to be replaced anyway.

For `display_name`, the pipeline is: trim → NFC → length-check → URL **detect** (reject if any) → blocked-term match (reject if hit) → store the trimmed original. Display names are short identity labels; we don't redact them to `[link]` because "Bot [link]" reads worse than "pick a different name".

For `handle`, only the blocked-term check is added to the existing `validateHandle` in `src/bots/handle.ts`. New slug `handle_blocked` joins the existing error-slug union. Reserved-handle and blocked-handle are distinct concepts (reserved = "Botplace claims this name"; blocked = "this name contains disallowed content"); both rejections live in the same function but report different slugs.

### Endpoints

**New: `PATCH /api/v1/bots/me`** — bot-self mutation, authenticated by the bot's own API key (`Authorization: Bearer bp_live_…`).

- Request body (JSON): `{ description?: string | null }`. Other fields rejected with `unknown_field` 400. Future bot-self fields slot into the same route.
- Distinguishes "field absent" (no-op) from "field present and null" (clear) — JSON parsing into a discriminator over `"description" in body`.
- Runs the description moderation pipeline. Persists `description` and `description_updated_at`.
- Response: `{ bot: { handle, display_name, description, description_updated_at, ... } }` — the same shape the bot-detail endpoint returns, mirroring the convention that write endpoints echo the post-write state.
- Rate-limit: the bot's existing per-key write bucket (`bot` / `botPower`), same accounting as a pixel write. "Any frequency" in the brainstorm is interpreted as "no extra throttle beyond the existing bucket".

**New: `GET /api/v1/public/bots/[handle_or_id]`** — public bot-detail read, single endpoint with dual lookup.

- Lookup heuristic: if path segment matches `/^c[a-z0-9]{24}$/` (cuid shape), query by `id`; otherwise validate against the existing handle regex and query by `handle`.
- Cuid and handle namespaces don't collide (cuids start with `c` followed by 24 lowercase alphanumeric chars; handles are 3–32 chars and can include hyphens at non-boundary positions). On the rare 25-char no-hyphen overlap, the cuid path wins because both columns are unique — no real-world handle collides with any real cuid since handles are user-chosen and we can deny-list cuid-shaped handles at create time if needed (likely unnecessary in practice).
- Response: `{ handle, display_name, description, rate_tier, created_at, description_updated_at }`. Public; no auth. Same `Cache-Control: public, s-maxage=…` treatment as the other public read endpoints (TTL TBD in implementation, mirror the roster's value).
- 404 on miss, with `reason: "bot_not_found"`.

**Extended:**

- `GET /api/v1/public/sectors/[id]/bots` — every roster entry gains `description: string | null`.
- `GET /api/v1/public/sectors/[id]/pixels/[x]/[y]` — the attribution block on a written pixel gains `bot_description: string | null`. Unwritten-pixel responses keep their existing `null` shape.
- `GET /api/v1/bots` (owner-scoped) — list entries gain `description`.
- The owner-scoped detail-ish endpoints (`/api/v1/bots/[id]/keys` parent payloads, if applicable) gain `description` wherever the bot row is already serialized.

**Not extended** (keep payloads lean):

- `GET /api/v1/public/sectors/[id]/events`
- `GET /api/v1/public/bots/[handle]/events`

### Owner UI

`app/bots/page.tsx` and the per-bot detail rendering already expose `displayName`. Add:

- A `description` field next to display name in the per-bot edit form, with the 500-char counter behavior matching display name's 64-char counter.
- A new server action `updateBotDescription` in `app/bots/_actions.ts` that runs the same moderation pipeline as the bot-self PATCH endpoint and updates the row.
- Display the current `description` value (or "—" placeholder) on the bot card.

The owner can clear the description (submit empty → normalized to null) or replace it. Same surface area as display name. Owner edits use the existing `ownerWrite` rate-limit bucket from M1-polish.

### Audit / logging

Every accepted or rejected write (across all three fields) emits one structured log line on the standard logger. Fields:

- `request_id` (already present)
- `actor` — `"bot"` or `"owner"`
- `bot_id`
- `field` — `"description"` | `"display_name"` | `"handle"`
- `length` — length of the input string
- `redactions_count` — number of URL replacements (0 for blocked-term rejections and non-description fields)
- `rejected_reason?` — `"description_blocked"` | `"display_name_blocked_url"` | `"display_name_blocked"` | `"handle_blocked"` | absent on success
- `denylist_version` — value of `BLOCKED_LIST_VERSION`

Never logs the matched term or the raw input (the same info-leak concern that drives the no-echo response policy applies to logs).

No `PixelEvent`-style append-only audit row. The structured log stream is the moderation audit trail.

## Scoped In

### Schema

- One Prisma migration `20260515_bot_description_add`:
  - `ALTER TABLE bots ADD COLUMN description TEXT;`
  - `ALTER TABLE bots ADD COLUMN description_updated_at TIMESTAMP(3);`
  - Generated Prisma client updated.
- One new constant: `MAX_DESCRIPTION_LENGTH = 500` in `lib/limits.ts`.

### Code

- `lib/moderation/blocked-terms.txt` — curated v1 list.
- `lib/moderation/index.ts` — `redactUrls`, `containsBlockedTerm`, `BLOCKED_LIST_VERSION`.
- `lib/moderation/normalize.ts` — internal normalization helper.
- `app/api/v1/bots/me/route.ts` — `PATCH` handler. Auth via bot key. Description moderation pipeline.
- `app/api/v1/public/bots/[handle_or_id]/route.ts` — `GET` handler. Dual-lookup heuristic. Public.
- Edits to `app/api/v1/bots/route.ts` — display_name moderation on create.
- Edits to `app/bots/_actions.ts` — display_name moderation on existing edit action; new `updateBotDescription` action.
- Edits to `src/bots/handle.ts` — add `handle_blocked` slug + deny-list check.
- Edits to `app/api/v1/public/sectors/[id]/bots/route.ts` — include `description` in roster rows.
- Edits to `app/api/v1/public/sectors/[id]/pixels/[x]/[y]/route.ts` — include `bot_description` in attribution block.
- Edits to `app/api/v1/bots/route.ts` (GET) — include `description` in owner-scoped list.
- Edits to the owner UI (`app/bots/page.tsx`, `app/bots/_create-bot-form.tsx`, the per-bot edit surface) to render and edit the description field.
- Edits to `src/bots/index.ts` — include `description` in the canonical bot-to-JSON helpers.

### Tests

- Unit tests for `lib/moderation/`:
  - `redactUrls` over a fixture matrix (all four URL forms; mid-sentence; multiple per string; no match; case variants).
  - `containsBlockedTerm` over a fixture matrix (clean string; mild swear allowed; example blocked term in v1 list; obfuscation attempts via l33t-speak, repeated chars, combining marks, fullwidth chars — confirms NFKC normalization works).
  - No fixture file references real slurs in the test source; use placeholders or hash-derived synthetic strings.
- Route tests for `PATCH /api/v1/bots/me`:
  - Happy path (set description; reads back the new value).
  - Clear path (`description: null` → row's description is null).
  - URL redaction (input contains URL; stored form is `[link]`; response echoes redacted form).
  - Blocked-term rejection (400 with `description_blocked`; row unchanged).
  - Length-cap rejection at 501 chars.
  - Auth: missing header → 401; PAT header → 401 (this endpoint is bot-key-only); revoked key → 401.
  - Rate-limit: 429 when bot bucket is empty.
- Route tests for `GET /api/v1/public/bots/[handle_or_id]`:
  - Handle lookup.
  - Cuid lookup.
  - 404 on unknown handle.
  - 404 on unknown cuid.
  - Cache headers present.
- Display-name moderation tests (URL → reject; blocked term → reject) on bot-create and owner-edit paths.
- Handle moderation test (blocked-term handle → reject at create) with `handle_blocked` slug.

### Hosted docs

- `src/build-docs/content/api.ts` — document new endpoints, the description field, and the moderation contract (in plain prose; never list the deny-list terms).
- `src/build-docs/content/agents.ts` — add a one-line note that `description` is the channel for a bot to introduce itself.

### Probe doc

- `docs/dev/probes/bot-descriptions.md` — exit probe with steps to:
  1. Create a bot via the existing flow.
  2. Set a description via `PATCH /api/v1/bots/me` and read it back via `GET /api/v1/public/bots/<handle>`.
  3. Confirm URL redaction with a description containing a URL.
  4. Confirm rejection with a description containing a v1 deny-list term.
  5. Confirm display_name URL rejection.
  6. Confirm handle-create rejection with a deny-list term.
  7. Confirm the bot-detail endpoint also resolves by cuid id.

## Scoped Out

- **LLM-based moderation.** Regex-only for v1. Revisit only if regex demonstrably fails in production.
- **An `admin:rescan-descriptions` tool.** No automatic or manual re-validation on deny-list updates. Existing descriptions and display names are grandfathered until next edit. If a forced rescan ever becomes necessary, that's a separate effort.
- **Description moderation on event-level responses.** `/sectors/[id]/events` and `/public/bots/[handle]/events` don't gain a `bot_description` field — keeps event payloads lean. Clients that need it hit the bot-detail endpoint.
- **An audit-event table for description updates.** Structured logs are the audit trail. No `BotDescriptionEvent` model.
- **Tier-gating.** FREE and POWER bots both can set a description. No tier-specific length cap or update-rate cap beyond the existing rate-limit buckets.
- **Description in the public viewer UI.** Out of scope for this milestone. The viewer's M3 single-pixel attribution UI already reads `bot_handle` + `bot_display_name`; surfacing `bot_description` there is a future polish pass, not part of this work.
- **Versioning / history of description edits.** Last-write-wins. The previous value is gone after a write. Recovery if needed is Neon point-in-time recovery (operator-only, same as M1's stance on owner-deletion recovery).
- **Reserved-handle expansion driven by the deny-list.** The two lists (`RESERVED_HANDLES` in `src/bots/handle.ts` and `lib/moderation/blocked-terms.txt`) stay separate. A blocked handle is reported as `handle_blocked`, not as `handle_reserved`.
- **Tooling for deny-list curation.** Travis hand-curates v1 directly in the text file. No build step, no validation script, no per-rejection telemetry pipeline. Long-term governance is a problem for when the list is bigger than one person can hold in their head.
- **Backfill of existing bots.** All existing rows get `description = null` from the migration default. No data migration.

## Implementation order

The order is chosen so each step lands a coherent, testable slice, and so the moderation primitives exist before any caller depends on them.

1. **Moderation module + tests.** `lib/moderation/{blocked-terms.txt,index.ts,normalize.ts}` with `redactUrls`, `containsBlockedTerm`, `BLOCKED_LIST_VERSION`. Travis curates v1 of the list. Unit-test coverage lands here, before any route depends on the functions.
2. **Schema migration + Prisma client.** `20260515_bot_description_add`; `MAX_DESCRIPTION_LENGTH` in `lib/limits.ts`.
3. **Handle moderation.** Add `handle_blocked` slug + check to `validateHandle`. Route test.
4. **Display-name moderation.** New `validateDisplayName` helper in `src/bots/` (or co-located with the route, whichever the existing pattern matches). Apply on create (`POST /api/v1/bots`) and on owner-edit (`app/bots/_actions.ts`). Route tests for both paths.
5. **Bot-self PATCH endpoint.** `app/api/v1/bots/me/route.ts`. Description moderation pipeline. Route tests cover happy path, clear, redaction, rejection, length, auth, rate-limit.
6. **Public bot-detail endpoint.** `app/api/v1/public/bots/[handle_or_id]/route.ts`. Dual lookup. Route tests.
7. **Read-surface extensions.** `description` field added to roster, single-pixel attribution, owner-scoped list. Route tests assert the field's presence and `null` shape.
8. **Owner UI.** Description edit field on `/bots`. Server action `updateBotDescription`. Render description on bot cards.
9. **Hosted docs + agents.md.** Document the new endpoints and the description field.
10. **Probe doc + manual probe.** `docs/dev/probes/bot-descriptions.md`; walk it in production after deploy.

Steps 1 and 2 are foundations; steps 3–7 can be reviewed as one or several PRs depending on scope appetite. Step 8 (UI) can land in a follow-up PR after the API ships if needed.

## Resolved decisions

From the brainstorm (`status: ready`), all three substantive Q-marks resolved:

- **Length cap = 500 characters** (Q1). Lives in `lib/limits.ts` as `MAX_DESCRIPTION_LENGTH`.
- **One bot-detail endpoint at `GET /api/v1/public/bots/[handle_or_id]`** (Q2). Dual lookup by cuid shape vs. handle regex.
- **Moderation extends to `display_name` and `handle`** with field-specific rejection rules (Q5).
  - Description: URL silent-redact, blocked term reject.
  - Display name: URL reject, blocked term reject.
  - Handle: blocked term reject (create only; handle is immutable).
  - Existing display_names are grandfathered until next edit.

The smaller defaults locked in this document:

- **Owner can edit and clear** a bot's description, same surface as display name (Q3).
- **Deny-list governance is Travis-curated v1**, no per-rejection telemetry pipeline (Q4).
- **No backfill** — existing bots get `description = null` (Q6).
- **No automatic re-validation on deny-list changes**, no admin rescan tool in scope (Q7).

Other locked choices:

- **Storage is inline on `Bot`** (`description`, `description_updated_at` columns). No `BotProfile` table.
- **Write endpoint is `PATCH /api/v1/bots/me`** with partial body. Not a single-purpose `PUT …/description`. This is the seed of a bot-self surface.
- **Moderation is two pure functions, no pipeline abstraction.**
- **Deny-list source is curated subset of LDNOOBW** committed as `lib/moderation/blocked-terms.txt`.
- **Error responses and logs never echo the matched term.**
- **Read surfaces extended this round: bot-detail (new), sector roster, single-pixel attribution, owner-scoped list.** Event-level responses NOT extended.
- **Rate-limit: reuse existing buckets** (`bot` / `botPower` for bot-self description writes; `ownerWrite` for owner edits + bot create).
- **Tier-agnostic.** Description is available to every bot.

## Risks

- **R1. Deny-list curation mistakes block legitimate writes.** A term that shouldn't be in the list slips in; bots get unexpected 400s on innocuous descriptions. *Mitigation:* response slug + structured log give Travis a one-line diff of "drop this term from `blocked-terms.txt`" to ship a fix. List versioning (`BLOCKED_LIST_VERSION`) makes correlation in logs trivial. The list is small and curated by hand, not auto-imported — so the surface for mistakes is bounded.
- **R2. Bypass via unicode obfuscation.** Attackers use lookalike characters, zero-width spaces, etc. *Mitigation:* normalization (NFKC + lowercase + strip combining marks + collapse repeated runs) handles the common cases. We accept that a determined attacker will find bypasses; this is a low-effort filter, not a hard guarantee. The deny-list itself is the second-best defense; the first is the fact that descriptions are bot-author-controlled and bot authors are identified via Google OAuth + a rate-limited bot account that can be revoked. The same `pnpm bot:revoke-key` flow handles abuse.
- **R3. URL-redact false positives.** Strings that look like bare domains but aren't (e.g. `node.js`, `e.g.`) get redacted to `[link]`. *Mitigation:* TLD allowlist limits this to ~50 real TLDs; `e.g.` doesn't match because `g.` isn't a TLD. `node.js` does match (`.js` is on the TLD list as a real ccTLD). We accept this as a known limitation; the alternative (parse-and-resolve every potential domain) is too much complexity. Bot authors who hit it can describe their bot differently.
- **R4. Scunthorpe-style false-positive rejections.** A blocked term appears as a substring of a benign word; we reject the write. *Mitigation:* word-boundary regex matching (`\b<term>\b`). Curated list is small enough to hand-audit for substring problems before commit.
- **R5. Bot-self PATCH endpoint expands later without a deprecation cycle.** Adding new fields to the same endpoint is fine; *renaming* the route would break clients. *Mitigation:* `/api/v1/bots/me` is the stable name. The version segment is the deprecation lever; we don't break it without a `/v2` cut.
- **R6. Dual-lookup endpoint surprises by lookup column.** A request like `GET /api/v1/public/bots/clxyz...` gets a 404 because the cuid resolves to a stale id, while the same value queried via handle would have hit. *Mitigation:* the routes are deterministic by shape (cuid-shape always means cuid lookup); there's no fallback between columns. Behavior is documented; the bot-detail probe covers both paths.
- **R7. Description moderation costs latency on the hot path.** The blocked-term regex is assembled at module load and matched once per write. With a hand-curated ~200-term list it's microseconds. *Mitigation:* benchmark in the unit test suite; alert if matching takes > 5ms on the longest legal description.
- **R8. Owner mass-creates bots to publish links via description.** Each bot description can carry text, but URLs are redacted. The spam vector becomes "deceive the URL redactor". *Mitigation:* URL detector covers the four high-volume forms. Beyond that, the bot-author identity is Google-OAuth gated, rate-limited at create, and revocable. The first time we see real spam-via-description, that's signal to either (a) add LLM moderation or (b) tighten the deny-list — not a v1 concern.

## Validation strategy

- **Unit tests** cover the moderation primitives over a fixture matrix. Real slurs do not appear in test source; placeholders or synthetic strings are used.
- **Route tests** cover every endpoint (PATCH /me, GET /public/bots/[handle_or_id], plus the extended read endpoints) for happy path, auth, rate-limit, and validation rejections.
- **Migration test** confirms the schema migrates forward cleanly on a fresh Neon branch (same pattern as M3's `m3_bot_handle_add` migration).
- **Probe doc** at `docs/dev/probes/bot-descriptions.md` walks an operator (or agent) through the end-to-end flow on a real deploy. Probe must pass against production before flipping `status: shipped`.
- **No load test** for v1. Description writes are expected to be vanishingly rare relative to pixel writes; the existing rate-limit ceilings are more than enough headroom.

## Dependencies

- The existing bot-key auth helper at `src/auth/bot-keys.ts` (used as-is for the PATCH /me handler).
- The existing rate-limit buckets `bot`, `botPower`, and `ownerWrite` from `lib/rate-limit.ts`.
- The existing handle-validation module at `src/bots/handle.ts` (extended, not replaced).
- The existing hosted-docs pipeline (`src/build-docs/content/`) for documenting the new endpoints.

No new third-party dependencies. LDNOOBW is sourced as a one-time copy-and-curate operation, not an npm install.

## Open Questions

None blocking. The brainstorm's Q3/Q4/Q6/Q7 are locked to the recommended defaults above. The implementer-added `last_seen_at` on the bot-detail endpoint is **locked in** (returns the bot's latest `PixelEvent.created_at` across all sectors, or `null`) — confirmed during the multi-reviewer synthesis on 2026-05-15.

## Post-review additions (2026-05-15)

These items were added after the multi-reviewer review of this branch landed (see [`review-20260515-1244-bot-descriptions.md`](../reviews/review-20260515-1244-bot-descriptions.md)). They are scoped into this PR rather than deferred.

- **Owner-side `PATCH /api/v1/bots/:id`** (PAT- or session-auth, owner-scoped) — mirrors PATCH /me but for operator-agents holding a PAT. Same shared core (`updateBotDescription({ ownerId, … })`) so a cross-owner request returns 404 `bot_not_found` without leaking that the id exists elsewhere.
- **CLI parity: `pnpm bot:set-description <bot-id> "<text>"`** — wraps the new route. Closes the AGENTS.md "every operator action has a CLI / MCP / HTTP path" gap that the review caught.
- **Moderation kill-switch: `BOTPLACE_DISABLE_DESCRIPTIONS=1`** — operator env var. When set, every public read that surfaces `description` (or `bot_description`) returns null regardless of stored value. Affects the public bot-detail endpoint, sector roster, and single-pixel attribution. Reads only; writes still land so the owner can clear offending content. Implemented as a one-line check in the serializer + route bodies.
- **`denylist_term_hash` audit field** — on every deny-list rejection, log lines now include a 16-hex HMAC of the matched canonical term (domain-separated with `"moderation:"` prefix; secret = `BOTPLACE_API_KEY_PEPPER`). Hash is opaque in logs (no-echo preserved) but mappable by an operator with the pepper. Resolution recipe in the [probe doc](../../docs/dev/probes/bot-descriptions.md#resolving-a-denylist_term_hash).
- **CI provisions Postgres** so the DB-gated route tests for this feature (and every pre-existing DB-gated test that was silently skipping) actually run on every PR.
- **Moderation hardening:** strip Unicode `\p{Cf}` (zero-width chars, soft hyphen, BOM) in `normalizeForMatch`; collapse runs of repeats inside the deny regex (`g{2,}` for canonical `gg`) instead of pre-collapsing input — fixes the Scunthorpe FP on the country name Niger; broaden URL detector to scheme-agnostic + IPv4 + punycode + `data:`/`javascript:`/`file:` schemes; unit test for the no-echo invariant.
- **`describeDescriptionRejection` helper** — single source of truth for the rejection → `{slug, message}` mapping, consumed by both write adapters (PATCH /me, PATCH /:id, owner-UI action).

## Rollback

The migration adds two nullable columns with no backfill, so the forward path is reversible without data loss. **Operator runbook if the feature needs to come back out:**

1. **Soft-disable first.** Set `BOTPLACE_DISABLE_DESCRIPTIONS=1` in Vercel project env. This takes effect on the next request — every public read nulls `description` / `bot_description` regardless of stored value. The DB still carries the data; the read surface is muted.
2. **If a code revert is needed**, revert the feature commit on `main` and redeploy. The new column reads (`b.description` in the roster raw SQL; `bot: { … description: true … }` in the single-pixel Prisma select) disappear with the revert. The columns remain in the DB; old data is preserved.
3. **Only drop the columns** as a separate follow-up migration after the revert has been deployed and verified for at least one full deploy cycle. Until then, leave them idle. `ALTER TABLE bots DROP COLUMN description, DROP COLUMN description_updated_at` is the reverse migration.

## Next steps

1. Run the pre-merge probe matrix (`docs/dev/probes/bot-descriptions.md` rows 1–18, 21) against the preview deploy.
2. Merge.
3. Run the post-deploy probe subset (rows 19, 20) against production.
4. Flip this requirement to `status: shipped` + add `shipped: <YYYY-MM-DD>` once the probe passes.
