---
date: 2026-05-20
type: review
requirement: requirement-20260520-1401-sector-bot-roster.md
milestone-slug: sector-bot-roster
status: draft
---

# Review: Sector bot roster page + owner-namespace move

## Scope under review

One PR, six implementation phases (per the requirement's "one PR, internally phased" sequencing). Adds a public bot roster at `/sectors/[id]/bots`, moves owner control from `/bots` to `/account/bots`, and points the bare `/bots` URL at the new public roster.

## Sequencing actually executed

| Phase | What landed |
|---|---|
| 1 | Extracted roster SQL into `src/bots/roster.ts` as a shared loader. API route delegates. Added `last_pixel: { x, y, color, palette_version }` to every row via Postgres `DISTINCT ON` + CTE — same `(bot_id, created_at)` index as the prior query, no new aggregation pass. Extended `m3-attribution-endpoints.test.ts` to assert `last_pixel` matches the seeded write. |
| 2 | New server component at `app/sectors/[id]/bots/page.tsx`. `PageShell variant="narrow"` + `TopNav variant="viewer"` with sector + "Bots" context pills. Card-per-bot layout: display name → @handle → rate-tier Pill → "active Xh ago" relative time → inline last-pixel chip (color swatch + coords) → description → "View profile →" + "See their pixels →" links. Empty-state Card with "Build a bot →" CTA + rate-limit "Slow down" soft view. Server-rendered via the shared `loadSectorRoster` loader (no HTTP loopback). |
| 3 | Viewer `TopNav` context slot now renders sector-name Pill + a "Bots" Pill that links to the current sector's roster, with a subtle flat-shadow hover. Bot profile card adds a third inline link: "All bots on this sector →" wired to the current sector via the most recent event's sector_id (already loaded for the existing "View canvas" link — no new query). |
| 4 | `git mv` of `app/bots/{page.tsx, _actions.ts, _create-bot-form.tsx, _create-pat-form.tsx, _edit-description-form.tsx}` → `app/account/bots/`. Blame preserved. Six `revalidatePath("/bots")` calls flipped to `/account/bots`. `app/signin/_auth-page.tsx` redirect targets (signed-in pre-render and post-OAuth `redirectTo`) flipped to `/account/bots`. `app/account/page.tsx` "Manage bots →" CTA flipped. `src/components/top-nav.tsx` owner-variant "Bots" link flipped. |
| 5 | New `app/bots/page.tsx` issues a server-side `redirect("/sectors/sector-1/bots")` for bare-URL hits. `force-dynamic` so the redirect isn't baked at build time. |
| 6 | This review doc. `pnpm typecheck`, `pnpm lint`, `pnpm build` all green. Audit grep clean. Status flip to `shipped` on the final commit. |

## Findings

### API contract (A1)

Roster route output adds the new field:

```jsonc
{
  "sector_id": "sector-1",
  "bots": [
    {
      "id": "cabc...",
      "handle": "conway",
      "display_name": "Conway",
      "description": "Runs Conway's Game of Life…",
      "rate_tier": "POWER",
      "last_seen_at": "2026-05-20T12:34:56.789Z",
      "last_pixel": {
        "x": 100,
        "y": 200,
        "color": 3,
        "palette_version": 1
      }
    }
  ],
  "request_id": "..."
}
```

`last_pixel` is the same most-recent-event row that drives `last_seen_at` — selecting more columns, not a new aggregation. Test asserts the values match the seeded write (2, 2, color 4, palette 1).

### Roster loader extraction

Pulling the SQL out of the API route into `src/bots/roster.ts` was free scope on top of the user's spec — the page would have either re-implemented the query or made an HTTP loopback (the SSRF-avoiding rationale from `viewer-page.tsx`). One shared loader is the right shape; the API route now just wraps it in rate-limit / logging / HTTP-formatting concerns.

### Cross-links (F12, F13)

- Viewer pages (`/`, `/sectors/[id]`): the topnav context slot picks up a second Pill — variant `info` (pool teal), labelled "Bots", links to `/sectors/<current-id>/bots`. Hover applies a subtle `shadow-flat-sm` for affordance.
- Bot profile page: the existing inline-link row now has three entries (View canvas, See their pixels, **All bots on this sector**). The new link uses the bot's most-recent-event sector — same data path as the existing "View canvas" link — so no extra DB hit.
- The bot-filtered canvas page (`/bots/[handle]/canvas`) was intentionally left alone — its context slot already carries the back-link + filtered-canvas Pill, and adding a roster link there would clutter what's a deliberately-minimal nav.

### Owner namespace move (F7-F11)

Five files moved via `git mv` so blame survives. All six `revalidatePath("/bots")` calls flipped to `/account/bots`. The signin redirect targets (both the pre-render `redirect("/account/bots")` for already-signed-in users and the post-OAuth `signIn(..., { redirectTo: "/account/bots" })`) updated. The account page CTA + the owner-variant TopNav link both updated.

Page header doc-comment refreshed to reflect the new path + reference the move.

### Bare /bots redirect (F8)

`app/bots/page.tsx` is now a 12-line server component that calls `redirect("/sectors/sector-1/bots")`. The single-sector hardcode matches the rest of the production codebase; multi-sector becomes the place to add a picker or a "default sector by activity" lookup. The redirect is server-side (Next emits a 307), so direct hits, copy-paste URLs, and external links all land at the public roster without rendering this page.

### Token discipline (N2)

Grep audit:

- `grep -rn '#[0-9a-fA-F]\{3,6\}' app/ src/components/ src/bots/ --include="*.tsx"` — no new hex literals introduced by this work.
- `grep -rn 'style=' app/sectors/[id]/bots/ --include="*.tsx"` — one inline `style` on the last-pixel color swatch, where the hex comes from `palette[color]` (canvas content), matching the existing pattern in `_activity-feed.tsx` and `palettes/[version]/page.tsx`. Defensible per requirement N2 — canvas content, not chrome.

### Build + typecheck + lint (N1)

- `pnpm typecheck` — clean, no errors.
- `pnpm lint` — two pre-existing warnings (`_host` in `key-handling.ts`, `_k` in `fail-open.test.ts`) carried from main; zero new warnings.
- `pnpm build` — production build succeeds. Route table shows the new `/sectors/[id]/bots`, the bare-`/bots` redirect page, the moved `/account/bots`, and all existing routes intact.

### Server-action invariance (N4)

`app/account/bots/_actions.ts` is the prior `app/bots/_actions.ts` with one substantive change: every `revalidatePath("/bots")` is now `revalidatePath("/account/bots")`. The header doc-comment text-only update mentions the new path. No other behavior changes.

The form components (`_create-bot-form.tsx`, `_create-pat-form.tsx`, `_edit-description-form.tsx`) and the page itself import from `./_actions` (relative), so the move didn't require any import-path updates inside the moved subtree.

### Audit grep

`grep -rn '"/bots"\|href="/bots\|redirect("/bots\|redirectTo: "/bots\|to /bots\b' app/ src/` after excluding `/bots/[handle]` paths returns nothing. Every stale reference is migrated.

## Defects fixed during implementation

- Initial draft of `src/bots/roster.ts` imported `descriptionsDisabled` from `./moderation` (a non-existent module). Corrected to import from `./index` where the function is exported. Caught by `pnpm typecheck`.

## Open follow-ups (not in scope here)

- **Build docs update**: [src/build-docs/content/agents.ts:121](src/build-docs/content/agents.ts:121) references the roster API at the URL level but doesn't enumerate the response fields. A follow-up doc update should describe the new `last_pixel` field for external bot authors who want to consume the API directly.
- **Mobile spot-check (N6)**: `/sectors/sector-1/bots` at ~390px width — cards should stack cleanly; not yet manually verified.
- **Multi-sector path for the bare `/bots` redirect**: today it's hardcoded to `sector-1`. When the second sector lands, this becomes either a sector picker, a default-by-activity selector, or stays as-is with sector-1 always being the "main canvas." Decide in the multi-sector milestone.

## Verdict

Phases 1–6 land cleanly. API extension uses the existing index with no new aggregation; the loader extraction gives the page and the API a single source of truth; the owner-namespace move preserves blame and updates every reference. Roster page consumes only existing design-system primitives. Ready to merge.

Requirement status flips `ready` → `shipped` on the merge commit with `shipped: 2026-05-20` added to the frontmatter.
