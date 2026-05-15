---
date: 2026-05-15
topic: bot-descriptions
status: ready
---

# Brainstorm: Bot Descriptions

## Problem / Opportunity

Bots have a `handle` (canonical, immutable) and a `displayName` (human label, freely editable) but no way to *say anything about themselves*. The only signal a viewer gets about who painted a pixel is two short strings. There's no answer to "what is this bot trying to do?" beyond inference from the pattern on the canvas.

A description field is the cheapest passive-communication channel we can add:

- A bot can declare its intent ("Conway's Life simulator drawing gliders at 1 cell / minute").
- A bot author can tell other bot authors who they are ("by @travisfischer, source on github — N/A under our link-redaction policy, see below").
- Future moderation / dispute review has more context than just the handle.

It also unlocks a small but real bit of agent-native expressivity: the bot itself, via its own API key, can decide what to say and when to update it. This matches the project's principle that the bot API is the product surface.

The scope is deliberately small: **one nullable text field on each bot, write via bot's own API key, surface on read endpoints, basic regex-based content moderation**. No UI yet beyond what existing surfaces give us; no LLM moderation; no profile-extension framework.

## What We're Building

**Data:**

- New nullable column `Bot.description` (`String?` in Prisma, `description TEXT` in Postgres).
- Hard length cap enforced at the API boundary; the column is wide enough that a future cap bump is a code change, not a migration.
- `description_updated_at` timestamp (nullable) so reads can see staleness without us building an event log.
- No new table, no per-update event row. Updates are logged via the existing structured-log stream (same shape M1 locked in).

**Write path:**

- `PATCH /api/v1/bots/me` authenticated by the bot's own API key, accepting a partial body `{ description?: string | null }`.
  - `me` resolves to the bot identified by the API key. No id in the URL — explicit "current bot" namespace, mirrors patterns like GitHub's `/user`.
  - Passing `description: null` clears it; passing a string sets it.
  - Other future bot-self fields slot into this same endpoint.
- Owner-side editing piggybacks on the existing owner UI: a new `updateBotDescription` server action in `app/bots/_actions.ts` powering an edit field next to display name.
- Both paths run the same validation + moderation pipeline.

**Read path — add `description` to every response shape that already includes bot identity:**

- New `GET /api/v1/public/bots/[handle_or_id]` — dedicated bot-detail endpoint. Accepts **either** a handle or a cuid; the route picks the lookup column by shape (cuid: `/^c[a-z0-9]{24}$/` → query `id`; else query `handle`). Both columns are unique, both indexed, no collision risk. Returns `{ handle, display_name, description, rate_tier, created_at, description_updated_at }`. Public; no auth.
- `GET /api/v1/public/sectors/[id]/bots` — the per-sector roster (every entry gains `description`).
- `GET /api/v1/public/sectors/[id]/pixels/[x]/[y]` — single-pixel attribution detail (the "tell me about this pixel" endpoint).
- Owner-scoped `GET /api/v1/bots` and `GET /api/v1/bots/[id]/keys` parent payloads.
- **Not** added to high-volume event-level responses (`/sectors/[id]/events`, `/public/bots/[handle]/events`) — keeps event payloads lean; clients that want description can hit the roster, single-pixel, or new bot-detail endpoint.
- Field is always present in the JSON when it could be present (`description: string | null`), never omitted. Consistent shape.

**Moderation — regex-only, write-time, three target fields with field-specific rules:**

The moderation primitives are the same across fields; the *response* to a match differs by field.

Shared primitives:
1. **URL / domain detection.** Match any `http(s)://…`, `www.…`, bare `<domain>.<tld>` (TLD allowlist), or email address.
2. **Blocked-term match.** Word-boundary regex over a curated in-repo deny-list (`lib/moderation/blocked-terms.txt`, lowercase, one term per line). Pre-normalized: NFKC → lowercase → strip combining marks → collapse runs of repeated chars. The list is scoped to sexual content + slurs + illegal-content terms. Mild swears (fuck/shit/damn/hell-tier) are explicitly **not** in the list. Travis controls the list; it's committed source code, not a runtime config.

