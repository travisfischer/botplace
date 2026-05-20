---
date: 2026-05-20
type: feat
topic: sector-bot-roster
status: shipped
shipped: 2026-05-20
planning_depth: standard
---

# Requirement: Sector bot roster page + owner-namespace move

## Status

Ready. Drafted post-conversation on 2026-05-20 with all four decisions resolved inline (no standalone brainstorm — the trade-off space is small and was settled in chat).

Follow-on to [requirement-20260520-0914-apply-nagai-design-to-pages.md](requirement-20260520-0914-apply-nagai-design-to-pages.md) (shipped 2026-05-20 via [#35](https://github.com/travisfischer/botplace/pull/35)). Reuses every shared chrome primitive from that work — this requirement adds one new page and one URL move; no new design vocabulary.

## Problem / Outcome

The public side of Botplace has a bot detail page (`/bots/<handle>`) and a bot-filtered canvas (`/bots/<handle>/canvas`) but **no way to discover bots**. A visitor on the canvas can click into a single bot via the pixel-inspect overlay, but can't see "what bots are painting this sector?" at a glance. The API for that exists ([`GET /api/v1/public/sectors/:id/bots`](app/api/v1/public/sectors/[id]/bots/route.ts)) — only the UI is missing.

A second problem: the `/bots` URL is currently the **owner control surface** (signed-in bot management). Visitors reading the docs or following an external link to `/bots` get either a redirect to `/` (if signed out) or a private management page (if signed in). Neither matches what `/bots` semantically reads as — "a list of bots." The roster work is the right moment to free up the namespace.

Outcome:

1. New public roster page at `/sectors/<id>/bots` listing every bot that has painted on that sector. Each row links to the bot's profile + filtered canvas.
2. Owner control moves from `/bots` → `/account/bots` (clear personal-namespace prefix, matches the `/account` page already there).
3. Bare `/bots` redirects to `/sectors/sector-1/bots` (the public roster of the only sector that exists). External links pointing at `/bots` land somewhere sensible.

## Resolved decisions

All settled in chat on 2026-05-20:

1. **Public roster path is `/sectors/[id]/bots`.** Nests cleanly under the existing viewer route at `/sectors/[id]`. The two pages link to each other reciprocally.
2. **Owner control moves to `/account/bots`.** Keeps `/account` as the personal-namespace root; `/account/bots` is unambiguously "my bots." Rejected `/my/bots` (the bare `/my` URL would be weird and there's nothing else to put there yet).
3. **Bare `/bots` redirects to the public roster** (`/sectors/sector-1/bots`), not to `/account/bots`. Two reasons: (a) signed-out visitors should not bounce around through redirects to land at `/signin`; (b) the URL reads as "a list of bots," and the public roster matches that semantic better than the owner page.
4. **The roster includes a per-bot "last pixel" preview** (x, y, color swatch). The API gets a small extension to return the latest event's coordinates and color alongside `last_seen_at`. Both come from the same most-recent-event row that already drives `last_seen_at`, so this is "select more columns from the row we already identify," not a new aggregation. Aggregation in the spirit of "totals, averages, rankings" stays out of scope per Travis's brief.

## Approach

### The roster page

`/sectors/[id]/bots` — server component, public, no auth required. Same App Router + Vercel Firewall + per-IP rate-limit shape as `/bots/[handle]` and `/bots/[handle]/canvas`.

Layout uses the Nagai vocabulary already in the design system:

- `PageShell variant="narrow"` (same as the bot profile page — narrow column is right for a vertical list of cards).
- `TopNav variant="viewer"` with a context-slot `Pill` showing the sector name. Same pattern as `/bots/[handle]/canvas` — the topnav says "you're inside a sector context."
- Header block with the sector name (display-style), a one-line description ("N bots have painted on this sector. Most recently active at top."), and a `Button variant="ghost"` "← Back to canvas" link to `/sectors/[id]`.
- Vertical list of `Card` rows, one per bot, sorted by the API's default (last-seen-at desc).

Each card shows:

| Field | Source | Display |
|---|---|---|
| Display name | API `display_name` | `font-display` headline, larger size |
| Handle | API `handle` | `font-mono` next to display name |
| Rate tier | API `rate_tier` | `Pill variant="info"` |
| Last seen | API `last_seen_at` | `text-muted`, relative time ("active 2h ago"), full ISO in `title=` |
| Description | API `description` | body text, whitespace-pre-wrap, max ~3 lines visible (clamp not strictly required for v1) |
| Last pixel | **API extension** — `last_pixel: { x, y, color, palette_version }` | inline chip: small color swatch + `(x, y)` coords in mono |
| Profile link | — | `text-brand` "View profile →" linking to `/bots/<handle>` |
| Canvas link | — | `text-brand` "See their pixels →" linking to `/bots/<handle>/canvas` |

Empty state (sector exists but no bot has painted): a single `Card` with a `text-muted` "No bots have painted on this sector yet." line + a small "Build a bot →" CTA pointing at `/build/quickstart`.

Rate-limit soft view: same as the bot profile page — render a centered "Slow down" Card if the per-IP limiter trips.

### API extension for `last_pixel`

`app/api/v1/public/sectors/[id]/bots/route.ts` extends the `RosterRow` shape:

```ts
interface RosterRow {
  id: string;
  handle: string;
  display_name: string;
  description: string | null;
  rate_tier: string;
  last_seen_at: string;
  // NEW
  last_pixel: {
    x: number;
    y: number;
    color: number;             // palette index
    palette_version: number;
  };
}
```

SQL change: the current query is a `GROUP BY` over `pixel_events` joined to `bots`, picking `MAX(created_at)` as `last_seen_at`. Extending it to also return the x/y/color/palette_version of that same most-recent row needs **one** query change — either a `DISTINCT ON (bot_id) ... ORDER BY created_at DESC` or a `ROW_NUMBER() OVER (PARTITION BY bot_id ORDER BY created_at DESC) = 1` filter. Either is supported by the existing `(botId, createdAt)` index that the current query already uses. No new aggregation pass; no new index.

`description` kill-switch behavior (`BOTPLACE_DISABLE_DESCRIPTIONS=1` → `description` nulled on read) preserved; `last_pixel` is unaffected by it.

CDN cache headers unchanged: `s-maxage=10, stale-while-revalidate=60`.

API consumers (none external today; the docs reference the endpoint at [src/build-docs/content/agents.ts:121](src/build-docs/content/agents.ts:121) but don't describe the field shape). Build docs should get a one-line update describing the new field once the page ships.

### Owner-namespace move (`/bots` → `/account/bots`)

Concrete file moves:

- `app/bots/page.tsx` → `app/account/bots/page.tsx`
- `app/bots/_actions.ts` → `app/account/bots/_actions.ts`
- `app/bots/_create-bot-form.tsx` → `app/account/bots/_create-bot-form.tsx`
- `app/bots/_create-pat-form.tsx` → `app/account/bots/_create-pat-form.tsx`
- `app/bots/_edit-description-form.tsx` → `app/account/bots/_edit-description-form.tsx`

**Files staying put** (public namespace, not owner):

- `app/bots/[handle]/page.tsx` — public bot profile, stays at `/bots/<handle>`.
- `app/bots/[handle]/canvas/page.tsx` — bot-filtered canvas, stays at `/bots/<handle>/canvas`.
- `app/bots/[handle]/_activity-feed.tsx` — supporting client component for the profile.

After the move, `app/bots/` contains only the `[handle]/` subtree. A new `app/bots/page.tsx` is added that handles the redirect to the public roster.

### Bare `/bots` redirect

New `app/bots/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function BotsRoute() {
  // Single-sector world today; multi-sector eventually picks the
  // "main" sector or offers a picker. The redirect target is the
  // public roster, not the owner control surface — see resolved
  // decision 3 in the requirement.
  redirect("/sectors/sector-1/bots");
}
```

`force-dynamic` to make the redirect a server-side 307; Next emits the right header on the response and the client never sees `/bots`. Server-side redirect (not `next/link` client-side) so it works for direct URL hits, copy-paste from external chat, etc.

### Link + redirect updates

Five files reference `/bots` and need updating:

| File | Change |
|---|---|
| [app/signin/_auth-page.tsx:38](app/signin/_auth-page.tsx#L38) | `redirect("/bots")` if-signed-in → `redirect("/account/bots")` |
| [app/signin/_auth-page.tsx:59](app/signin/_auth-page.tsx#L59) | `signIn("google", { redirectTo: "/bots" })` → `redirectTo: "/account/bots"` |
| [app/bots/_actions.ts](app/bots/_actions.ts) (6× `revalidatePath("/bots")`) | All six → `revalidatePath("/account/bots")` (after the file is moved) |
| [app/account/page.tsx:43](app/account/page.tsx#L43) | "Manage bots →" link href `/bots` → `/account/bots` |
| [src/components/top-nav.tsx:113](src/components/top-nav.tsx#L113) | Owner variant's "Bots" link href `/bots` → `/account/bots` |

Other `/bots`-prefixed references (`/bots/<handle>`, `/bots/<handle>/canvas`) stay — those are public profile routes, not owner control.

### Viewer-page topnav: link to the roster

The viewer's `TopNav variant="viewer"` currently shows: `Build · Account|Sign up · ThemeToggle` on the right. The sector-context pill in the slot left of the spacer shows the sector name.

Right place to add the roster link: as a second context-slot pill next to the sector name. Format `Roster ›` or `N bots ›` — wraps to the per-sector roster URL. The viewer page already has access to the sector meta; adding a bot count requires either an API call (cost: one extra request) or pre-counting at page load (cost: small SQL). Decision: just render "Bots" as a Pill link with no count for now — keeps the SSR path cheap. Pill is `variant="default"` so it doesn't visually compete with the sector-name pill.

The bot-filtered canvas's topnav (which already uses a custom context slot with the back link + filtered-canvas pill) is left alone — adding a roster link there would be cluttered. Visitors already have the "← @handle" back link to the bot profile, which has its own link to the roster (added below).

### Bot profile page: link to the roster

`/bots/[handle]` currently has "View canvas →" and "See their pixels →" CTAs inside the profile card. Add a third: "All bots on this sector →" linking to `/sectors/<bot's-active-sector>/bots`. The bot's active sector is the `sector_id` from the most recent event in the initial-batch feed (`feedEvents[0].sector_id`); the page already loads this. If the bot has no events yet, the link is omitted (or points at the main-sector roster as a fallback).

## Files to create / modify

```
app/
  bots/
    page.tsx                                # NEW — redirect to /sectors/sector-1/bots
    [handle]/
      page.tsx                              # MODIFY — add "All bots on this sector" link
      canvas/page.tsx                       # UNCHANGED
      _activity-feed.tsx                    # UNCHANGED
  account/
    bots/                                   # NEW DIR (moved from app/bots/)
      page.tsx                              # MOVED from app/bots/page.tsx
      _actions.ts                           # MOVED, revalidatePath() targets updated
      _create-bot-form.tsx                  # MOVED
      _create-pat-form.tsx                  # MOVED
      _edit-description-form.tsx            # MOVED
    page.tsx                                # MODIFY — "Manage bots" CTA → /account/bots
  sectors/[id]/
    bots/page.tsx                           # NEW — public roster page
  signin/_auth-page.tsx                     # MODIFY — both redirect targets → /account/bots
api/v1/public/sectors/[id]/
  bots/route.ts                             # MODIFY — RosterRow + SQL extended for last_pixel

src/
  components/top-nav.tsx                    # MODIFY — owner variant link to /account/bots
  viewer/viewer-page.tsx                    # MODIFY — add "Bots" pill in context slot
```

No new components — the roster page composes existing primitives (`PageShell`, `TopNav`, `Card`, `Pill`, `Button`).

## Sequencing

One PR, internally phased:

1. **API extension first.** Add `last_pixel` to the roster API. Land + verify the contract is right before any UI consumes it. Unit/integration test for the new SQL path.
2. **Public roster page.** New `app/sectors/[id]/bots/page.tsx`. Consumes the extended API. Wire empty state, rate-limit soft view, profile + canvas links per row.
3. **Cross-link pass.** Add the "Bots" pill to the viewer's `TopNav` context slot. Add the "All bots on this sector →" link to the bot profile card.
4. **Owner namespace move.** File moves (`git mv` so blame survives), `revalidatePath()` updates, redirect-target updates in `app/signin/_auth-page.tsx`, link href updates in `app/account/page.tsx` + `src/components/top-nav.tsx`.
5. **Bare `/bots` redirect.** New `app/bots/page.tsx` returning a server redirect to `/sectors/sector-1/bots`.
6. **Validation.** `pnpm typecheck`, `pnpm lint`, `pnpm build`, audit grep for any stale `/bots` references that aren't `/bots/[handle]`-prefixed.

## Scope

### In Scope

- Public roster page at `/sectors/[id]/bots` rendering the API's existing fields + `last_pixel`.
- API extension to return `last_pixel: { x, y, color, palette_version }` per row (one SQL change, same index, no new aggregation pass).
- Owner control file move from `app/bots/` (excluding `[handle]/` subtree) to `app/account/bots/`, including `revalidatePath()` target updates.
- All five link/redirect updates listed in the table above.
- New `app/bots/page.tsx` that redirects to the public roster.
- "Bots" pill on the viewer's TopNav context slot linking to the roster.
- "All bots on this sector →" CTA on the bot profile card.
- Empty state + rate-limit soft view on the roster page.

### Out of Scope

- **Pixel counts, leaderboards, rankings.** Any "computed total / average / rank" data. The `last_pixel` extension stays in scope because it returns existing event row columns, not a new aggregation.
- **Multi-sector picker.** Sector is hardcoded to `sector-1` in the bare `/bots` redirect. When multi-sector ships, this redirect becomes the place to add the picker.
- **Pagination on the roster.** API ships unpaginated; bot count on sector-1 is single digits. M4-territory if the roster grows past a few thousand.
- **Profile-page restructure.** The bot profile card grows one new link; no other changes to that page.
- **Filtering / sorting controls on the roster.** No UI for changing sort order; the API's `last_seen_at DESC` is the default and only order for v1.
- **Per-bot pixel preview thumbnails.** The `last_pixel` extension shows the color swatch and coords as a chip, not a rendered "this is the canvas region they painted" thumbnail.
- **Owner control redesign.** The owner pages move from `/bots` to `/account/bots` but their UI is unchanged.
- **Auth-required roster.** The roster is public; no signed-in gate.
- **301 vs 307 split on the `/bots` redirect.** Both are correct for the redirect's purpose; Next's default for `redirect()` in a server component is 307, and that's fine.
- **Updating `/build/*` build docs.** The roster URL appears in [agents.ts:121](src/build-docs/content/agents.ts#L121) as an API reference, not a page URL, so it stays accurate. A docs update describing the new `last_pixel` field can come as a follow-up PR.

## Requirements

### Functional Requirements

- [ ] **F1.** `GET /api/v1/public/sectors/:id/bots` returns `last_pixel: { x, y, color, palette_version }` for every row.
- [ ] **F2.** `/sectors/[id]/bots` renders a public roster page server-side, no auth required.
- [ ] **F3.** Roster page shows, per bot: display name + handle + rate-tier Pill + last-seen relative time + description + last-pixel chip (color swatch + coords) + profile + canvas links.
- [ ] **F4.** Rows are sorted by `last_seen_at` descending (matches API default).
- [ ] **F5.** Sector-not-found path returns 404 (matches API behavior). Sector-exists-but-no-bots renders a centered empty-state Card with a "Build a bot →" link to `/build/quickstart`.
- [ ] **F6.** Rate-limit soft view renders a centered "Slow down" Card.
- [ ] **F7.** Owner control pages (the prior `/bots` page + private form components + server actions) live under `/account/bots`. Existing server-action behavior is preserved end-to-end (create / mint / revoke / edit / sign-out flows still work).
- [ ] **F8.** Bare `/bots` issues a server-side redirect to `/sectors/sector-1/bots`.
- [ ] **F9.** Sign-in / sign-up flows redirect signed-in users (and direct them post-OAuth) to `/account/bots`, not `/bots`.
- [ ] **F10.** Account page's "Manage bots →" CTA links to `/account/bots`.
- [ ] **F11.** Owner variant of `TopNav` links to `/account/bots` (the "Bots" entry).
- [ ] **F12.** Viewer `TopNav` (signed-in or signed-out) has a "Bots" Pill in the context slot linking to the current sector's roster.
- [ ] **F13.** Bot profile page has an "All bots on this sector →" link in the profile card (linking to `/sectors/<sector-id>/bots` using the sector from the most recent event; omitted if the bot has no events).

### Non-Functional Requirements

- [ ] **N1.** `pnpm typecheck`, `pnpm lint`, `pnpm build` all pass with zero new warnings.
- [ ] **N2.** No `style={{}}` color literals or hex literals introduced. Roster page consumes existing tokens only.
- [ ] **N3.** SQL query for the roster API uses the existing `(bot_id, created_at)` index — no new index, no new aggregation pass beyond what the query already does.
- [ ] **N4.** Existing server-action behavior under the moved `/account/bots/_actions.ts` is byte-for-byte identical to the prior `/bots/_actions.ts` (modulo the `revalidatePath()` target string).
- [ ] **N5.** No regression on the existing `/bots/<handle>` or `/bots/<handle>/canvas` URLs.
- [ ] **N6.** Mobile viewport (~390px) renders the roster without horizontal scroll; cards stack cleanly.

## Acceptance Criteria

- [ ] **A1.** `curl https://<preview>.vercel.app/api/v1/public/sectors/sector-1/bots` returns rows including the new `last_pixel` object. The values match the actual most-recent `PixelEvent` for that bot in that sector (verifiable by cross-checking with `/api/v1/public/bots/<handle>/events?limit=1`).
- [ ] **A2.** `/sectors/sector-1/bots` renders a card-per-bot list with all the fields in F3 visible. Day and Dusk themes both render correctly.
- [ ] **A3.** Clicking "View profile →" on a roster row navigates to that bot's `/bots/<handle>` page. Clicking "See their pixels →" navigates to `/bots/<handle>/canvas`.
- [ ] **A4.** Navigating to bare `/bots` lands on `/sectors/sector-1/bots` (the URL bar shows the redirected URL; not the same as bare `/bots` showing the roster content with `/bots` still in the bar).
- [ ] **A5.** Signed-in user lands on `/account/bots` after Google OAuth. Direct visit to `/account/bots` renders the prior owner control page unchanged.
- [ ] **A6.** Owner-control end-to-end exercise on the moved page: create bot → mint key → revoke key → edit description → create PAT → revoke PAT → sign out. All work; the "shown once" key reveal still renders on the sun-warning Card.
- [ ] **A7.** Viewer pages (`/` and `/sectors/sector-1`) show a "Bots" pill in the topnav context slot linking to `/sectors/sector-1/bots`.
- [ ] **A8.** Bot profile page (`/bots/<handle>`) shows the "All bots on this sector →" link inside the profile card.
- [ ] **A9.** `grep -rn '"/bots"\|/bots\b' app/ src/components/` returns only references to the prefixed `/bots/[handle]` routes, the new `/account/bots`, and the bare-redirect file — no stale `/bots` link targets remain.
- [ ] **A10.** `pnpm build` produces a Vercel-deployable artifact; preview URL renders every page in scope.

## Risks and Mitigations

- **R1: `revalidatePath("/bots")` references missed during the move.** Six instances in `_actions.ts` all need to flip to `/account/bots`. Easy to miss one — server actions would re-render stale data on mutation. **Mitigation:** explicit grep audit in step 4 of sequencing; verify A6's end-to-end exercise on preview.
- **R2: Last-pixel SQL change breaks the existing roster API contract.** The current query is a `GROUP BY` returning one row per bot; switching to `DISTINCT ON` / `ROW_NUMBER()` could regress field shapes (`last_seen_at` formatting, NULL handling for `description`). **Mitigation:** the test suite already covers the roster endpoint's existing fields; add a test for `last_pixel` shape; verify on preview that values match the source `PixelEvent` row.
- **R3: Bare `/bots` redirect breaks an external link.** Anything linking to `/bots` (docs, chat, Discord) lands on the public roster instead of the owner control. For external bot authors who bookmarked it, this is a worse landing. **Mitigation:** the new landing is a useful page (visitors see bots; click into one; sign up to make their own). The "I want to manage my bots" path is one click away (`/account` → `/account/bots`, or sign-in flow). Probably acceptable. If it isn't, follow-up by making the bare `/bots` redirect target conditional on auth state (`/account/bots` if signed in, `/sectors/sector-1/bots` otherwise) — but that's a small extension, not blocking.
- **R4: Cross-link to bot's "current" sector is wrong when the bot has painted multiple sectors.** Today there's only sector-1, so this is hypothetical. The link uses the bot's most recent event's sector. **Mitigation:** correct by definition (most recent = where they're active now). When multi-sector ships, this may need to become a per-sector link list, but that's a separate problem.
- **R5: Roster API extension increases response size meaningfully.** Adding `{ x, y, color, palette_version }` per row is ~30 extra bytes. On a roster of single-digit bots, this is negligible. **Mitigation:** none needed at current scale; revisit if rosters grow past hundreds.
- **R6: Empty-state on the roster reads as a 404.** "No bots have painted on this sector yet" + sector-1 has a single-digit roster from launch bots, so this state probably doesn't ship in production. But edge case for ephemeral sectors or future test sectors. **Mitigation:** copy is intentionally friendly + has a CTA; not a 404 page.

## Dependencies

- Design system tokens + primitives (already shipped via [#34](https://github.com/travisfischer/botplace/pull/34) and [#35](https://github.com/travisfischer/botplace/pull/35)). The roster page consumes `PageShell`, `TopNav`, `Card`, `Pill`, `Button` only.
- `lib/format-relative` for the "active 2h ago" timestamp rendering (already used on the bot profile activity feed).
- Existing `/api/v1/public/sectors/[id]/bots` route — extended in place, not replaced.
- No new packages.

## Validation Strategy

- **API contract test.** Add or extend the existing roster test to assert `last_pixel.x`, `last_pixel.y`, `last_pixel.color`, `last_pixel.palette_version` are present and match a known seeded PixelEvent.
- **Manual exercise on preview.** Walk every page in scope on a Vercel preview deploy in Day + Dusk:
  - `/sectors/sector-1/bots` — list shape, per-row fields, links work
  - `/bots` — confirm the redirect lands at the roster
  - `/account/bots` — confirm owner control still works end-to-end (the A6 checklist)
  - `/bots/<handle>` — confirm the new "All bots on this sector" link appears
  - `/` viewer — confirm the "Bots" pill is in the topnav
- **Grep audit.** Confirm no stale `/bots` references remain that should have been `/account/bots`.
- **Build + bundle.** `pnpm build` succeeds; no material bundle weight change (this is a small new page + a file move).
- **Mobile spot-check.** `/sectors/sector-1/bots` at ~390px viewport — cards stack cleanly, no horizontal scroll.

## Open Questions

None at locking time — all four decisions resolved in chat on 2026-05-20 and folded into the Resolved decisions section above. If something falls out during implementation, raise it as a follow-up doc, not by widening this requirement.

## Review checklist

To be filled in at review time per the AGENTS.md milestone-lifecycle convention. Reviewers should pull on at minimum:

- API contract: `last_pixel` matches the actual most-recent event row for each bot in that sector.
- File-move discipline: `git mv` used so blame survives; `revalidatePath()` targets all updated; no stale references.
- Link audit: every `/bots` reference is intentional (`/bots/<handle>` profile route or the bare redirect file).
- Page parity with the design system: only existing primitives consumed; no inline styles or hex literals.
- Server-action invariance: the moved `/account/bots/_actions.ts` behaves identically to the prior `/bots/_actions.ts`.
- Viewer non-regression: adding the "Bots" pill to the topnav doesn't disrupt the bleed layout or the canvas mount.

Per AGENTS.md, status flips `ready` → `shipped` on the merge PR for this work, with a sibling `shipped: <YYYY-MM-DD>` field added on the same branch.
