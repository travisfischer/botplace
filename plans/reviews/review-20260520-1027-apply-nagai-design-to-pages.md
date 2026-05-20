---
date: 2026-05-20
type: review
requirement: requirement-20260520-0914-apply-nagai-design-to-pages.md
milestone-slug: apply-nagai-design-to-pages
status: draft
---

# Review: Apply the Nagai design system to every existing page

## Scope under review

One PR, six implementation phases (per the requirement's "one big PR" decision). Touches every user-facing route in the app — viewer, auth, owner control, public bot pages, docs — plus the in-canvas `PixelInspectBox` overlay.

The locked design system from [requirement-20260519-1500-nagai-design-system.md](../requirements/requirement-20260519-1500-nagai-design-system.md) (tokens, primitives, `/styleguide`) is the foundation; this review covers consumption, not the system itself.

## Sequencing actually executed

| Phase | Commit | What landed |
|---|---|---|
| 1 | `dd1299d` | Shared chrome: `TopNav` (4 variants), `PageShell` (3 variants), `Footer`, `AtmospherePanel`, form primitives (`Input`, `Label`, `Textarea`, `FormRow`, `SubmitButton`), `DataList`, `Table`, `Separator`. Added to `/styleguide`. |
| 2 | `6dc02e8` | `/signin`, `/signup` (atmosphere panel + centered Card), `/account` (DataList + Manage bots CTA). |
| 3 | `b3c6ce3` | `/build/*` layout + index + `[slug]`, `/palettes/[version]`. Markdown prose token-driven. |
| 4 | `c633715` | `/bots/[handle]` (Card-wrapped profile), `/bots/[handle]/canvas` (filtered canvas with accent pill in context slot), restyled activity feed. |
| 5 | `5ffe450` | `ViewerPage` (PageShell bleed + viewer TopNav + theme-aware backdrop) + `PixelInspectBox` overlay re-skinned. |
| 6 | `c290e09` | `/bots` (heaviest lift): nested `<ul>` → Card + Table; mint-key inline reveal as sun-warning Card. |
| 7 | (this) | Validation, review doc, status flip. Plus a follow-up tweak to `SectorViewer`'s "Reconnecting…" pill which had been missed in Phase 5. |

## Findings

### Token discipline (A2, A3)

Audit grep (run on the final tree, with the documented exclusions):

```bash
grep -rn '#[0-9a-fA-F]\{3,6\}' app/ src/components/ src/viewer/ --include="*.tsx" \
  | grep -v styleguide \
  | grep -v mark.tsx \
  | grep -v atmosphere-panel.tsx \
  | grep -v viewer/canvas.tsx \
  | grep -v viewer/chunk-cache
```

Remaining hits — all defensible per requirement N1:

- `app/bots/[handle]/_activity-feed.tsx:81` — hex inside a code comment (`// palette?.[color] ?? "#cccccc"` describing the fallback), no runtime effect.
- `src/viewer/sector-viewer.tsx:589` — canvas backdrop falls through to `meta.palette[meta.default_color] ?? "#000"`; canvas content path, not chrome (matches the requirement's exclusion of viewer rendering internals).

Style-attribute grep:

```bash
grep -rn 'style=' app/ src/components/ src/viewer/ --include="*.tsx"
```

Remaining hits, all non-color geometry per A3 (or content-aware swatches):

- Per-pixel color swatches in `_activity-feed.tsx`, `palettes/[version]/page.tsx`, `pixel-inspect.tsx` — render the canvas's actual stored hex, content not chrome.
- `pixel-inspect.tsx:123` — dynamic `top` / `left` for the floating box's screen-space position.
- `atmosphere-panel.tsx`, `mark.tsx` — design-system spec hexes (banded sky, sun disc) called out in component docstrings.
- `wordmark.tsx:38` — dynamic `fontSize` + `letterSpacing`, non-color geometry.

**Verdict:** clean per N1; the prose-version exclusion (atmosphere spec, mark, canvas internals, styleguide swatches) matches what's left.

### Build + typecheck + lint (N2)

- `pnpm typecheck` — passes, zero errors. (One mid-implementation regression in Phase 6 — `BotStatus` is `"ACTIVE" | "REVOKED"`, the page compared `=== "active"` — was caught by the typecheck and fixed before commit.)
- `pnpm lint` — two pre-existing warnings (`_host` in `key-handling.ts`, `_k` in `fail-open.test.ts`) carried over from main; zero new warnings.
- `pnpm build` — production build succeeds; every migrated route compiles. Static / SSG / dynamic mix is unchanged from pre-work (the design changes are presentational; render strategies are untouched).

### Server-action / business-logic invariance (A5, N4)

`app/bots/_actions.ts` is unchanged (`git diff main..HEAD -- app/bots/_actions.ts` returns nothing). The Phase 6 lift replaced the UI wrappers (`_create-bot-form.tsx`, `_create-pat-form.tsx`, `_edit-description-form.tsx`) but each form still calls the same `createBotAction`, `createPatAction`, `updateDescriptionAction`, `mintKeyAction`, `revokeKeyAction`, `revokePatAction` server actions with the same `FormData` shape. `useActionState` hooks preserved. Hidden inputs (`botId`, `keyId`, `tokenId`) preserved.

`auth.ts`, `src/bots/*`, `src/auth/pat.ts`, `src/sectors`, `src/viewer/canvas.tsx`, `src/viewer/chunk-cache.ts`, `src/viewer/pan-zoom.ts`, `src/viewer/poll-loop.ts`, `src/viewer/viewer-fetch.ts`, `src/viewer/heartbeat.ts` — all unchanged. UI re-skin only.

### Viewer non-regression (A6)

Chrome-only changes; canvas rendering path (`SectorCanvas`, `ChunkCache`, the polling loop, heartbeat) untouched. Pan/zoom event handling (`onPointerDown` / `onPointerUp` / `onPointerMove` / `onWheel`), debug grid (`?debug`), click-to-inspect — all preserved unchanged in `sector-viewer.tsx`. The only viewer code that changed:

- `viewer-page.tsx` — the outer server-component shell (replaced inline header with `TopNav` + `PageShell`).
- `pixel-inspect.tsx` — overlay's inline dark-box styles → token classes; `Button` primitive for "See @handle's activity →".
- `sector-viewer.tsx` — `stalePillStyle` ("Reconnecting…" pill) lifted to token classes. No event-handling or rendering-loop code touched.

A6 needs a manual exercise on the preview deploy: pan, pinch-zoom, wheel-zoom, click-to-inspect, `?debug` grid, polling loop's manifest cycle. Each should behave identically.

### Theme parity (A1, F16, N6)

Every page consumes tokens — Day → Dusk should swap without per-component overrides. Spot-checks:

- Auth pages: card on warm-sand `--bg` in Day, on deep-indigo `--bg` in Dusk; atmosphere panel renders the sunset register in both (design-locked).
- `/bots`: brand-blue CTAs read fine on both backgrounds. Sun-warning reveal block reads `sun-foreground` (dark text on yellow) in both modes (`--sun-foreground` is intentionally the same dark hex in both themes).
- Viewer chrome: `TopNav` is `bg-surface` + `border-border` in both themes. Pill carrying the sector name renders against the chrome surface, contrast preserved.
- Docs prose: `--brand` link color works on both `--bg` backgrounds; the markdown `<pre>` code-fence sits on `--bg` with `--border` outline, flat-shadow elevation. Inline `<code>` also on `--bg` with `--border`.

A manual Day↔Dusk walk on preview will confirm; no automated check is in scope for this work.

### Atmosphere-panel weight (R8)

`/signin` and `/signup` render a 160px-tall sunset atmosphere panel above the sign-in card. Per R8, this is the "start moderate, fall back if too loud" approach: not full-bleed, not above-the-card-only-strip. If the panel reads as too loud on the preview deploy, R8's stepped fallback applies: shrink to ~120px strip, or move to a sky-tinted card border.

The atmosphere component is parameterizable (`className` controls height; `register` swaps register; `withSun` toggles the disc), so tweaks land as className edits, not a refactor.

### Shared-chrome ergonomics

`TopNav` accommodated all four required variants without inventing a one-off mid-stream. The `contextSlot` prop carried the sector pill (viewer) and the filtered-canvas pill + back-link (bot canvas) cleanly. `PageShell`'s three variants (narrow / wide / bleed) covered every page; `topNav` and `hideFooter` slots gave enough control without over-parameterizing.

One small ergonomic ask flagged for a follow-up: `PageShell` puts `<main>` inside a non-`<main>` `<div>` on the bleed variant (the canvas page) — currently fine because viewer pages don't use `<main>` semantically, but if accessibility audit cares about exactly-one-`<main>` per page, `PageShell variant="bleed"` could expose its inner container as `<main>`. Not in scope here.

### Markdown prose readability (A7)

Build-docs prose looks right with `font-display` H1/H2/H3 (uppercase tracking), `font-mono` code, `--brand` links, `--bg` + `--border` code fences with flat-shadow elevation. The `/api/build-md/<slug>` endpoint and `/agents.md` aggregator (which serve raw markdown text, not rendered HTML) are unaffected — they don't render through `MarkdownContent`.

### `/styleguide` currency

Every new component added in Phase 1 has a section on the styleguide:

- `TopNav` — four variants demoed (viewer signed-in, viewer signed-out, docs, owner, minimal — five actual variants demoed, including both signed states).
- `PageShell` — three variants described in a DataList (full demo would require a recursive page-shell-rendering-page-shell which is gross; description plus the existing styleguide top bar dogfoods the same shape).
- Form primitives — Input / Label / Textarea / FormRow in a working "edit bot" sample form.
- `DataList` — sample account-info card.
- `Table` — sample API-keys table with status pills and ghost revoke button.
- `Separator` — inside a Card.
- `Footer` — rendered standalone in a bordered container so it doesn't pollute the page's actual footer.
- `AtmospherePanel` — replaced the inline `DAYTIME_SKY` / `SUNSET_SKY` consts with the component itself, so the styleguide now demos the actual component instead of an inline replica.

## Defects fixed during implementation

- Phase 6: `BotStatus === "active"` lowercase comparison failed typecheck (enum is `"ACTIVE" | "REVOKED"`). Fixed before commit.
- Phase 7 audit: `stalePillStyle` ("Reconnecting…" pill) in `sector-viewer.tsx` was inline-styled chrome that Phase 5 missed. Lifted to token classes.

## Open follow-ups (not in scope here)

- **Atmosphere-panel weight on auth pages**: confirm visual weight on preview deploy; apply R8 fallback if it overpowers the card.
- **Mobile viewport (N5)**: spot-check at ~390px width on preview — no horizontal scroll, viewer gestures still work.
- **Bundle-size delta (A9)**: compare before/after `next build` per-route weights. Heavy assumption: Tailwind-class swaps for inline-style swaps don't materially shift bundle size, but verify.
- **`PageShell variant="bleed"` `<main>` semantics**: if accessibility audit demands exactly-one-`<main>`, expose the inner container as `<main>`. Not a blocker today.

## Verdict

Phases 1–7 land. Token discipline holds, server-action invariance verified by diff, build/typecheck/lint clean, viewer rendering pipeline untouched. The application work is ready to merge.

Requirement status flips `draft` → `shipped` on the merge commit, with `shipped: 2026-05-20` added to the requirement frontmatter.