Per-field behavior:

| Field | URL detected | Blocked term matched | When checked |
| --- | --- | --- | --- |
| `description` | **Redact silently** → `[link]` | **Reject** 400 `description_blocked` | Every write |
| `display_name` | **Reject** 400 `display_name_blocked_url` | **Reject** 400 `display_name_blocked` | Every write (create + edit) |
| `handle` | n/a (handle format already forbids `/`, `.`, `:`) | **Reject** 400 `handle_blocked` | Create only (handle is immutable post-create) |

Why the asymmetry:

- `description` is long-form bio prose. A user-friendly tone tolerates "we redacted your link" silently better than rejecting an otherwise-fine 400-character bio over one URL.
- `display_name` is a 64-char identity label. A URL inside a display name is almost certainly spam intent; the bot author should be told to pick a different name. Same for blocked terms — a name is short enough that the author can re-roll.
- `handle` can't contain URL-shaped characters by format. It's also immutable, so the check runs once at create time. If a handle ever needs forcible rename later (deny-list grew, an existing handle now matches), that's an admin-tool problem, not an API problem.

On any rejection, the response **never echoes the matched term** (info leak that helps attackers craft bypasses).

Existing `display_name` values are **grandfathered**: no automatic action on deny-list updates, but the next edit must pass moderation. A future admin script can rescan if needed; out of scope for this milestone.

**Rate-limiting:**

Reuse the bot's existing per-key write bucket. Description updates are charged the same as a pixel write. "Any frequency" in the user's request is interpreted as "not artificially throttled below the existing rate limit", not "unbounded".

## Approaches Considered

The shape of *what* we're adding is mostly already decided (one text field, moderated, surfaced on reads). The interesting design space is the **write-endpoint shape** and the **moderation-execution shape**. Storage / data-model variants are also worth a quick honest look.

### Storage shape

**A1. Column on the existing `Bot` table.** Add `description String?` plus `description_updated_at DateTime?`. Reads that already select `Bot` get the field for free.

- Pros: matches the existing `displayName` pattern; no joins; trivial migration.
- Cons: every `Bot` row gets two more columns whether the bot ever sets a description or not. Cheap in Postgres (TOASTed when long), but it's clutter on the canonical row.

**A2. Separate `BotProfile` table 1:1 with `Bot`.** Profile rows only exist if the bot ever set a description; future profile-ish fields (avatar, color preferences, links once we trust them) slot in here without growing `Bot`.

- Pros: clean separation between identity (handle, owner, status) and self-declared metadata.
- Cons: another join on hot read paths (sector roster, single-pixel attribution). Premature abstraction for a single string field — we're imagining a profile model we don't have signal for yet.

**Recommendation: A1.** The codebase consistently inlines bot metadata on the `Bot` row. One nullable string column does not justify a join. If we accumulate three or four self-declared fields, that's the prompt to extract a `BotProfile` then.

### Write-endpoint shape

**B1. Generic bot-self PATCH at `/api/v1/bots/me`** with a partial body.

- Pros: future bot-self fields (description today, maybe color preferences or status notes later) live at one path with a stable shape. Familiar PATCH semantics. `me` makes the auth-derived identity explicit and avoids any "spoofed id" footguns.
- Cons: PATCH-with-partial-body needs slightly more care on validation (distinguish "not provided" from "provided as null"). Endpoint exists with one field, so for now it's overkill-shaped.

**B2. Single-purpose endpoint `PUT /api/v1/bots/me/description`.**

- Pros: smallest possible surface. Body is just a string (or null). Trivial to validate.
- Cons: every future bot-self field adds another endpoint. We've seen the rate at which the public read surface grew during M2 → M3; bot-self updates will probably grow similarly.

**B3. No new endpoint — fold into existing owner-side mutation paths.**

- Pros: zero new auth-context handling.
- Cons: defeats the explicit user requirement ("bot can update its own description") and the agent-native principle. Hard no.

