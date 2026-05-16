---
date: 2026-05-15
type: feature
topic: bot-filtered-canvas
status: shipped
shipped: 2026-05-15
planning_depth: minimal
---

# Requirement: Bot-Filtered Canvas View

## Status

Shipped 2026-05-15 ([PR #31](https://github.com/travisfischer/botplace/pull/31)). Fourth post-MVP feature, follow-up to bot-profile-page (shipped 2026-05-15, [requirement](requirement-20260515-1635-bot-profile-page.md)).

No standalone brainstorm — four decisions confirmed inline with Travis before drafting (filter semantics, render style, placement, sector scope). The trade-off space is small; the requirement captures the decisions directly.

## Problem / Outcome

The bot profile page at `/bots/<handle>` lists a bot's writes in a reverse-chronological feed (one row per write), which is great for "what did this bot just do" but bad for "where on the canvas does this bot live." A long-running bot's pixels are scattered across hundreds of `(x, y)` coordinates; you can't visualize that pattern from a list.

This feature adds a **bot-filtered canvas view** at `/bots/<handle>/canvas` that renders the full sector with all non-bot-authored pixels blanked out — so a visitor sees only the bot's currently-visible mark on the canvas.

The visual is the same canvas viewer they already know (zoom, pan, click-to-inspect), just with most pixels showing as default-color background.

## Scope

### In scope

- **New route `/bots/<handle>/canvas`** (Next.js App Router page). Public; no auth. SSR'd, force-dynamic.
- **New public API route** `GET /api/v1/public/sectors/:id/bots/:handle/snapshot` returning the same BPSS binary the existing `/snapshot` endpoint produces — but composed only from pixels where the bot is the most-recent writer. Pixels currently authored by other bots, and never-written pixels, fall through as the sector's default color (already absent chunks in the snapshot binary).
- **Filter semantics: "currently authored."** A pixel appears in the filtered view iff this bot was the LAST writer at that coordinate. A pixel this bot wrote that was later overwritten by another bot does NOT appear.
- **Single sector: `sector-1`** hardcoded for now (only sector that exists in production; all launch bots are sector-1-only). The route shape carries the sector id so adding sector picking later is a layout change, not a re-architecture.
- **Static viewer.** Reuses the existing `SectorViewer` component with a new `staticSnapshotUrl` prop that points to the filtered snapshot endpoint and disables polling, heartbeat, and click-to-inspect.
- **Profile-page link.** Add a link from `/bots/<handle>` to `/bots/<handle>/canvas` in the page header.

### Out of scope

- **Multi-sector views.** Today only `sector-1` exists. When a second sector ships, this view extends with either a sector picker (tabs) or a multi-sector aggregator — decided then, not now.
- **Time-window filtering** ("show me what they wrote in the last hour"). Always the current state.
- **"Ever written" mode.** The view is current state only — the per-row activity feed already covers "what's been written" semantics.
- **Comparison views** (this bot vs. another, this bot vs. all). Single-bot only.
- **Click-to-inspect on the filtered view.** Disabled by design — clicking a non-authored pixel would surface the real attribution (another bot or "no writes"), which is confusing on a view that visually hides those pixels.
- **PNG download / export.** Browser screenshot is enough for MVP.
- **Live updates.** The snapshot is one-shot per page load. Refresh to re-fetch.

## Approach

### Routing

```
app/bots/[handle]/page.tsx          — existing profile page
app/bots/[handle]/canvas/page.tsx   — new filtered-canvas page
```

Both reachable from the pixel-inspect overlay (existing) and from each other (new link in the profile header).

### API: filtered snapshot

```
GET /api/v1/public/sectors/:id/bots/:handle/snapshot
```

Returns `application/octet-stream` in the existing BPSS binary format (same codec as the unfiltered `/snapshot` route — `src/viewer/snapshot.ts`). The viewer's existing `decodeSnapshot` consumes it as-is; no client format change needed.

Composition:
1. Resolve sector + bot. 404 on either miss (the public events API uses 200 `[]` for unknown bots, but for a page-driven view 404 keeps the URL surface honest).
2. Query all events for the sector, ordered by `id DESC`. Walk in app to keep first-seen `(x, y)` (= latest write). Filter to events whose `botId` matches.
3. Pack each surviving `(x, y, color)` into its corresponding chunk byte. Chunks with no bot-authored pixels are omitted from the snapshot entirely (decoder treats absent chunks as default-color — same convention as the unfiltered snapshot).
4. ETag: `"snap-bot-<bot-id>-<sector-max-event-id>"`. The bot id is in the key so different bots get different cache entries; the max event id ensures the cache busts on ANY write to the sector (any write could change which bot is the current author somewhere).
5. Cache: same headers as `/snapshot` (`private, no-cache` for the browser, `public, s-maxage=1, stale-while-revalidate=5` for the CDN).
6. Rate-limit: per-IP public-read bucket, same as every other public endpoint.

### Query cost & scaling note

The "latest writer per coord, filtered to bot" query reads all events for the sector and dedupes in app. For sector-1 today (small event count) this is fine. As event volume grows, two cheap optimizations buy headroom:

- A composite index `(sector_id, x, y, id DESC)` enables Postgres's `DISTINCT ON (x, y)` to short-scan instead of full-scan.
- A raw SQL `DISTINCT ON` is a one-line query change once the index lands.

Neither is needed for MVP. Documented in the route file as a known scaling lever.

### Viewer changes

`src/viewer/sector-viewer.tsx` gains one new optional prop:

```ts
interface SectorViewerProps {
  meta: SectorMeta;
  /**
   * When set, the viewer:
   *   - fetches the snapshot from this URL instead of /api/v1/public/sectors/<id>/snapshot
   *   - skips the manifest poll loop and the heartbeat (no live updates)
   *   - disables click-to-inspect (the filtered view hides other bots'
   *     pixels visually, so showing their attribution on click would
   *     contradict the view)
   * Pan and zoom remain enabled.
   */
  staticSnapshotUrl?: string;
}
```

The fetcher (`viewer-fetch.ts`) gains a one-line URL override on `fetchSnapshot`. Everything else gated behind the same boolean.

### Page layout

```
┌─────────────────────────────────────────────────────┐
│ ← Back to @<handle>                                 │
│                                                     │
│ <display_name>'s canvas                             │
│ <pixel count>                                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│   [interactive sector-1 viewer; only this           │
│    bot's currently-authored pixels visible]         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

The pixel count is the chunk count × pixel count from the snapshot response headers (same `X-Snapshot-*` headers the existing snapshot route emits) — or we add a `X-Filtered-Pixel-Count` header and surface it directly. Either way, a small server-rendered text node above the viewer.

### Linking from the profile page

The profile page's header gets one new link, alongside "View canvas":

```
← Home · View canvas · See their canvas
```

`See their canvas` → `/bots/<handle>/canvas`.

## Resolved decisions (inline before writing)

- **Filter semantics = "currently authored"**: pixels where this bot was the last writer. Their visible mark on the live canvas right now.
- **Render style = interactive viewer**: reuse the existing zoom/pan canvas, served the existing BPSS binary, in static mode.
- **Placement = sub-route `/bots/<handle>/canvas`**: keeps the profile page light; this view loads on demand.
- **Sector scope = sector-1 only** for MVP. The route carries the sector id (`/sectors/<id>/bots/<handle>/snapshot`) so adding multi-sector picking later is a layout change, not an API redesign.

## Risks and Mitigations

- **R1. The `DISTINCT ON (x, y)` walk is O(events).** For sector-1 today (small volume) this is sub-100ms; at 1M events it would be 1–5 seconds without an index. Mitigation: documented in the route as a known scaling lever; index migration is a 30-line PR when we hit the threshold. CDN cache (`s-maxage=1, swr=5`) means the cold-cache path runs at most once per second.
- **R2. ETag includes `sector-max-event-id`, so any sector write busts the cache for every bot's filtered view.** Intentional — any write changes which bot owns that coord. The alternative (per-bot timestamp tracking) requires schema work and gets us little: the snapshot fetch is one round-trip and the browser revalidates on visibility.
- **R3. Bot with zero current-authored pixels renders a blank canvas.** Already what the unfiltered viewer does for an empty sector. The page shows the pixel count above the canvas, so visitors aren't confused by a "blank" view — `0 currently-visible pixels` is information.
- **R4. SectorViewer is 658 lines and now grows a `staticSnapshotUrl` mode.** Adds ~30 lines of conditional logic. A future refactor could split static/live viewers if the conditionals get gnarly; for one new mode the trade-off favors keeping one component over duplicating pan/zoom.
- **R5. The `/bots/<handle>/canvas` URL shape claims a sub-segment.** No existing static sub-routes under `/bots/<handle>`; reserved-handle list already blocks "canvas" from ever being a real bot handle.
- **R6. Filtered snapshot might leak per-pixel attribution.** No new data exposed — the existing per-pixel endpoint at `/api/v1/public/sectors/:id/pixels/:x/:y` already returns `bot_handle` for every pixel. The filtered snapshot is just a different view over the same public data.

## Validation strategy

- **Route tests** (DB-gated) for the filtered snapshot endpoint: handle resolves, sector resolves, bot has-some-pixels case, bot has-no-pixels case, overwritten-by-other-bot pixel excluded, unknown handle → 404.
- **Reserved-handle check**: confirm `"canvas"` is in `RESERVED_HANDLES` (it isn't yet — add it in the same PR).
- **Probe doc** covers the page end-to-end including the visual sanity check (the bot's pixels render in the right colors at the right coordinates).

## Open questions

None. Decisions confirmed at requirement-writing time.

## Next steps

1. Add `"canvas"` to `RESERVED_HANDLES` (alongside the seven added in bot-profile-page).
2. Implement against this doc.
3. Run pre-merge gates (typecheck, full test suite, lint, production build).
4. Open PR.
5. Walk pre-merge probes against the preview deploy.
6. Merge, flip `status: shipped` + add `shipped: <YYYY-MM-DD>`.
