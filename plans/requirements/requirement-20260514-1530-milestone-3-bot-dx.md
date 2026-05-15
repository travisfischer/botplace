---
date: 2026-05-14
type: feature
topic: milestone-3-bot-dx
status: shipped
shipped: 2026-05-14
planning_depth: standard
---

# Requirement: Milestone 3 — Bot Developer Experience

## Status

Draft. M2.5 shipped 2026-05-12; the canvas at <https://botplace.app> is visibly active with three deterministic launch bots running on Vercel Cron. The M2.5 post-merge cleanup arc finished 2026-05-13 ([PR #16](https://github.com/travisfischer/botplace/pull/16), [PR #18](https://github.com/travisfischer/botplace/pull/18), [PR #19](https://github.com/travisfischer/botplace/pull/19)).

M3 turns Botplace from "the operator's app the operator ships bots into" into "the platform any developer or coding agent can write a bot for." Source brainstorm: [`plans/brainstorms/2026-05-14-m3-bot-dx.md`](../brainstorms/2026-05-14-m3-bot-dx.md) — Q1–Q14 all resolved across three review rounds.

The exit signal: **an LLM agent, given only `https://botplace.app/agents.md`, can build and ship a working third-party bot to <https://botplace.app> in under an hour, with no out-of-band help from the operator.**

## Problem / Opportunity

Today, writing a Botplace bot requires cloning the repo and reading `docs/api/v1.md` (439 lines), understanding the auth model, the rate-limit shapes, the palette, the chunk addressing scheme, and the optimistic-concurrency contract — then writing your own HTTP client. The launch bots prove this is achievable, but they were written by the same person who wrote the API. The public surface has five concrete gaps:

1. **No hosted public bot-author docs.** The API doc lives in the repo, not the app. A human can't share a URL with someone; an LLM agent can't be pointed at it without auth and a clone.
2. **No agent authoring contract.** Nothing analogous to `AGENTS.md` exists for bot authors. The current repo-root `AGENTS.md` is for *contributors*, not bot authors. There's no single drop-this-into-your-LLM artifact.
3. **No palette as a first-class concept.** Palette indices are buried inside the API ref. Both authors and future attribution UIs need a referenceable visualization surface.
4. **No cross-owner bot identity.** `Bot.name` is unique per owner (`@@unique([ownerId, name])`). Once a second owner registers a bot called `painter`, public-attribution surfaces have no way to disambiguate. M2.5 review B3 decided the fix: move to globally-unique `handle` + per-owner `displayName`. M3 implements it.
5. **No pixel attribution surfaces.** `PixelEvent` records every write's `bot_id`, `api_key_id`, and timestamp. The viewer doesn't show it. The public API can't query it per-pixel. "Click a pixel to see the bot" is the most-asked-for feature when someone watches the canvas.

M3 closes all five gaps as one cohesive shipment.

## Approach

Three themes ship in a single M3 milestone (no M3.5 split — see Resolved Decision Q1). The themes are organizationally distinct but share schema migrations, API doc updates, and validation work — splitting them would force the same code through two PRs.

### Theme A — Bot-Author Onboarding

The deliverable is **a polished, publicly hosted set of bot-author pages at <https://botplace.app/build>** that both humans read for understanding and AI agents fetch for codegen. Beautiful first-class app pages, not just rendered repo markdown — same care budget as the viewer.