**Recommendation: B1.** PATCH at `/api/v1/bots/me` is the right shape even with one field today. The cost of starting with the right shape now is ~10 lines of "ignore fields you didn't provide" logic. The cost of breaking the URL later is a deprecation cycle on a public API.

### Moderation-execution shape

**C1. Two pure functions called from the write handlers (`redactLinks`, `containsBlockedTerm`).** Both called inline in the write path; both unit-testable in isolation.

- Pros: simplest thing that works. No pipeline abstraction, no extension point, no LLM hook. Easy to read in the route handler.
- Cons: if we ever add a third stage (e.g. an emoji filter, image moderation when avatars land), we'll either chain three function calls or refactor to a pipeline. Either is fine.

**C2. Pluggable moderation pipeline (`runModerationPipeline(text, stages)`).** Each stage is a named function returning `{ ok, redacted? } | { ok: false, reason }`.

- Pros: organized for growth. Easy to add an LLM stage behind a feature flag later without touching route handlers.
- Cons: building structure for a future we haven't validated. One field, two stages, no obvious near-term third stage — the abstraction earns nothing today.

**Recommendation: C1.** Two functions in `lib/moderation/`, called inline. Re-evaluate the pipeline shape the first time we add a third stage.

### Deny-list sourcing

**D1. Curate in-repo from LDNOOBW.** Start with LDNOOBW (the Shutterstock-maintained "List of Dirty Naughty Obscene and Otherwise Bad Words"), filter aggressively to *sexual + slur + illegal-content* terms only, drop the long tail of mild swears. Commit the filtered list as `lib/moderation/blocked-terms.txt`.

- Pros: well-known starting point, public-domain license, hundreds of real-world contributions.
- Cons: LDNOOBW conflates "mild" and "severe" — `nipple`, `ass`, `breast`, etc. are in the raw list. Requires a careful curation pass before commit. Mistakes are *visible* (users get unexpected rejections) but contained (we can drop the term and the next write succeeds).

**D2. Hand-roll a small list (50-100 terms) from scratch.**

- Pros: full control, no licensing question, no curation-from-a-bigger-list overhead.
- Cons: blind spots are inevitable; the LDNOOBW maintainers have already thought about variants we haven't.

**D3. Use a published anti-spam / content-safety library.**

