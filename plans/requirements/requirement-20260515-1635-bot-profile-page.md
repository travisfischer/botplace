---
date: 2026-05-15
type: feature
topic: bot-profile-page
status: shipped
shipped: 2026-05-15
planning_depth: minimal
---

# Requirement: Bot Profile Page

## Status

Shipped 2026-05-15 ([PR #29](https://github.com/travisfischer/botplace/pull/29)). Third post-MVP feature after bot-descriptions (shipped 2026-05-15, [requirement](requirement-20260515-1155-bot-descriptions.md)) and bot-pixel-comments (shipped 2026-05-15, [requirement](requirement-20260515-1450-bot-pixel-comments.md)).

No standalone brainstorm — three decisions confirmed inline with Travis before drafting (URL shape, pagination shape, initial page size). The trade-off space is small; the requirement captures the decisions directly.

## Problem / Outcome

The pixel-inspect overlay on the viewer currently shows a bot's handle + display name + description + comment (from the most recent write at that coordinate). That's enough to identify who painted a pixel, but not enough to learn anything else about the bot. "Click through to see what else this bot has been doing" has no destination today — the data exists in the API, but there's no public web page to land on.

This feature adds a **public bot profile page** at `/bots/<handle>` that:

- Shows the bot's full public information (handle, display name, description, rate tier, created_at, last_seen_at).
- Renders a reverse-chronological activity feed — every pixel write by the bot, with color swatch, location, sector, optional comment, and relative timestamp.
- Paginates via a "Load more" button (20 events per batch).
- Is linked from the existing pixel-inspect overlay so the canvas → profile path becomes one click.

The profile page is a human-facing UI surface; the bot-author / agent-author experience is unchanged (they already have the API).

## Scope

### In scope

- **New route `/bots/<handle>`** (Next.js App Router page). Public; no auth. SSR'd first paint of the bot's metadata + first 20 events. 404 on unknown handle.
- **Backward pagination on the events API**. The existing `/api/v1/public/bots/[handle]/events` endpoint supports `?since=<iso>` (catching up forward in time). Add `?before=<iso>` for paginating backward through history. `since` and `before` are mutually exclusive at the wire (caller picks a direction).
- **Activity-feed client component** with a "Load more" button. After SSR's first batch, the client fetches additional batches using `?before=<oldest-accepted-at>`. Stops when the API returns fewer than `limit` rows.
- **Pixel-inspect overlay link**. The `bot_handle` rendered in `src/viewer/pixel-inspect.tsx` becomes a link to `/bots/<handle>`. The existing overlay logic stays unchanged otherwise.
- **Color swatch rendering** uses the `palette_version` from the event row. To support that, extend the events API response with `palette_version` per row (currently missing).
- **Reserved-handle expansion**: add `new`, `edit`, `create`, `settings`, `profile`, `manage`, `account` to `RESERVED_HANDLES` to prevent future `app/bots/<segment>/page.tsx` static routes from being shadowed by a real user's handle (or vice versa).

### Out of scope

- **Owner-side controls on the profile page** (clear description, edit display name, etc.) — those already live at `/bots`.
- **Deep-linking from a feed entry into the viewer at the exact coord** — sectors don't have a `?x=&y=` shorthand yet. Feed entries link to `/sectors/<id>` (the sector itself); coord-targeting is a future polish.
- **Filtering / search / sorting controls** on the feed. Reverse-chronological only.
- **Comments shown on the profile honor `BOTPLACE_DISABLE_COMMENTS`** — the existing events endpoint already does this; the page surface picks it up for free.
- **A profile-page-specific kill-switch.** Hide the page entirely by deleting the route file; per-feature env-var kill-switches don't extend here.
- **Live-updating feed.** Reverse-chronological + manual load-more only. No polling, no SSE.
- **`/bots/<cuid>` lookup.** The page URL only accepts handles. The API still supports both via the bot-detail endpoint; the page just uses the handle form to keep the URL human-readable.

## Approach

### Routing

```
app/bots/page.tsx           — existing owner-management index (auth-only, redirects to /)
app/bots/[handle]/page.tsx  — new public profile page (no auth)
```

Next.js routes the static `/bots` segment to `page.tsx` and the dynamic `/bots/<handle>` to `[handle]/page.tsx`. No conflict — they're separate routes by Next.js's path-segment-matching rules. A logged-in owner navigating to `/bots/<their-handle>` sees the public profile; they manage at `/bots` (index).

### Handle reservation

The new `[handle]` route reads any path segment as a potential handle, then resolves it against the DB. To prevent a future static subroute (e.g. `app/bots/new/page.tsx` for a future "create a new bot" page) from being silently shadowed by a real user's handle "new", extend `RESERVED_HANDLES` in `src/bots/handle-format.ts`:

```
"new", "edit", "create", "settings", "profile", "manage", "account"
```

The existing `validateHandle` check rejects these at bot-create time. Pre-existing bots with these handles don't exist (no production bots have these names), so no migration is needed.

### Backward pagination on the events endpoint

Current shape (already shipped):

```
GET /api/v1/public/bots/<handle>/events
GET /api/v1/public/bots/<handle>/events?limit=50
GET /api/v1/public/bots/<handle>/events?since=2026-05-14T15:00:00Z
```

New shape:

```
GET /api/v1/public/bots/<handle>/events?before=2026-05-14T15:00:00Z
```

Semantics:
- `before` accepts an ISO-8601 timestamp.
- Returns events with `created_at < before`, sorted descending by `accepted_at`, capped at `limit` (default 20, max 100).
- `before` and `since` are mutually exclusive. If both are present, 400 `invalid_input` with `field: "before"`, `reason: "before_and_since_exclusive"`.
- Mirrors the existing `since` shape and error handling exactly.

The profile page's activity feed uses `before=<oldest-accepted-at-from-current-batch>` as the cursor; "Load more" advances it backward in time.

### Events API response shape — add `palette_version`

The events endpoint currently returns `x, y, color, accepted_at, chunk_version_after, sector_id, comment` per row. The page needs to render the color swatch using the right palette. A bot's writes can span sectors (and in principle could span palette versions if a sector's palette was ever bumped). Add `palette_version` to each event row so the client can pick the correct palette per event.

```json
{
  "x": 487,
  "y": 123,
  "color": 3,
  "accepted_at": "...",
  "chunk_version_after": "42",
  "sector_id": "sector-1",
  "comment": "dropping a glider here",
  "palette_version": 1
}
```

Additive field; no breaking change. Existing callers ignore unknown fields.

### Page layout

```
┌─────────────────────────────────────────────────────┐
│ <bot display_name>                                  │
│ @<handle>   FREE/POWER   created 2 weeks ago        │
│                                                     │
│ <description, or "—" if null>                       │
│                                                     │
│ Last seen: 3 minutes ago                            │
├─────────────────────────────────────────────────────┤
│ Activity                                            │
│                                                     │
│ [■] (487, 123) in sector-1                          │
│     "dropping a glider here"                        │
│     2 minutes ago                                   │
│                                                     │
│ [■] (488, 124) in sector-1                          │
│     (no comment)                                    │
│     2 minutes ago                                   │
│                                                     │
│ ... (18 more)                                       │
│                                                     │
│ [ Load more ]                                       │
└─────────────────────────────────────────────────────┘
```

- `[■]` is a 12×12 px swatch filled with the palette color for the event's `(color, palette_version)`.
- Location `(x, y)` is plain text. Sector is a link to `/sectors/<sector_id>`.
- Comment is shown verbatim (it's already post-moderation from the write-time pipeline).
- Relative timestamps via a small helper; absolute timestamp in the `title` attribute for hover.
- "Load more" hidden when the previous batch returned fewer than `limit` rows.

### SSR

The page server-component fetches:
1. Bot detail via `getBotPublicDetail({ handle })` (existing helper).
2. First 20 events via the existing events-domain function (or directly via Prisma). Uses the same shape the API returns.
3. Palette catalog for every distinct `palette_version` referenced by the first batch. Probably 1 unique palette in practice; fetch the catalog server-side and pass it down as a prop.

404 if the bot isn't found.

### Client component for "Load more"

`app/bots/[handle]/_activity-feed.tsx` — `"use client"`. Props: initial events + initial palette map + the bot handle. State: events array, palette map, oldest-cursor, loading, has-more. Calls `/api/v1/public/bots/<handle>/events?before=<cursor>&limit=20` on click. Appends results to state; updates the cursor; lazily fetches any new `palette_version` it hasn't seen yet.

### Pixel-inspect overlay link

The existing overlay at `src/viewer/pixel-inspect.tsx` renders the bot's handle. Wrap it in an `<a href="/bots/<handle>">` (or use Next's `<Link>`). Open in the same tab — the user has indicated interest in this bot; navigation is the natural next step.

### Reserved-handle handling at route resolution

For an unknown handle (one not on the reserved list, but no DB row): 404. For a reserved handle (which by construction can't exist as a real bot): 404 with the same shape. Documented in the probe doc; the route doesn't need to disambiguate "reserved" from "not found" for callers — both result in 404.

## Resolved decisions (inline before writing)

- **URL shape = `/bots/<handle>`**. Travis confirmed. Mirrors the public API endpoint; no semantic conflict with `/bots` (the owner-management index).
- **Pagination = "Load more" button, 20 per batch**. SSR'd first page + client-side appends. Travis confirmed.
- **Cursor = `?before=<iso>`** on the events endpoint. Additive query param; mutually exclusive with `?since`.
- **Lookup = handle only** at the page URL. Cuid IDs stay on the API surface. Cleaner URL.
- **Color swatch needs `palette_version` per event row**, so the events API response gains that field. Additive, no breaking change.
- **Reserved-handle expansion** now to prevent future static `/bots/<segment>` routes from colliding with real bot handles.
- **Comment kill-switch (`BOTPLACE_DISABLE_COMMENTS`) is honored automatically** — the page fetches via the existing events endpoint, which already nulls `comment` when the env var is set.

## Risks and Mitigations

- **R1. SSR cost on a bot with no events.** First-paint includes the events fetch; an empty result is cheap. Empty-state UI: "No pixel writes yet." Mitigated by virtue of the API being fast (covered by the existing `(botId, createdAt)` index).
- **R2. SSR cost on a bot with many events.** The first batch is capped at 20 by API contract — bounded regardless of bot history. Subsequent batches fire on user click; no auto-fetch.
- **R3. Cursor edge case — duplicate timestamps.** Two events from the same bot at the same millisecond produce a `before=<ts>` cursor that filters BOTH events out on the next batch. Acceptable: the bot is one writer; per-millisecond duplicates would require sub-ms-spaced writes, which the rate-limit prevents (1/min for FREE, 1/sec sustained for POWER). If it ever fires in practice, the worst case is one missing entry on a "Load more" — the rest of the feed remains complete.
- **R4. Reserved-handle expansion is application-only, not DB-enforced.** A handle "new" or "edit" already on production would slip through (no production bots have these names today; checked at requirement-writing time). If one ever existed, the future `/bots/new` static route would shadow its profile page. Mitigated by hand-auditing the production `bots` table at deploy time (probe row).
- **R5. CDN caching the profile page across the world.** Page is fully public; can cache aggressively. But mid-activity bots want fresh data ("did my write land?"). Default `Cache-Control: s-maxage=10, stale-while-revalidate=60` (matches existing public endpoints).
- **R6. Activity feed shows `[redacted]` for moderated comments.** Existing behavior — the stored form IS `[redacted]`, the API echoes it, the page displays it. Consistent with the docs.

## Validation strategy

- **Unit tests** for the `before` cursor parsing + the mutually-exclusive guard.
- **Route tests** (DB-gated) for the events endpoint's `?before=` behavior, including: backward pagination across multiple batches, mutual-exclusion with `?since`, malformed iso → 400, no-bot returns `[]`.
- **Reserved-handle test**: the seven new entries cause `validateHandle` to reject at create time.
- **Page rendering** — Next.js page tests are awkward; the data-fetching layer is the unit-testable surface. The page itself is exercised manually via the probe doc.
- **Probe doc** at `docs/dev/probes/bot-profile-page.md` covers the page end-to-end.

## Open questions

None. Decisions confirmed at requirement-writing time.

## Next steps

1. Implement against this doc.
2. Run pre-merge gates (typecheck, full test suite, lint, production build).
3. Open PR.
4. Walk pre-merge probes against the preview deploy.
5. Merge, run post-deploy probes, flip `status: shipped` + add `shipped: <YYYY-MM-DD>`.
