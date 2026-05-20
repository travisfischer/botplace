---
date: 2026-05-20
type: feat
topic: apply-nagai-design-to-pages
status: ready
planning_depth: comprehensive
---

# Requirement: Apply the Nagai design system to every existing page

## Status

Draft. Sister to the locked design-system spec at [`requirement-20260519-1500-nagai-design-system.md`](./requirement-20260519-1500-nagai-design-system.md), which built the token + primitive infrastructure and the `/styleguide` reference but explicitly deferred page application:

> _"Page-by-page application of the new design system. Each existing page is its own small redesign milestone; not bundled here. The viewer page in particular has rendering-pipeline concerns this requirement deliberately avoids."_

This requirement scopes the application work. It does **not** revisit token values, the mark, or the typography decisions — those are locked. It also does **not** migrate the canvas drawing palette to EDG8 (`paletteVersion: 2`); that remains a separately-sequenced milestone.

## Resolved decisions

All six open questions raised during planning were answered by Travis on 2026-05-20. Folded in below; the Open Questions section at the bottom is empty as a result.

1. **Viewer / canvas backdrop is theme-aware** (the area *around* the canvas frame, not the canvas's default pixel color). Day = warm sand; Dusk = deep indigo. The canvas content itself is unaffected — it's the indexed-color pixel data the renderer paints, and the canvas frame's warm near-black `--border` keeps pixel-edge contrast intact.
2. **Atmosphere illustrations are in scope on simple pages** (reversing the earlier "defer everything" lean). The simple pages — at minimum `/signin` / `/signup` and the `/account` empty-state moment — get an atmosphere treatment to carry the vibe. The design-system layer already ships banded-sky CSS gradients (`DAYTIME_SKY`, `SUNSET_SKY` in the styleguide) which are sufficient to land this without commissioning new art; per the design-system requirement, the implementer can also choose canvas-pixel-grammar or AI-explored pieces where they earn their place. Specific atmosphere choice per simple page is implementer discretion within the locked vocabulary.
3. **`/bots` mint-key flow stays inline**, no `Dialog`. Reveal-once warning lives on a `Card` (`variant="warning"` or equivalent ink-bordered surface) on the result render. `Dialog` is not added in this work — first introduce it when a flow actually needs modal semantics, not pre-emptively.
4. **Global footer on non-`bleed` pages.** Single line. Content: a "Made by Travis" credit + GitHub link. **No** version indicator. (The viewer pages, which use `PageShell variant="bleed"`, still omit the footer.)
5. **Viewer top nav is theme-aware**, same chrome as everywhere else. The "always-dark cockpit" alternative is rejected; one app, one chrome vocabulary.
6. **One PR, not five.** This is a cohesive redesign — splitting it into per-category PRs would create five reviews of half-rendered states. Pass 1 (shared chrome) and Pass 2 (per-page application) remain the **internal sequencing** within the single PR, but the merge unit is one. Reviewers see the whole redesign at once.

## Problem / Outcome

The token system, primitives, and `/styleguide` shipped in [#PR-nagai-system] but the rest of the app is still the pre-Nagai chrome: native list bullets, system-ui sans, hard-coded `#0e0e16` and `#dcf5ff` hexes inline on every page, native `<button>` elements, hand-rolled border + padding values per page. A bot author signing in from the styleguide hits a wall of unstyled HTML the moment they leave that one route.

The desired outcome:

1. Every existing page in the app — viewer, auth, owner-control, public bot pages, docs — uses Nagai tokens, primitives, and shared chrome. Day and Dusk both render correctly.
2. The chrome users hit most often (top nav, page frame, button, card, pill, link) reads as one app, not six. Visual consistency across `/`, `/bots`, `/build`, `/account`, `/sectors/sector-1` is a hard requirement.
3. Most pages also get **structural** work — not just re-coloring. The bot owner page (`/bots`) is currently an HTML-1.0 demo of nested `<ul>` and inline forms; the account page is two lines of text under an `<h1>`; the viewer pages have one-line "Botplace" wordmarks where the real `Wordmark` component now exists. The application pass is the moment to fix structure too.
4. No inline hex literals or `style={…}` color values survive in `app/` or `src/components/` outside `app/globals.css` and `app/icon.svg`. (The viewer canvas internals — `src/viewer/canvas.tsx`, `chunk-cache`, the BPSS reader — are content rendering and remain hex-driven from the active canvas palette.)

This is not a redesign-from-zero. The design system is the constraint; per-page work is *consuming* the system, not inventing alternatives.

## Approach

### Two-pass strategy: extract shared shells first, then apply per page

A naïve "rewrite each page" sweep would re-invent the top nav six times and produce six subtly different headers. Avoid that by sequencing the work in two passes:

**Pass 1 — Extract shared chrome.** Before touching any single page, build the chrome that recurs across categories. These are the parts every page wants and currently re-invents:

- **`TopNav`** — wordmark on the left, contextual links (Build / Account / Sign up / canvas back-link), `ThemeToggle` on the right. Used by viewer pages, the owner-control pages, the docs layout, and the public bot pages. Replaces six inline `<header>` blocks.
- **`PageShell`** — page-frame wrapper. Variants: `narrow` (~720px, used by docs / palette / bot-profile / auth), `wide` (~1080px, used by owner-control / styleguide), `bleed` (full-viewport, used by the viewer). Owns top/bottom padding, max-width, and the surface-on-bg contrast.
- **`Footer`** — single small footer (GitHub link, `/build` link, theme indicator) rendered by `PageShell` on non-bleed pages. The viewer pages omit it.
- **Form primitives** — `Input`, `Label`, `Textarea`, `FormRow`, plus a `SubmitButton` that wires the existing server-action pattern to the `Button` primitive. Owner-control pages need these immediately.
- **Data primitives** — `DataList` (key / value rows) and a tiny `Table` (header row + striped surface rows). Used by `/bots` for the API-key + PAT lists.

**Pass 2 — Apply per page.** With shared chrome in place, each page becomes "drop the layout, structure the content, swap inline styles for utility classes." Pages are migrated in dependency order (least-coupled first), but a single PR may bundle multiple pages in the same category once the category's shell is settled.

### Category map

Every page falls into one of five categories. Categories share a shell; pages within a category share most chrome and differ only in content.

| Category | Pages | Shell | Notes |
|---|---|---|---|
| **Viewer** | `/`, `/sectors/[id]`, `/bots/[handle]/canvas` | `PageShell variant="bleed"` + `TopNav` + full-bleed `SectorViewer` | Canvas backdrop is `--bg`-tinted, not pure-black. Top nav is theme-aware, not always dark. |
| **Auth** | `/signin`, `/signup` | `PageShell variant="narrow"` + center `Card` + atmosphere panel | Single Google button, single tagline. Atmosphere panel is **required** here (banded-sky gradient, sunset register by default — same fragment as `/styleguide`'s atmosphere section). |
| **Owner control** | `/account`, `/bots` | `PageShell variant="wide"` + `TopNav` + section cards | Most structural lift. Native `<ul>`/inline forms → `Card` + `DataList` + `Table` + form primitives. |
| **Public bot** | `/bots/[handle]` | `PageShell variant="narrow"` + `TopNav` + profile header + activity list | Already mid-shape; lift to tokens + restructure activity feed rows as token-driven `Card` items. |
| **Docs** | `/build`, `/build/[slug]`, `/palettes/[version]` | `PageShell variant="narrow"` + docs `TopNav` (with build-page tabs) + markdown prose styling | Currently the most cohesive group (all dark, all `#0e0e16`); needs the most token swaps but least structural change. |

`/styleguide` is **excluded** — it's the reference surface and shouldn't be touched as part of application work. Anything added to the system to support page application gets a corresponding section appended to `/styleguide` so the reference stays current.

### shadcn primitives to add

The system shipped with `button`, `card`, `pill`. The application pass needs:

- `input` — text input for forms (display name, description, PAT name)
- `label` — pairs with input
- `textarea` — description editing
- `separator` — section dividers in owner-control pages
- `table` — bot/PAT/key lists
- `dialog` (deferred to first use) — confirm-revoke and "your key" reveal flows
- `tooltip` (deferred to first use) — hover-on truncated tokens, rate-tier indicators

Added on demand via `pnpm dlx shadcn@latest add <name>`, re-skinned with tokens, and exercised on `/styleguide`. Per the design-system requirement's locked discipline: no hex literals in component JSX.

### What "structure" means on each page

For each page below, "Current" lists today's shape (audit fact). "Target" lists the resulting shape after this work. "Structural" is the lift beyond color swaps.

#### `/` and `/sectors/[id]` (viewer)

- **Current** (`src/viewer/viewer-page.tsx`): `<main>` with inline `shellStyle` (cold `#0a0a0a` header, `#dcf5ff` text, `#000` canvas backdrop, system-ui font), `<strong>Botplace</strong>` plain text wordmark, `Build` / `Account` / `Build a bot` text links bordered by `1px solid #2a2a2a`.
- **Target**: `PageShell variant="bleed"` + `TopNav` (real `Wordmark` component on the left, contextual links + `ThemeToggle` on the right) + full-bleed `SectorViewer` below. Canvas backdrop tinted `--bg` (Day) / `--surface` (Dusk) — pixels still pop because the system layer's warm near-black border around the canvas frame, plus the atmosphere-layer's flat-shadow rule, keep the canvas focused. The sector name moves from inline `opacity: 0.6` text into a `Pill` next to the wordmark.
- **Structural**: extract `TopNav` so the bot-filtered canvas page reuses it; drop the always-dark chrome; surface the sector name as a pill rather than parenthetical text.

#### `/bots/[handle]/canvas` (bot-filtered viewer)

- **Current**: parallel implementation of the viewer shell — its own inline `shellStyle`, `headerStyle`, `linkStyle`, `canvasShellStyle` (also `#0a0a0a`/`#dcf5ff`/`#000`), back link reads `← @handle`.
- **Target**: same `TopNav` + `PageShell variant="bleed"` as the main viewer, with a "filtered" affordance: the wordmark area gets a `Pill variant="accent"` reading `"@handle's canvas"` so it's obvious this is not the full canvas. Back link is a real `Button variant="ghost"` to `/bots/[handle]` with a left arrow.
- **Structural**: collapse the duplicate header implementation into `TopNav`'s `mode="filtered"` variant; the "Slow down" rate-limited soft view becomes a centered `Card`.

#### `/signin` and `/signup` (auth pages)

- **Current** (`app/signin/_auth-page.tsx`): `<main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>`, plain `<h1>` and a native `<button type="submit">`. Identical bodies (the duplicate is intentional per the inline comment).
- **Target**: `PageShell variant="narrow"` + `TopNav` (minimal — just wordmark + theme toggle, no Build/Account links) + a centered `Card` containing `Wordmark size="lg"`, a one-line tagline, a `Button variant="primary"` server-form for Google sign-in, and a tiny `text-muted` line linking to `/build` and the GitHub repo. Behind / above the card sits an **atmosphere panel** (banded-sky gradient — sunset register by default, swapping to daytime in Day theme or vice-versa is implementer discretion). The two routes still share `AuthPage`; nothing else about the duplication changes.
- **Structural**: card-based focal layout instead of full-page form; explicit "use vs. build" cross-link; first real-page use of the atmosphere layer.

#### `/account`

- **Current**: `<main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>` with one `<h1>Account</h1>`, the user's email as raw text, a `Manage bots` link, a `Sign out` native button. Total LoC: ~50.
- **Target**: `PageShell variant="wide"` + `TopNav` + a single `Card` with two `DataList` rows (email, sign-in provider) and a `Button variant="ghost"` "Sign out" wired to the same server action. Add a "Manage bots →" CTA `Button variant="primary"` since `/bots` is what users came here to find. The page is otherwise sparse — an atmosphere accent (a thin banded-sky strip above the card, or a small atmosphere card to the side) is welcome here for the same "carry the vibe on simple pages" reason as auth; treatment is implementer discretion.
- **Structural**: presentational lift, no new functionality.

#### `/bots` (owner-control)

- **Current**: the most under-styled real page in the app. `<main>` → `<h1>Bots</h1>` → inline `CreateBotForm` (form with native inputs) → `<section>` with `<h3>Your bots</h3>` and a native `<ul>` of native `<li>` items, each containing a nested `<ul>` of API keys, each key with its own inline form. Inline hex hints (`color: "#666"`, `color: "#888"`). `CreatePatForm` repeats the same shape for personal access tokens.
- **Target**: `PageShell variant="wide"` + `TopNav` + two sectioned regions, each a `Card`:
  - **Bots section**: section header + `Button variant="primary"` "Add a bot" (opens an inline form or a `Dialog` — see Open Questions). Each bot rendered as a `Card variant="nested"` with its display name as `font-display`, the `@handle` and bot-id `code` underneath, the rate-tier as a `Pill`, the description (editable) below, and an API-keys `Table` (prefix, status, last-used, action) followed by a "Mint another key" button.
  - **Personal access tokens section**: same pattern as the API-keys table, top-level (PATs aren't nested under a bot).
- **Structural**: heaviest lift. Replaces nested-`<ul>` + inline-form structure with `Card`-and-`Table` structure; consolidates the four `_create-*-form.tsx`, `_edit-description-form.tsx` client components into the form-primitive vocabulary. Existing server actions in `app/bots/_actions.ts` are unchanged — only their wrappers change.

#### `/bots/[handle]` (public bot profile)

- **Current**: `<main style={{ maxWidth: 720, margin: "0 auto", padding: "1.5rem 1rem" }}>` — already narrow-centered, which is right. Inline back-link bar, then a `<header>` with `border-bottom: "1px solid #ddd"` containing display name, `@handle` `code`, rate-tier, joined/last-seen relative timestamps, description. Below: `<section>` with an `ActivityFeed` (client component) rendering pixel events as `<li>` rows with inline color swatch + coords + comment + relative time.
- **Target**: `PageShell variant="narrow"` + `TopNav` (with public-side links: Build / Sign up) + a `Card` for the profile header (wordmark-scale display name in `font-display`, `Pill` row for `@handle` / tier / joined / last-seen, description in body text) + the activity feed below restyled with token-driven row styling and the existing swatch rendered against `--border` rather than `#999`. "Slow down" rate-limit view becomes a centered `Card`.
- **Structural**: lift the header into a proper `Card`; restyle activity rows to read as a single tabular surface, not free-floating `<li>` items; rate-limit soft view as a real `Card` instead of raw text.

#### `/build` and `/build/[slug]` (docs)

- **Current** (`app/build/layout.tsx` + `app/build/page.tsx` + `app/build/[slug]/page.tsx`): hard-coded dark theme (`#0e0e16` bg, `#dcf5ff` text), inline `SHELL_STYLE`/`FRAME_STYLE`/`NAV_STYLE`, `#508cd7` blue links, native `<ul>` index. Layout has a sticky top nav of build pages + a "Copy as markdown" client button. Markdown rendering in `MarkdownContent` is currently un-styled.
- **Target**: replace inline-styled shell with `PageShell variant="narrow"` + a docs-specific `TopNav` variant that exposes the build pages as a tab-style nav (the current implementation already shows them; lift it into the shared component as `TopNav mode="docs"`). Markdown prose gets token-driven typography: `prose-display` headings, `font-mono` code, `--surface` code-fence backgrounds with `--border` ink borders, `--brand` link color. `CopyMarkdownButton` becomes `Button variant="neutral" size="sm"` with the existing client-side copy logic untouched.
- **Structural**: smallest lift of the bunch (these pages already have *some* structure); main work is markdown-prose styling and converting the hard-coded dark to theme-aware.

#### `/palettes/[version]`

- **Current**: dark theme (`#0e0e16` bg), inline `PAGE_STYLE`/`FRAME_STYLE`, custom `contrastingColor()` luminance computation for text on a swatch, palette rows as `<div role="listitem">` with inline backgrounds and borders, pill-styled inline `<code>`.
- **Target**: `PageShell variant="narrow"` + docs `TopNav` (this page sits in the build docs' orbit semantically — clicking a pixel in the viewer lands here). Palette rows become `Card` items with the swatch as a flat-shadow-elevated tile on the left, name + description + hex + index as right-side content. The `contrastingColor()` helper stays — it's content-aware logic that the design system shouldn't try to replace. The example `POST /api/v1/pixels` block uses the docs prose's `<pre>` styling. Color-index anchors (`#color-N`) preserved — the viewer's pixel-inspect overlay deep-links here.
- **Structural**: lift palette rows from inline-styled divs to `Card`s; align with docs prose.

#### The viewer's `PixelInspectBox` overlay (in-canvas chrome, but UI not content)

Not a page, but it sits over the canvas as system-layer chrome and is currently styled with `position: absolute; background: rgba(...)` inline. The application pass restyles it to use `--surface`, the flat-shadow rule, and `Button` for its close/inspect-events controls. Listed here because it's user-visible UI; the underlying click-to-inspect logic doesn't change.

### Token + style discipline

The design-system requirement's locked rule applies here too: **no inline hex literals or `style={{ color: ..., background: ... }}` in any page or component touched by this work**. The grep target on completion is zero color-token hexes in `app/` and `src/components/` (excluding `app/globals.css` and `app/icon.svg`).

Inline geometry (`padding`, `gap`, `margin`) should also migrate to utility classes where the value maps to a Tailwind scale step; arbitrary geometric values that don't map to a step are acceptable as `style={{}}` but should be rare.

### Sequencing

One PR, internally phased. The work is a cohesive redesign — splitting it into per-category PRs would create five reviews of half-rendered states and a long stretch where the app reads as half-Nagai / half-legacy. The merge unit is one; the **internal** sequencing below is for the implementer's working order, not separate review checkpoints.

1. **Phase 1 — Shared chrome.** `TopNav` (all variants), `PageShell`, `Footer`, form primitives, `DataList`, `Table`. Adds them to `/styleguide`. Touches zero existing pages yet, but lives on the same branch as everything else.
2. **Phase 2 — Auth + Account.** Smallest pages, tightest content, lowest risk. Includes the first atmosphere-panel application.
3. **Phase 3 — Docs (`/build`, `/build/<slug>`, `/palettes/<version>`).** Cohesive group, all narrow. Resolves the prose styling pattern.
4. **Phase 4 — Public bot profile + bot-filtered canvas.** Public-side, lower edit volume.
5. **Phase 5 — Viewer pages (`/`, `/sectors/[id]`).** Most-watched surface. Settles the theme-aware viewer chrome on the real canvas.
6. **Phase 6 — Owner control (`/bots`).** Biggest single-page lift. Lands last so all primitives (especially `Table`, form primitives, `Card variant="nested"`) are battle-tested.

One PR + one review doc, per AGENTS.md milestone-lifecycle convention. The reviewer pulls on the full redesign at once; the phased commit history makes it possible to walk the work in order during review.

### What stays out of this work

- **Canvas drawing palette migration to EDG8 (`paletteVersion: 2`).** Sequenced separately per the design-system requirement; touches `src/palettes/`, M2.5 seed scripts, and stored pixel data — different risk surface.
- **Commissioned atmosphere art.** Atmosphere panels on simple pages (auth, account) are **in scope** — but only using what the design system already ships (banded-sky CSS gradients in the styleguide's atmosphere section, optionally a canvas-pixel-grammar mini-scene the implementer can produce in-house). Commissioning or AI-generating bespoke per-page illustrations is per-piece work that lives outside this requirement; the application pass uses what's already available.
- **Multi-sector UI.** The viewer already supports `/sectors/[id]` with a sector-1 hardcode in production; adding a sector picker is a separate feature, not a design-system application.
- **New product surfaces** — a marketing landing page (e.g. moving `/` to a hero-then-canvas-preview), a leaderboard, a bot directory. The current `/` is the canvas; this work preserves that.
- **Accessibility audit beyond contrast.** The design system already met WCAG AA contrast; this work re-uses tokens, so contrast is preserved by construction. A keyboard-nav / screen-reader audit is its own milestone.
- **Mobile redesign.** Pages must remain mobile-usable (no regressions), but a mobile-first redesign (sheet navigation, touch-target audit, viewer gesture polish) is not in scope.
- **The viewer's canvas rendering pipeline.** `src/viewer/canvas.tsx`, `chunk-cache`, `pan-zoom`, the BPSS reader, the polling loop — none of this changes. The application pass touches viewer **chrome**, not viewer **content**.

## Scope

### In Scope

- Building shared chrome primitives: `TopNav`, `PageShell`, `Footer` (global, single-line, "Made by Travis" + GitHub link, no version indicator), form primitives (`Input`, `Label`, `Textarea`, `FormRow`, `SubmitButton`), `DataList`, `Table`.
- Adding shadcn primitives `input`, `label`, `textarea`, `separator`, `table` (and `tooltip` if a page in scope demands it). `dialog` is **not** added in this work.
- Re-skinning every existing page listed in the category map to consume those primitives + Nagai tokens.
- Re-skinning the viewer's `PixelInspectBox` overlay.
- Restructuring `/bots` from nested-`<ul>` to a `Card` + `Table` shape; mint-key reveal stays inline (no dialog).
- Restructuring `/account`, `/signin`, `/signup`, `/bots/[handle]` from inline-styled `<main>` blocks to `PageShell`-based layouts.
- Atmosphere panel on `/signin` and `/signup` (required); optional atmosphere accent on `/account` at implementer discretion. Implementation uses the banded-sky gradient fragments already shipping with `/styleguide`'s atmosphere section, or a canvas-pixel-grammar mini-scene the implementer can produce in-house — no commissioned art.
- Migrating `/build`, `/build/[slug]`, `/palettes/[version]` from hard-coded dark to theme-aware token-driven styling.
- Theme-aware viewer chrome and canvas backdrop (the area around the canvas frame, not the canvas's default pixel color).
- Restyling markdown prose in the build docs.
- Updating `/styleguide` to include every new shared component (so the reference stays current).
- Confirming Day + Dusk render correctly on every page.

### Out of Scope

- EDG8 canvas drawing palette migration.
- Commissioned or AI-generated bespoke atmosphere art beyond what already ships in the design system. (Atmosphere *panels* on simple pages are in scope; their *content* is the existing banded-sky CSS gradients or implementer-produced canvas-pixel-grammar — not commissioned pieces.)
- Sector picker / multi-sector navigation UI.
- Marketing landing page or any new public surface.
- Keyboard-nav / screen-reader accessibility audit beyond what the primitives provide.
- Mobile-first redesign.
- Viewer canvas rendering internals.
- The canvas's default pixel color (the indexed-color content the renderer paints) — only the area *around* the canvas frame is theme-aware.
- `Dialog` primitive (deferred; first introduced when a flow actually needs modal semantics).
- Re-skinning admin endpoints (operator-only HTTP surface; not user-facing).
- Token-value revisions (locked in the design-system requirement).

## Requirements

### Functional Requirements

- [ ] **F1.** `TopNav` component renders the `Wordmark`, contextual links, and `ThemeToggle`. Has variants for `viewer` (Build / Account or Sign up + theme toggle), `docs` (build-page tabs + ← canvas link + theme toggle), `owner` (Account / Sign out via server action + theme toggle), and `minimal` (wordmark + theme toggle only, for auth pages).
- [ ] **F2.** `PageShell` component wraps a page with consistent top/bottom padding and max-width. Variants: `narrow` (~720px), `wide` (~1080px), `bleed` (no max-width, full viewport, flex column for viewer pages).
- [ ] **F3.** `Footer` component renders a small single-line global footer on `narrow` and `wide` shells; content is a "Made by Travis" credit + GitHub link (no version indicator, no other content). Omitted on `bleed`.
- [ ] **F4.** Form primitives `Input`, `Label`, `Textarea`, `FormRow`, `SubmitButton` exist and are used by every form in scope (create-bot, create-PAT, edit-description, sign-in, sign-out, mint-key, revoke-key, revoke-PAT).
- [ ] **F5.** `DataList` (key/value row component) and a tiny `Table` component (header row + striped surface body) exist and are used on `/bots` and `/account`.
- [ ] **F6.** `/` and `/sectors/[id]` render the viewer with `TopNav variant="viewer"` (theme-aware chrome, not always-dark) and a theme-aware backdrop in the area around the canvas frame (no hard-coded `#000`). The canvas content itself — the indexed-color pixel data — is unchanged.
- [ ] **F7.** `/bots/[handle]/canvas` renders the filtered viewer with `TopNav variant="viewer" mode="filtered"`, including an accent-pill indicator that this is a filtered view.
- [ ] **F8.** `/signin` and `/signup` render via `PageShell variant="narrow"` with a centered card and a banded-sky atmosphere panel (the same fragment shipped in `/styleguide`'s atmosphere section, either register); both routes still target `/bots` post-auth (unchanged).
- [ ] **F9.** `/account` renders via `PageShell variant="wide"` with a single account card and a primary "Manage bots →" CTA.
- [ ] **F10.** `/bots` renders via `PageShell variant="wide"` with section cards for bots and PATs, each with token-driven tables and form-primitive forms.
- [ ] **F11.** `/bots/[handle]` renders via `PageShell variant="narrow"` with a `Card`-wrapped profile header and a token-driven activity feed.
- [ ] **F12.** `/build` and `/build/[slug]` render via `PageShell variant="narrow"` + `TopNav variant="docs"`; markdown prose uses token-driven typography (`font-display` headings, `font-mono` code, `--brand` links, `--surface` code blocks).
- [ ] **F13.** `/palettes/[version]` renders via `PageShell variant="narrow"` + `TopNav variant="docs"` with palette rows as `Card` items; `#color-N` anchors preserved.
- [ ] **F14.** The viewer's `PixelInspectBox` overlay restyled with `--surface`, the flat-shadow rule, and `Button` primitives.
- [ ] **F15.** `/styleguide` includes a section for every new component added in this work.
- [ ] **F16.** Every page in scope renders correctly in both Day and Dusk themes; the user's chosen theme persists across navigation (already true via `next-themes`).

### Non-Functional Requirements

- [ ] **N1.** Zero hex literals or color-`style={{}}` values in `app/` and `src/components/` after this work, excluding `app/globals.css`, `app/icon.svg`, the canvas rendering internals under `src/viewer/canvas.tsx` and `src/viewer/chunk-cache.ts`, and the canvas drawing-palette definitions under `src/palettes/`. Verified by grep on completion.
- [ ] **N2.** `pnpm build`, `pnpm typecheck`, and `pnpm lint` pass with no new warnings.
- [ ] **N3.** No regressions in viewer rendering performance (canvas paint loop unchanged).
- [ ] **N4.** No regressions in server-action behavior on `/bots` (create/mint/revoke/edit flows still work).
- [ ] **N5.** Mobile viewport (~390px wide) renders every page without horizontal scroll; viewer pan/zoom gestures still work.
- [ ] **N6.** WCAG AA contrast preserved on every page in both themes (verified via spot-checks against tokens; tokens already meet AA per the design-system requirement).
- [ ] **N7.** No additional dependencies beyond shadcn primitives added on demand. No design-system rewrite or vendor swap.

## Acceptance Criteria

- [ ] **A1.** Walking from `/` → `/signin` → `/bots` → `/bots/[handle]` → `/build` → `/palettes/1` in both Day and Dusk feels like one app, not six. The viewer chrome reads as part of the same vocabulary (theme-aware), not as a separate always-dark "cockpit." (Manually verified; reviewer signs off.)
- [ ] **A2.** `grep -rn "#[0-9a-fA-F]\{3,6\}" app/ src/components/ --include="*.tsx"` returns zero results except for `app/icon.svg` (the favicon SVG, which is allowed to contain hexes).
- [ ] **A3.** `grep -rn "style=" app/ src/components/ --include="*.tsx"` returns only `style={{}}` instances that contain non-color geometry values (gradient backgrounds in atmosphere fragments, dynamic widths/transforms) — no `color:`, `background:`, `borderColor:` literals.
- [ ] **A4.** `/styleguide` renders the new shared components (`TopNav`, `PageShell`, form primitives, `DataList`, `Table`) in both Day and Dusk.
- [ ] **A5.** Every existing server action in `app/bots/_actions.ts` still works end-to-end: create bot → mint key → revoke key → edit description → create PAT → revoke PAT → sign out. Manually exercised on a preview deploy.
- [ ] **A6.** Viewer pages (`/`, `/sectors/sector-1`, `/bots/conway/canvas`) render the canvas correctly with no regressions in pan, zoom, click-to-inspect, debug grid (`?debug`), or the polling loop's manifest cycle.
- [ ] **A7.** Markdown prose on `/build/quickstart` (and every other `/build/<slug>`) renders with `font-display` headings, `font-mono` code, `--brand` links, `--surface` code fences. The `/agents.md` aggregator and `/api/build-md/<slug>` raw-markdown endpoint are unaffected (they don't render HTML).
- [ ] **A8.** `pnpm build` produces a Vercel-deployable artifact; preview deploy URL is reachable and visually matches the spec on each page.
- [ ] **A9.** Page weights don't increase materially (within ±10% of pre-work bundle size for any individual route segment).
- [ ] **A10.** The bot-filtered canvas (`/bots/[handle]/canvas`) shows a clear accent-pill affordance making it obvious to a visitor that they're looking at a filtered view.

## Risks and Mitigations

- **R1: Shared chrome diverges from per-page needs.** Building `TopNav` / `PageShell` in Phase 1, then discovering in Phase 5 (viewer) that the chrome can't accommodate a full-bleed canvas. **Mitigation:** the implementer walks `TopNav` / `PageShell` against every category in the map (auth, owner, docs, public-bot, viewer) at Phase 1 before moving on. Variants are explicit in F1/F2. Since this is one PR, late discovery just means iterating the chrome on the same branch — no cross-PR coordination cost.
- **R2: `/bots` restructure regresses a server-action flow.** The current page works; reshaping it into `Card` + `Table` could miss an edge case (e.g. revoking a key while a mint is in flight, or the description-edit optimistic update). **Mitigation:** the server actions in `app/bots/_actions.ts` don't change at all — only their UI wrappers do. Manual end-to-end exercise on preview deploy is in A5.
- **R3: Viewer canvas backdrop change degrades pixel contrast.** Moving from `#000` to `--bg` (warm sand) reduces contrast for dark canvas pixels. **Mitigation:** the canvas frame itself stays at maximum contrast (warm near-black `--border` around the canvas area); only the outside-the-canvas viewport area changes. If pixel contrast still suffers, the canvas backdrop can remain "atmosphere dark" via a separate `--viewer-bg` token without breaking the rest of the system.
- **R4: Theme toggle creates a flash-of-wrong-theme.** `next-themes` is already wired and the styleguide has confirmed no flash; risk is that adding it to the viewer's full-bleed shell exposes a hydration race. **Mitigation:** `suppressHydrationWarning` is already set on `<html>` in `app/layout.tsx`; verify on each new page after migration.
- **R5: shadcn primitives bring more than we want.** Adding `dialog` or `tooltip` pulls Radix peer deps; these should only be added when first needed. **Mitigation:** primitives added on demand, not bulk-imported. Listed in "deferred to first use" in the Approach.
- **R6: Markdown prose styling clobbers content semantics.** The build pages render LLM-targeted markdown; if the styling makes copy-paste fragile (e.g. CSS that screws up the actual text content), we hurt the primary use case. **Mitigation:** styling is purely CSS class additions on rendered HTML; the raw markdown source served by `/api/build-md/<slug>` is unaffected and remains the source of truth for agent ingestion.
- **R7: One-PR redesign concentrates review burden.** Bundling the whole redesign means one large diff and one big visual walk-through. **Mitigation:** the implementer commits phase-by-phase (chrome → auth/account → docs → public bot → viewer → owner) so the branch's commit history walks the work in order. Reviewers can read commits as if they were the discarded per-PR sequence without paying the cross-PR coordination cost. Phase-boundary commits are flagged in the PR description so the reviewer can step through them.
- **R8: Atmosphere panel on auth pages reads as too loud.** First real-page use of the atmosphere layer; risk it overwhelms the sign-in card. **Mitigation:** start with a thin (~40–60vh on desktop, smaller on mobile) banded-sky panel — not full-bleed. If still too loud, fall back to a sky strip above the card (~120px) or a sky-tinted card border. Treatment is implementer discretion within those bounds.

## Dependencies

- `requirement-20260519-1500-nagai-design-system.md` — must be merged + shipped before this requirement's work starts. Tokens, primitives (`Button`, `Card`, `Pill`), `Mark`, `Wordmark`, `ThemeToggle`, and `/styleguide` must exist.
- shadcn CLI configured per `components.json`. Each `pnpm dlx shadcn@latest add <name>` invocation adds a primitive to `src/components/ui/`.
- Existing server actions and business-logic modules unchanged: `app/bots/_actions.ts`, `auth.ts`, `src/bots/*`, `src/auth/pat.ts`. UI re-skin only.

## Validation Strategy

- **Visual walk-through.** Reviewer navigates every in-scope page on a preview deploy in Day and Dusk, checks against the `/styleguide` for token usage, and against the category map for structural consistency.
- **Grep discipline.** `pnpm lint` runs cleanly; manual grep for hex literals and color-`style={{}}` returns zero results (A2, A3).
- **Functional exercise.** A5's server-action checklist run on preview: create bot → mint key → revoke key → edit description → create PAT → revoke PAT → sign out. Then the public flow: open `/bots/<minted-handle>`, walk the activity feed, click into `/bots/<handle>/canvas`, return to `/`.
- **Viewer regression.** A6's viewer interactions checked on a preview: pan, pinch-zoom (mobile), wheel-zoom (desktop), click-to-inspect, `?debug` grid, the manifest poll cycle (a fresh pixel write should appear within ~1s). The chrome change must not perturb any of this.
- **Bundle size.** `next build` output's per-route page weights compared before/after; any route up >10% gets investigated.
- **Mobile spot-check.** Each page opened in Chrome devtools at 390px width — no horizontal scroll, viewer pan/zoom functional, forms usable.
- **Theme-toggle FOIT test.** Hard-reload each page in both themes; no flash of the wrong theme on initial paint.

## Open Questions

None at locking time — the six questions raised during planning are answered in "Resolved decisions" near the top. If something falls out during implementation that needs a real decision (e.g. the atmosphere panel on auth reads as too loud and a fallback treatment is needed), raise it via a small follow-up doc, not by widening this requirement.

## Review checklist

To be filled in at review time per the M0/M1/M2/M2.5 review-doc convention. One review doc, one PR. Reviewers should pull on at minimum:

- **Token discipline** — grep results clean (A2, A3).
- **Shared-chrome ergonomics** — does `TopNav` accommodate every category cleanly, or did one page invent a one-off variant?
- **Per-page structural correctness** — does `/bots` actually feel usable, not just styled? Does `/account` give the user a clear next action? Do auth pages with the atmosphere panel still read as "sign in here," not "marketing splash"?
- **Theme parity** — Day and Dusk both render every page correctly with no per-component overrides. The viewer chrome reads as part of the app, not as a separate always-dark mode.
- **Server-action / business-logic invariance** — the UI lift didn't accidentally touch the underlying mutation paths in `app/bots/_actions.ts`, `auth.ts`, or business-logic modules.
- **Viewer non-regression** — pan/zoom/click-to-inspect/`?debug`/polling unaffected.
- **Markdown prose readability** — `/build/<slug>` reads well as docs, agent-ingest path (the `/agents.md` and `/api/build-md/<slug>` raw text) unaffected.
- **Atmosphere-panel weight** — the auth-page banded-sky panel doesn't overwhelm the sign-in card; fallback treatment used if needed (see R8).
- **`/styleguide` currency** — every new component added has a section on the styleguide.

Per AGENTS.md, status flips `draft` → `shipped` on the merge PR for this work, with a sibling `shipped: <YYYY-MM-DD>` field added on the same branch.