- Pros: less work.
- Cons: most published libraries are either tiny (worse than LDNOOBW) or huge (full ML pipelines we're explicitly avoiding). Adds a dependency for what's fundamentally `text.match(regex)`.

**Recommendation: D1.** Start from LDNOOBW, curate down to sexual + slurs + illegal-content only, commit the filtered list. Document the curation rule in the file's header comment so future edits stay coherent. Tag it as version 1; record list-version on each rejection log line so we can correlate rejections with list changes.

## Recommended Approach

Inline column on `Bot` (A1) + bot-self PATCH at `/api/v1/bots/me` (B1) + two pure moderation functions (C1) + curated-from-LDNOOBW deny-list (D1).

End-to-end pipeline on a write:

```
input string
  → trim
  → NFC normalize
  → length check (reject if > MAX)
  → URL/email/domain redaction → redacted string
  → blocked-term match on redacted string (reject if hit)
  → store
```

URL redaction happens *before* blocked-term match so an attacker can't smuggle a blocked term inside a URL path that's about to be replaced anyway.

Read endpoints add `description: string | null` consistently. Single-pixel attribution endpoint and the per-sector roster are the two most user-visible additions; event-level endpoints stay lean.

## Key Decisions

- **Storage**: inline column `Bot.description String?` + `Bot.description_updated_at DateTime?`. No separate profile table.
- **Length cap**: 500 characters (resolved 2026-05-15). Lives in `lib/limits.ts` as `MAX_DESCRIPTION_LENGTH`.
- **Null semantics**: `null` means "not set". Always serialized as `null` (never omitted) on read. Passing `null` on write clears the field. Empty-string is normalized to `null` on write.
- **Write endpoint**: `PATCH /api/v1/bots/me` authenticated by the bot's own API key. Partial body. First field this endpoint accepts.
- **Owner write**: new server action `updateBotDescription` in `app/bots/_actions.ts` plus a corresponding edit field in the owner UI. Same validation pipeline.
- **Read surfaces** *(this round)*: new `GET /api/v1/public/bots/[handle_or_id]` bot-detail endpoint, per-sector bots roster, single-pixel attribution detail, owner-scoped bot list / detail. **Not** event-level responses.
- **Bot-detail lookup shape**: one endpoint, dual lookup. Input matching `/^c[a-z0-9]{24}$/` is treated as a cuid id; otherwise treated as a handle (and validated against the handle format before query). Resolved 2026-05-15.
- **Moderation primitives**: shared across fields. Two functions in `lib/moderation/` (URL/email/domain detector + blocked-term matcher). Curated deny-list at `lib/moderation/blocked-terms.txt`. Pipeline: trim → NFC normalize → length-check (per-field) → field-specific URL handling → field-specific blocked-term handling → store.
- **Per-field response (resolved 2026-05-15)**: `description` redacts URLs silently to `[link]` and rejects on blocked term (400 `description_blocked`); `display_name` rejects on URL (400 `display_name_blocked_url`) and rejects on blocked term (400 `display_name_blocked`); `handle` runs blocked-term check at create only and rejects (400 `handle_blocked`).
- **Deny-list source**: curated subset of LDNOOBW, scoped to sexual + slurs + illegal-content terms, committed as `lib/moderation/blocked-terms.txt`. Mild swears explicitly allowed.
- **Error responses**: never echo the matched term in any response or log line that could surface to the user. Internal log fields may include `denylist_version` and a stable category tag but not the literal term.
- **Existing display names**: grandfathered. No automatic re-validation on deny-list updates. Next edit must pass moderation. An admin rescan tool is a follow-up, not in scope.
- **Audit**: one structured log line per accepted or rejected write, with fields `request_id`, `bot_id`, `field` (`description`|`display_name`|`handle`), `length`, `redactions_count`, `rejected_reason?`, `denylist_version`. No event-log row.
- **Rate-limit**: reuse the bot's existing per-key write bucket. Description updates are charged the same as a pixel write. Display-name and handle updates use the existing owner-mutation bucket from M1-polish.
- **Tier**: not tier-gated. FREE and POWER bots can both set a description.

## Resolved Questions (2026-05-15)

- **Q1. Length cap.** Resolved: **500 characters.**
- **Q2. Bot-detail endpoint.** Resolved: **yes, include it.** Single endpoint `GET /api/v1/public/bots/[handle_or_id]` accepting either a handle or a cuid; the route disambiguates by shape (cuid: `/^c[a-z0-9]{24}$/`).
- **Q5. Extend moderation to handle + display_name.** Resolved: **yes**, with field-specific rejection rules (see the "What We're Building" → moderation table). Handles are checked at create only (immutable); display_names on every edit. Existing display_names are grandfathered until next edit.

## Open Questions

The remaining open questions are smaller and have recommended defaults the requirement doc can lock unless overridden.

- **Q3. Owner override of description.** Should the owner be able to clear / edit a bot's description? Recommended: yes, same surface as the existing display_name edit. (Likely an easy confirm.)
- **Q4. Deny-list governance.** Travis hand-picks v1 from filtered LDNOOBW. Long-term curation process is out of scope for this milestone. (Confirming.)
- **Q6. Backfill.** Existing bots get `description: null`. No backfill. (Confirming.)
- **Q7. Re-validation on deny-list change.** No automatic re-validation. An admin rescan tool is a follow-up, not part of this milestone. (Confirming.)

## Next Steps

1. Convert this brainstorm to a requirement document at `plans/requirements/requirement-20260515-{HHMM}-bot-descriptions.md`, locking decisions Q1/Q2/Q5 (resolved above) and treating Q3/Q4/Q6/Q7 as recommended defaults unless redirected.
2. Curate v1 of `lib/moderation/blocked-terms.txt` from LDNOOBW (Travis-driven; not an agent task).
3. Implement against the requirement.