The centerpiece is **the agent authoring contract** at [`botplace.app/agents.md`](https://botplace.app/agents.md) — a single markdown file an author drops into Claude Code / Cursor / ChatGPT / any LLM agent and says "build me a Botplace bot that does X." It contains everything an agent needs to end-to-end author a bot: vision preamble, API surface, authentication, key-handling foot-guns, palette reference, three runtime shapes, three bot archetypes, common gotchas.

Three runtime shapes are explicitly framed:

- **Pure deterministic** — cron-shaped, no LLM at runtime. Cheapest. Launch bots fit here.
- **Hybrid** — deterministic execution code with periodic LLM strategy regeneration. Recommended default for non-trivial bots.
- **Full LLM-per-tick** — every action decided by an LLM call. Most expressive, most expensive.

Three bot archetypes (lifted from the M2.5 launch bots) get illustrative snippets in three languages (curl, TypeScript, Python):

- **Reactive** (visitor-pulse pattern — reads `/viewers`, derives next write)
- **Ambient** (sparkle pattern — deterministic painter, no input)
- **State-machine** (conway pattern — reads recent state, computes next, writes diff)

Plus the **Hybrid LLM-strategy** pattern with a canonical abstract snippet (TypeScript with `decideStrategy(): Promise<Strategy>` stub) and a concrete provider gallery showing wire-up for Vercel AI Gateway (recommended default), Anthropic SDK direct, OpenAI SDK direct, and bring-your-own-runner (no SDK).

All snippets are framed as **inspiration, not prescription.** The author's AI agent generates the bot.

### Theme B — Identity & Attribution

Globally-stable bot identity + per-pixel attribution surfaces. The migration is breaking by design (pre-1.0; zero external consumers verified) and establishes the project's deprecation pattern: **hard-cut breaking changes are acceptable until evidence of external dependence exists; post-1.0 reassessment when that day comes.**

Two new `Bot` columns:

- **`handle`** — globally unique slug. Canonical identifier in API responses, logs, audit, and cross-owner attribution. Strict validation. Owner picks at bot-create.
- **`displayName`** — per-owner-unique label, permissive validation up to `MAX_NAME_LENGTH=64`. Replaces today's `name`. Freely editable.

Existing `name` column is dropped. Three rows (the M25 launch bots) get backfilled with handles derived from their names (`m25-conway` already shapes correctly).

Five new public attribution endpoints (all under `/api/v1/public/...`, no auth, CDN-cacheable per existing patterns):

- `GET /api/v1/public/sectors/:id/pixels/:x/:y` — single pixel with denormalized latest-event attribution.
- `GET /api/v1/public/sectors/:id/bots` — bots roster on a sector (handle, displayName, rateTier, last-seen-at).
- `GET /api/v1/public/bots/:handle/events` — recent events for a single bot. Hot path; optimized.
- Plus updates to existing endpoints: `/events` exposes `bot_handle` (hard-cut rename from `bot_name`), `/api/v1/sectors/:id` and `/api/v1/bots*` continue to expose `handle` + `displayName` everywhere `name` previously appeared.

Viewer click-to-inspect adds a minimal interaction model:

- Single left-click on a pixel (when zoomed enough that pixels are clearly distinguishable) → small info box with `handle`, `displayName`, `written_at`, and the palette color linking to `/palettes/1#color-<i>`.
- A "see this bot's recent activity" affordance backed by the new `/api/v1/public/bots/:handle/events`.
- No hover state, no rich card, no follow-this-bot. Richer hub-hopper interactions are deferred.
- Restore the `screenToWorld()` helper (deleted as speculative in M2.5 P2.7) as the click-coordinate-to-canvas-coordinate translator.

### Theme C — API Polish

Small surface, rides with Themes A/B because we're touching the API anyway:

- **Better error responses** — `invalid_input` is currently generic; add per-field shapes (`{ error: "invalid_input", field: "x", reason: "out_of_bounds" }`).
- **X-Request-Id on success responses** — currently set on errors but not consistently on successes. Symmetric ~5-line fix.
- **B8 seed-script `--actor` flag** — `pnpm m25:seed-launch-bots --actor <email>` writes `payloadJson.invoked_by` into the audit row. Public-repo reproducibility means multiple potential operators eventually.
- **`AdminAuditEvent.actor_kind` column** — normalized actor type (`admin_token`, `seed_script`, etc.); rides with B8 since we're already touching audit-emitting code. Backfill migration sets existing rows to `admin_token`.

Explicitly deferred out of M3: RFC-7232 If-None-Match parser (defensive; no live bug), Vary headers (defensive; no live bug), `pnpm admin:firewall` (M4 ops territory), R7 regression test (M2.5 A6, killed).

## API design decisions

### Design principles

Carried forward from M2 and M2.5:

- **Public, fail-closed, cache-friendly.** New public endpoints follow the M2.5 viewer/events pattern — `Cache-Control: public, s-maxage=N, stale-while-revalidate=M`, no auth, internal errors return a structured `internal_error` with a `request_id`.
- **snake_case JSON, top-to-bottom.** Established in M1.
- **Resource-oriented URLs over filter parameters.** New `/bots/:handle/events` endpoint over a `/events?bot=<handle>` filter — Q6 resolution.
- **Denormalize for read-path hot paths.** Single-pixel endpoint folds in the latest event's attribution rather than requiring a separate event lookup — Q-implicit resolution from round 2.

### Handle validation rules

```
handle: /^[a-z][a-z0-9-]{2,31}$/
        no leading/trailing hyphen
        no consecutive hyphens
        not in reserved list
        globally unique
```

Length is 3–32 characters total (1 letter + 2–31 trailing). Reserved names:

- `admin`, `botplace`, `operator`, `system`, `api`, `public`, `cron`, `auth`, `oauth`
- `travis-fischer`
- Any handle starting with `m25-` (operator-controlled launch-bot prefix; admin path can mint, owner-create path rejects)

Owner picks the handle at bot creation. Handle is **persistent** — no rename feature in M3. A future operator-or-self-service migrate-handle feature lands when there's demand. Display name is freely editable and decoupled from handle.

### New endpoints

#### `GET /api/v1/public/sectors/:id/pixels/:x/:y`

Single pixel with denormalized attribution. The "click-to-inspect" backbone.

```json
{
  "x": 487,
  "y": 123,
  "color": 3,
  "palette_version": 1,
  "bot_handle": "m25-conway",
  "bot_display_name": "M25 Conway",
  "written_at": "2026-05-14T15:23:01.234Z",
  "request_id": "<uuid>"
}
```

- 404 with `pixel_not_found` if the pixel has never been written (no chunk byte, no event).
- 404 with `sector_not_found` for an unknown sector.
- 400 with `out_of_bounds` for `x`/`y` outside the sector dimensions.
- `Cache-Control: public, s-maxage=2, stale-while-revalidate=10` — matches the chunk endpoint's freshness budget.

#### `GET /api/v1/public/sectors/:id/bots`

Bots roster for cross-owner discoverability. The "what bots live here?" surface.

```json
{
  "sector_id": "sector-1",
  "bots": [
    {
      "handle": "m25-conway",
      "display_name": "M25 Conway",
      "rate_tier": "POWER",
      "last_seen_at": "2026-05-14T15:23:01.234Z"
    }
  ],
  "request_id": "<uuid>"
}
```

- Returns all bots with at least one `PixelEvent` in this sector (ever — not just "recently active"). M3 doesn't paginate; if the roster grows past a few thousand bots, M4 adds cursor pagination.
- Sorted descending by `last_seen_at`.
- `Cache-Control: public, s-maxage=10, stale-while-revalidate=60` — roster changes slowly; longer cache budget than per-pixel.

#### `GET /api/v1/public/bots/:handle/events`

Recent events for one bot. Hot path used by click-to-inspect's "see recent activity" affordance.

```json
[
  {
    "x": 487,
    "y": 123,
    "color": 3,
    "accepted_at": "2026-05-14T15:23:01.234Z",
    "chunk_version_after": "42",
    "sector_id": "sector-1"
  }
]
```

- Up to `limit` events (default 20, max 100), sorted descending by `accepted_at`.
- Optional `since=<iso>` filter.
- Returns `[]` for an unknown handle (does not 404 — keeps the click-to-inspect UX from breaking on stale handles).
- Omits `owner_id`, `api_key_id`, `request_id`, and any internal identifiers. `bot_id` is omitted too — `handle` is the canonical public identifier.
- `Cache-Control: public, s-maxage=2, stale-while-revalidate=10`.

### Endpoints we considered but deferred

- **`GET /api/v1/public/sectors/:id/pixels/:x/:y/events`** — full event history for a pixel. The single-pixel endpoint denormalizes the *latest* event's attribution; pixel history isn't a need today. Slot exists for a future plural list-shape endpoint if asked for.
- **`GET /events?bot=<handle>` filter** — the sector-level `/events` endpoint could grow a bot filter. The nested `/bots/:handle/events` endpoint covers the click-to-inspect path more cleanly. The filter can land later if a general-purpose listing path needs it.
- **`GET /api/v1/public/bots/:handle`** — a summary card endpoint for a single bot (handle, displayName, rateTier, sector activity, total writes). Click-to-inspect doesn't need it (the single-pixel response carries enough). Defer until a use case appears.

### Endpoints we extend

- **`GET /api/v1/sectors/:id`** (auth): existing response shape. No change. Continues to return `palette_version` so clients can deep-link to `/palettes/<version>`.
- **`GET /api/v1/bots`** + **`GET /api/v1/bots/:id`** (owner-auth): bot summary JSON gains `handle` and `display_name`. Drops `name`. Continues to expose `rate_tier` (Q7 resolution — keep, hint at upgrade roadmap in docs).
- **`POST /api/v1/bots`** (owner-auth): requires `handle` and `display_name` in the body. Validates handle against the regex + reserved list. `rate_tier` body field continues to be ignored (FREE-by-default; admin-only elevation).
- **`GET /api/v1/public/sectors/:id/events`**: `bot_name` → `bot_handle` rename, hard cut. No deprecation window.

## Hosted docs structure

Repo source under [`app/(build)/`](../../app) as colocated MDX. Rendered at `/build`. Master agent-fetchable file at top-level `/agents.md`.

```
app/(build)/
├── page.tsx                    # /build — overview + nav
├── quickstart/page.mdx         # /build/quickstart — zero-to-first-pixel
├── agents/page.mdx             # /build/agents — agent authoring contract (canonical source)
├── api/page.mdx                # /build/api — full API reference
├── key-handling/page.mdx       # /build/key-handling — foot-guns
├── patterns/page.mdx           # /build/patterns — three archetypes + hybrid
└── components/
    ├── CopyMarkdownButton.tsx
    ├── PaletteSwatch.tsx
    └── SnippetTabs.tsx         # curl / TS / Python tabbed snippets

app/agents.md/route.ts          # /agents.md — concatenates /build pages into one fetchable file
app/palettes/[version]/page.tsx # /palettes/1 — visualization (deep-linkable from attribution)
```

Three copy-to-markdown affordances ship together:

- **Whole-page "Copy as markdown" button** on every `/build/*` page.
- **`?format=md` query parameter** on every `/build/*` URL — returns raw markdown source.
- **`/agents.md` master file** — concatenates the build pages into one ~30KB markdown bundle for one-shot agent ingestion.

The existing `docs/api/v1.md` becomes a short pointer ("the canonical API reference lives at <https://botplace.app/build/api>") and ceases to be the source of truth.

## Scoped In

### Schema

- New `Bot.handle` (string, globally unique, indexed)
- New `Bot.displayName` (string, NOT NULL, no uniqueness constraint)
- Drop `Bot.name` after backfill
- New `AdminAuditEvent.actorKind` (enum: `admin_token`, `seed_script`; backfilled to `admin_token`)
- Backfill migration for the three M25 launch bots (`m25-conway`, `m25-sparkle`, `m25-visitor-pulse` all already handle-shaped; copy `name` → both `handle` and `displayName`)

### Code

- Handle validation module under `src/bots/handle.ts` (regex, reserved-name list, validator function, error slugs).
- Owner-create surface (`POST /api/v1/bots`) requires `handle` and `display_name`; rejects body-supplied `rate_tier` silently (FREE-by-default).
- Bot-summary JSON shape change: `name` → `handle` + `display_name`. All callers updated.
- Three new public endpoints (single-pixel, bots roster, bot-events).
- Viewer: restore `screenToWorld()`, add click handler + info-box component, wire to single-pixel endpoint.
- Seed script (`pnpm m25:seed-launch-bots`) accepts `--actor <email>` flag; emits `payloadJson.invoked_by` into audit rows; uses `actor_kind = seed_script`.
- X-Request-Id response header on every endpoint (success + error).
- `invalid_input` error responses gain optional `field` + `reason` discriminator fields.

### Hosted docs

- `/build` route tree under `app/(build)/` as documented above.
- `/agents.md` aggregator route.
- `/palettes/1` palette page (visualization, color-index anchors for deep-linking).
- `CopyMarkdownButton`, `SnippetTabs` components.
- All snippet content: 9 archetype snippets (3 patterns × 3 languages) + 5 hybrid snippets.

### Docs / operator artifacts

- `docs/api/v1.md` becomes a short pointer to the hosted version.
- New `docs/dev/probes/m3-bot-dx.md` for post-deploy verification.
- `README.md` line updated to "M0 + M1 + M2 + M2.5 + M3 live; MCP server next."

## Scoped Out

- **MCP server.** Deferred to its own future milestone (Q8 resolution). API gets locked in M3; the MCP wraps the locked surface separately.
- **Operator-adjustable rate limits.** FREE/POWER + admin elevation is the surface area. No per-bot overrides, no per-sector tuning. Deferred to M4 ops hardening or whenever real demand appears.
- **User-facing tier-upgrade UI.** Operator-elevation-only through M3. `rate_tier` stays exposed in bot-summary JSON with a "roadmap" mention in the docs.
- **Handle rename feature.** Handles are persistent. A future operator-or-self-service rename feature lands when there's demand.
- **Per-platform polish.** Claude skill, Cursor rule packs, OpenAI Agent template, etc. Defer until we see which platforms users actually arrive on (MVP brainstorm decision stands).
- **Hosted bot runtime.** Authors run bots wherever they want. Docs describe two patterns (laptop, your own Vercel cron) but Botplace runs nothing for them.
- **Behavioral norms for bots.** No "be a good neighbor" prescriptions. Let behavior emerge from the experiment.
- **RFC-7232-compliant If-None-Match parser.** Speculative correctness; no live bug.
- **Vary header on cached endpoints.** Speculative correctness; no live bug.
- **`pnpm admin:firewall` (firewall-rules-as-code).** M4 ops territory; not bot-author-facing.
- **R7 regression test** (M2.5 A6 carry-over). Explicitly killed.
- **`/events?bot=<handle>` filter** (the alternative to the dedicated bot-events endpoint). Can land later if needed.
- **`GET /api/v1/public/bots/:handle` summary endpoint.** Deferred until a use case appears.
- **Pixel history endpoint** (`/pixels/:x/:y/events`). Deferred until a use case appears.
- **Hub-hopper / chained bot-to-bot click-through in the viewer.** M3 ships minimal attribution UX only.
- **Pagination on the bots roster.** M3 returns the full roster; pagination is M4 work if it grows past a few thousand bots.

## Implementation order

Suggested order, optimizing for "land identity migration first so docs reference the final shape":

1. **Schema migration** — `handle` + `displayName` columns, backfill, drop `name`. **~half a day.**
2. **`AdminAuditEvent.actorKind`** + B8 seed-script `--actor` flag (rides with the schema migration). **~half a day.**
3. **Handle validation module** + owner-create surface change. **~half a day.**
4. **`/events` hard-cut rename** + bot-summary JSON shape change. All internal callers updated. **~2 hours.**
5. **X-Request-Id response header + `invalid_input` per-field error shapes.** **~2 hours.**
6. **Single-pixel public endpoint** (with denormalized attribution). **~half a day.**
7. **Bots roster endpoint.** **~2 hours.**
8. **Bot-events endpoint.** **~half a day.**
9. **Viewer click-to-inspect** — `screenToWorld`, click handler, info-box component, wire to single-pixel endpoint. **~half a day.**
10. **Hosted-docs scaffold** — `/build` route tree, MDX setup, layout, copy-markdown button, `?format=md` query, `/agents.md` aggregator. **~1 day.**
11. **Quick Start page + API ref port + key-handling page.** **~1.5 days.**
12. **Agent authoring contract (`/build/agents`)** — vision preamble, runtime shapes, archetypes section. **~1 day.**
13. **Snippet suite** — 9 archetype snippets + 5 hybrid snippets. **~half a day.**
14. **Palette page at `/palettes/1`.** **~half a day.**
15. **Probe doc + end-to-end verification.** **~half a day.**

**Total: ~8 days focused work.**

Lines that can be cut to fit if needed:

- 4 provider-gallery hybrid snippets (~half a day) — could ship with just the stubbed abstract; gallery as a follow-up.
- Click-to-inspect UI (~half a day) — endpoints could ship without viewer-side UX.

## Resolved decisions (2026-05-14)

All 14 questions resolved across three review rounds against the source brainstorm. Pointers:

| # | Topic | Resolution |
|---|---|---|
| Q1 | Milestone size | Single M3 (Option A); no M3.5 split |
| Q2 | Hybrid example shape | Abstract `decideStrategy` stub + 4-provider gallery (AI Gateway, Anthropic, OpenAI, BYO) |
| Q3 | Docs location | `app/(build)/` source, `/build` rendered, top-level `/agents.md` master |
| Q4 | Handle format | `^[a-z][a-z0-9-]{2,31}$`, 3–32 chars, owner-picks, decoupled from displayName |
| Q5 | `/events` migration | Hard cut `bot_name` → `bot_handle`; establishes pre-1.0 deprecation pattern |
| Q6 | Bot-events query shape | New RESTful endpoint `/api/v1/public/bots/:handle/events` |
| Q7 | Tier upgrade UI | No UI; keep `rate_tier` exposed with roadmap hint |
| Q8 | MCP server | Deferred to its own future milestone, post-M3 |
| Q9 | Copy-to-markdown UX | Ship (b) whole-page button + (c) `?format=md` + (d) `/agents.md` master; skip (a) per-section |
| Q10 | Snippet languages | (d) curl + TS + Python; 9 archetype snippets + 5 hybrid |
| Q11 | Palette page URL | `/palettes/1` (integer mirrors API) |
| Q12 | Agent contract scope | Mechanics + patterns; no behavioral norms ("let behavior emerge") |
| Q13 | `AdminAuditEvent.actor_kind` | Add now alongside B8 work |
| Q14 | Handle length conflict | 32-char max; no backfill rename needed |

Plus the Travis reframes that shaped the brainstorm itself:

- **Hosted public docs at botplace.app**, not just repo markdown. First-class app pages with copy-to-markdown affordances.
- **No standalone runnable starter script.** The author's AI agent writes the bot. Docs are the contract; snippets are illustrative.
- **Key-handling foot-guns** get a dedicated docs section, front-and-center.
- **Drop operator-adjustable rate limits.** MVP defaults are good enough.
- **Drop A6 R7 regression test.**
- **Drop dedicated pixel-event endpoint.** Denormalize attribution into the single-pixel read.

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Handle migration breaks the canvas-active launch bots in production. | Low | High | Migrate in two steps: add `handle` + `displayName` with backfill in one migration; drop `name` in a second migration only after all callers are updated and verified. Run end-to-end probe between steps. |
| R2 | Bot-author `AGENTS.md` (at `/build/agents`) gets confused with the repo-root `AGENTS.md` for contributors; coding agents pick up the wrong one. | Medium | Low | Distinct paths; clear preamble at the top of each pointing to the other; the hosted version lives only at the public URL, not the repo. |
| R3 | Hosted-docs scaffold (MDX, copy-md, `?format=md`, `/agents.md` aggregator) blows past the ~1 day budget. | Medium | Medium | Ship a minimal vanilla MDX setup first; defer fancy components (interactive palette swatches) to a polish PR. Snippet tabs can be plain code blocks initially. |
| R4 | LLM-provider gallery snippets rot when SDK shapes change (Anthropic, OpenAI). | Medium | Low | Snippets show just the `decideStrategy` body — narrow surface, stable to track. Annotate snippets with the SDK version they target. Acceptable maintenance burden. |
| R5 | Attribution endpoints leak more than intended (owner email, internal ids). | Low | High | Public endpoints return `handle` + `display_name` only. Mirror M2.5's careful redaction stance. Review the new endpoints with the principle reviewers before merge. |
| R6 | First third-party bot author has a bad onboarding experience and we don't know about it. | High | Medium | Add a "Feedback" footer on `/build` pages pointing at a GitHub issue tracker. Treat first-author feedback as M3 P0. |
| R7 | Click-to-inspect fires on accidental clicks during pan and feels noisy. | Medium | Low | Existing viewer already distinguishes click from pan via drag-threshold detection; click-to-inspect uses the same threshold. If false-positives surface, raise the threshold or require a held modifier. |
| R8 | Reserved-name list has gaps (forgotten brand-name, future-namespace prefix). | Medium | Low | List is in `src/bots/handle.ts` and easy to extend. M3 doesn't ship a handle-rename feature, so adding a reserved name later affects only new registrations. |
| R9 | The 32-char handle max feels too long; users default to verbose handles that read poorly in attribution UIs. | Low | Low | Documented strong suggestion to keep handles short (the docs lean on x.com's 15-char convention as a *recommendation* even though the technical max is 32). Cosmetic-only; no code impact if it happens. |
| R10 | Click-to-inspect modal makes mobile UX awkward (small canvas + small info box). | Medium | Medium | Test on mobile during implementation. M2 already nailed mobile pan/zoom; the info-box component reuses viewer-style mobile-friendly defaults. If it feels bad, ship endpoints without the mobile UI and revisit. |

## Effort summary

~8 days focused work. About a week and a half. Split:

- ~4.5 days hosted docs + agent contract + snippets + palette page (Theme A)
- ~3 days schema migration + attribution endpoints + click-to-inspect (Theme B)
- ~0.5 day polish (Theme C)

Single milestone, single sustained push.

## Next steps

1. Travis reviews this requirement and confirms / flips any pending sub-decisions. (Major ones are all resolved; review is mostly for things like reserved-name list and snippet count.)
2. Implement in the order above. Check in at the foundation milestone (steps 1–5) before building hosted docs.
3. Local end-to-end verification: spin up a fresh agent in a clean repo, give it only `https://botplace.app/agents.md` (once deployed), confirm it builds a working bot end-to-end against the preview deploy in under an hour.
4. Production deploy: migrations, env-var pulls, then docs go live in a single shipment.
5. End-to-end probe: same agent test against production. Iterate on docs based on what the agent stumbles on.
6. Flip this requirement to `status: shipped` once the probe passes and the canvas has a first third-party bot writing pixels.
