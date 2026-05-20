---
date: 2026-05-19
type: feature
topic: nagai-design-system
status: draft
planning_depth: standard
---

# Requirement: Nagai design system (UI tokens + components + style guide)

## Status

Draft. Brainstorm at [`plans/brainstorms/2026-05-19-nagai-design-language.md`](../brainstorms/2026-05-19-nagai-design-language.md) explored the direction (Hiroshi Nagai city-pop work as the anchor) and resolved seven major decisions plus four mid-flight refinements through visual prototyping. The supporting artifacts — [`2026-05-19-nagai-mockup.html`](../brainstorms/2026-05-19-nagai-mockup.html) and [`2026-05-19-nagai-palette-preview.html`](../brainstorms/2026-05-19-nagai-palette-preview.html) — render every locked decision in working HTML/CSS for visual reference; the requirement below is the canonical spec they validate.

This requirement covers the **UI design system** only: tokens, type, components, mark, style guide. The **canvas drawing-palette migration** (EDG8 as `paletteVersion: 2`) is scoped separately — see "Deliberately out of scope" below.

## Problem / Opportunity

Botplace works but looks generic. There is no cohesive visual identity: no considered palette, no type system, no component vocabulary. Every new page is designed ad hoc and reads as "unstyled app." The opportunity is larger than "make it pretty":

1. Give the human-facing app a distinctive, timeless, nostalgic identity built on a deliberately chosen reference (Nagai) that holds up at gallery-quality.
2. Lower the design burden on a non-designer maintainer by replacing per-page decisions with a small reusable token + primitive system.
3. Establish the infrastructure (token packaging, theme switching, component library) before applying the system to real pages — so application is just consuming the system, not inventing it page-by-page.

Non-goal: this requirement does **not** redesign existing pages. It builds the design system and a `/styleguide` route. Applying the system to the canvas viewer, account pages, etc. is follow-on work.

## Approach

### Two-layer model

The system splits cleanly into two layers, treated differently:

- **System layer** — buttons, inputs, cards, type, navigation. Used thousands of times per session. Calm, restrained, hard-edged. Inherits the Nagai DNA (warm palette, flat fills, hard edges, flat colored shadows) but never tries to *look* like a painting.
- **Atmosphere layer** — heroes, loading screens, empty states, mark, optional margin illustrations. Carries the *emotion*. Allowed to be lush, gradient-rich, illustrative.

The gallery-wall principle: build a calm functional UI that acts as a gallery wall for a small number of beautiful Nagai-grade illustrations. The illustrations do the emotional work; the chrome stays out of the way.

### Stack

- **Tailwind CSS v4** — CSS-first config via the `@theme` directive in `app/globals.css`. Token-as-CSS-variable model already matches our design (semantic role names, light/dark value swap).
- **shadcn/ui** — copy-paste accessible primitives (Radix underneath), Tailwind-based, designed to be re-skinned via tokens. Owned in our repo at `src/components/ui/`. Components added on demand, not bulk-imported.
- **next/font** — Hanken Grotesk (display + body), JetBrains Mono (code), Silkscreen (wordmark only). Loaded with `next/font/google`, set as CSS variables on `<html>`.
- **next-themes** — handles dark-mode toggle with SSR + `prefers-color-scheme` + persistence. Uses the standard `.dark` class on `<html>`.

### Token system

CSS custom properties are the source of truth. Tailwind's `@theme` directive maps them to utility classes. Semantic role names (not literal color names) so dark mode is a value swap, not a rebuild.

```css
@import "tailwindcss";

@theme {
  --color-bg:          var(--bg);
  --color-surface:     var(--surface);
  --color-text:        var(--text);
  --color-text-muted:  var(--text-muted);
  --color-border:      var(--border);
  --color-shadow:      var(--shadow);
  --color-brand:       var(--brand);
  --color-accent:      var(--accent);
  --color-pool:        var(--pool);
  --color-palm:        var(--palm);
  --color-sun:         var(--sun);

  --font-display:  var(--font-hanken),    system-ui, sans-serif;
  --font-body:     var(--font-hanken),    system-ui, sans-serif;
  --font-mono:     var(--font-jetbrains), ui-monospace, monospace;
  --font-wordmark: var(--font-silkscreen), monospace;
}

:root {
  --bg: #FBF4E6; --surface: #FFFCF4;
  --text: #2B2A24; --text-muted: #6E6A5C;
  --border: #2B2A24; --shadow: #B7B2C8;
  --brand: #2D7DD2; --accent: #EE6C4D;
  --pool: #2BA3AE; --palm: #4C9A6A; --sun: #F2C14E;
}

.dark {
  --bg: #1B1730; --surface: #261F3C;
  --text: #F3EBDC; --text-muted: #9C8FA8;
  --border: #463E5E; --shadow: #0E0A1C;
  --brand: #5BA3E4; --accent: #F2784F;
  --pool: #36B3BE; --palm: #5BB07C; --sun: #F4C75E;
}
```

## The locked spec

### UI brand palette — 10 roles

Light mode → dark mode hexes. Role names describe job, not color, so dark-mode swap doesn't break the vocabulary.

| Token              | Role                        | Light       | Dark        |
|--------------------|-----------------------------|-------------|-------------|
| `--bg`             | Page background             | `#FBF4E6`   | `#1B1730`   |
| `--surface`        | Panel / card surface        | `#FFFCF4`   | `#261F3C`   |
| `--text`           | Primary text                | `#2B2A24`   | `#F3EBDC`   |
| `--text-muted`     | Secondary text              | `#6E6A5C`   | `#9C8FA8`   |
| `--border`         | Default border / divider    | `#2B2A24`   | `#463E5E`   |
| `--shadow`         | Flat-offset elevation color | `#B7B2C8`   | `#0E0A1C`   |
| `--brand`          | **Primary CTA** + brand     | `#2D7DD2`   | `#5BA3E4`   |
| `--accent`         | **Highlight / live**        | `#EE6C4D`   | `#F2784F`   |
| `--pool`           | Info / supporting           | `#2BA3AE`   | `#36B3BE`   |
| `--palm`           | Success                     | `#4C9A6A`   | `#5BB07C`   |
| `--sun`            | Warning / focus             | `#F2C14E`   | `#F4C75E`   |

#### Role rules (non-negotiable)

- **`--brand` is the primary CTA color.** Every "Add a bot," "Save," "Continue" uses brand-blue. Never coral.
- **`--accent` is highlight only.** Live indicators, NEW badges, hot stats, the mark's sun disc accent. Never on a primary action button.
- **`--text`, `--border`** intentionally share the same hex in light mode (warm near-black). The token names are separate because their *roles* are separate — they may diverge in dark mode or in future tunings.
- **Background ≠ surface.** Surface is a hair lighter than background so panels read as raised even without a shadow.
- **Pure `#000` and `#fff` are banned.** Warm near-black (`#2B2A24`) and warm white (`#FFFCF4`) carry the era; pure values are clinical.

#### Roles tested and rejected

- **`--danger`** (proposed deep brick + later vivid red): visually register-mismatched at any value tried; the semantic argument (LIVE pill vs error toast collision) is theoretically clean but practically thin — text + icon + position carry disambiguation. Coral plays double duty for error states for now; revisit when real error screens prove the need. Brainstorm logs the test-and-defer with the underlying principle: *resist palette growth driven by theoretical conflicts; add roles when real screens demand them.*

### Typography

Three families, three roles, sharply scoped:

| Role     | Family                            | Token          | Use                                              |
|----------|-----------------------------------|----------------|--------------------------------------------------|
| Display  | Hanken Grotesk (800, uppercase)   | `font-display` | Page hero, section heads. Calm modernist-block — the *A Long Vacation* album-cover idiom. |
| Body     | Hanken Grotesk (400/500/700)      | `font-body`    | All running text, UI labels, captions. Same family as display reduces decisions. |
| Mono     | JetBrains Mono (400/700)          | `font-mono`    | Bot identifiers, API code, version strings, anything monospace-meaningful. |
| Wordmark | Silkscreen (700)                  | `font-wordmark`| **The BOTPLACE wordmark only.** Not for headings, not for navigation, not for body. Era signal scoped to one element. |

Rule: type stays out of the way. Color, mark, and atmosphere carry the era — type carries content.

### Mark / icon

The Nagai banded sunset sky with a small yellow sun disc, distilled from the atmosphere layer.

- **Bands** (top → bottom, non-uniform heights compressing toward horizon — the actual Nagai signature, not equal stripes):
  - `#3A4E8C` 0–20% (deep indigo)
  - `#8B4E8E` 20–40% (mauve)
  - `#C2477E` 40–58% (magenta)
  - `#EE6C4D` 58–76% (coral)
  - `#F4A06A` 76–90% (peach)
  - `#F2C14E` 90–100% (gold)
- **Sun disc**: 30% × 30% circle in `#F4D662`, positioned at `top: 50%; right: 20%`.
- **Borderless is the default** at every size including the 16px favicon. The gradient fills the full frame.
- **Bordered is a reserved variant** for "framed / vintage record-label" treatments or when the mark sits inside another bordered surface that would clash with double-framing. Implemented as a `bordered` prop.
- **Sun disc on every scale**, including the 16px favicon (≈5px sun is small but legible, and completes the "sunset over the horizon" metaphor that bands alone don't carry).

### Component primitives

shadcn/ui provides the structural skeletons; we re-skin via tokens. Initial set installed as needed:

- `button` — variants: `primary` (brand), `neutral` (surface), `ghost`
- `card` — surface + flat ink border + flat-shadow elevation
- `badge` / `pill` — status pills (info/success/warning) + live pill (accent)
- `dialog`, `dropdown-menu`, `tooltip`, `toast` — added as features need them

Custom (not from shadcn):

- `Mark` — see spec above
- `Wordmark` — Mark + Silkscreen BOTPLACE lockup
- `ThemeToggle` — Day ⇄ Dusk

### Flat-shadow elevation rule

The single elevation primitive. Nagai's painted wall-shadows are flat, hard-edged, offset blocks of a darker / cooler color — never blurry drop shadows. Adopted as the system's one elevation rule:

```css
.shadow-flat { box-shadow: 6px 6px 0 var(--color-shadow); }
.shadow-flat-sm { box-shadow: 4px 4px 0 var(--color-shadow); }
```

No `box-shadow` with `blur`. Anywhere. Elevation = flat colored block. Pressed-button state collapses the offset.

### Atmosphere layer specs

- **Banded gradient skies** — hard-stop CSS gradients (`linear-gradient(... 0 18%, ... 18% 36%, ...)`), never smooth blends. Two registers defined: daytime (cobalt → cream) and sunset (indigo → gold). Sunset doubles as the dark-mode source.
- **Atmosphere illustrations** — when introduced, rendered in the canvas's own pixel grammar where feasible (so they consume the canvas drawing palette and read as the same medium as bot art). AI generation acceptable as exploration / fallback. Sourcing is per-piece, not a system-wide commitment; start with zero illustrations and add only where they earn their place (hero, empty states, key marketing surfaces).

## Files to create

```
app/
  globals.css                  # @import "tailwindcss" + @theme + token vars (light/.dark) + base
  layout.tsx                   # next/font wiring, ThemeProvider, mount globals.css
  icon.svg                     # 16×16 sunset bands + sun disc — auto-discovered favicon
  apple-icon.png               # 180×180 same, rasterized — auto-discovered Apple touch icon
  styleguide/
    page.tsx                   # Living style guide
src/
  components/
    mark.tsx                   # <Mark size={22} bordered={false} register="sunset" />
    wordmark.tsx               # <Wordmark size={...} /> (mark + BOTPLACE)
    theme-toggle.tsx           # Day ⇄ Dusk button using next-themes
    ui/                        # shadcn-generated primitives (added on demand)
components.json                # shadcn config (componentsAlias points to src/components/ui)
postcss.config.mjs             # Tailwind v4 PostCSS plugin
```

Package additions to `package.json`:

```jsonc
{
  "dependencies": {
    "tailwindcss": "^4.x",
    "next-themes": "^0.4.x"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.x"
  }
}
```

shadcn primitives are copied into the repo, not installed as a dependency. Radix peer dependencies are added per-component by the shadcn CLI.

## Sequencing

1. **Install deps + initialize shadcn.** Tailwind v4, `@tailwindcss/postcss`, `next-themes`. Run `pnpm dlx shadcn@latest init` pointing at `src/components/ui/`. Add `postcss.config.mjs`. Verify `pnpm build` and `pnpm typecheck` still pass.
2. **Tokens in `app/globals.css`.** All 10 roles, light + dark, font variables, base styles, flat-shadow utility.
3. **Fonts + theme provider in `app/layout.tsx`.** Replace existing inline `style={{margin:0,padding:0}}` with `globals.css` import; load three fonts via `next/font/google`; wrap children in `ThemeProvider`.
4. **`Mark`, `Wordmark`, `ThemeToggle` components** in `src/components/`. Token-driven, no hard-coded hexes.
5. **Favicon assets.** `app/icon.svg` (the same inline SVG from the mocks) + `app/apple-icon.png` (rasterized 180×180 via `sips` or `magick`). Next.js auto-generates the `<link>` tags.
6. **`/styleguide` route.** Renders every token + component + atmosphere sample, mirroring the palette-preview HTML but powered by real tokens and React components. Includes the dark-mode toggle. This is the non-designer verification surface and a regression catch.

Each step keeps the existing canvas viewer pages working — none of this touches the viewer's rendering pipeline; it only adds new infrastructure. Applying the system to the viewer / account pages is follow-on work, scoped per page.

## Deliberately out of scope

- **Canvas drawing-palette migration (EDG8 as `paletteVersion: 2`).** Decided in brainstorm; sequenced as its own small milestone after this lands. Touches `src/palettes/`, the M2.5 launch-bot seed scripts, and existing pixel data — different risk surface from CSS tokens.
- **Page-by-page application of the new design system.** Each existing page is its own small redesign milestone; not bundled here. The viewer page in particular has rendering-pipeline concerns this requirement deliberately avoids.
- **Atmosphere illustrations** (hero scenes, loading-state art). Direction is locked (canvas-pixel-grammar where feasible); concrete pieces are commissioned/built per-need.
- **`--danger` token.** Tested and deferred. Coral plays double duty for error states until real error screens prove a dedicated role is needed.
- **Tier-2 / tier-3 canvas palettes (EDG16 / EDG32) and tier-mechanic nesting.** Deferred to the canvas-tier milestone, possibly with a designer partnership.
- **Production-grade favicon variants** (Safari pinned-tab SVG, maskable icons, dark-tab variant). Initial `icon.svg` + `apple-icon.png` is enough for the design-system landing; full asset set when SEO/PWA pass happens.

## Acceptance criteria

1. `pnpm build`, `pnpm typecheck`, `pnpm lint` all pass with no warnings introduced by this work.
2. Existing routes (`/`, `/sectors/...`, `/account/...`, `/bots/...`) render without regression — the design system is additive; nothing visual changes on those pages yet.
3. `/styleguide` route renders every token, the mark at multiple sizes (16/22/32/48/64/96/128, both borderless and bordered variants), all three font families with sample lines, every button variant, the flat-shadow rule, the banded sky atmosphere sample, and the sunset register. Day ⇄ Dusk toggle swaps the chrome theme in place.
4. Browser tab favicon is the sunset bands + sun disc, visible at 16px.
5. View-source on the `/styleguide` page shows only token-driven Tailwind classes — no hard-coded color hexes in component JSX (the only place hexes live is `app/globals.css`).
6. Toggling `.dark` on `<html>` (manually or via `next-themes`) swaps every token to its dark value with no per-component changes required.

## Validation plan

- **Visual:** `/styleguide` walk-through in both themes, compared against `2026-05-19-nagai-palette-preview.html` and `2026-05-19-nagai-mockup.html`. They should feel like the same system.
- **Token discipline:** grep the new components for hex literals; only `app/globals.css` and `app/icon.svg` (the favicon SVG) are allowed to contain them.
- **Accessibility:** WCAG AA contrast for `--text` on `--bg` and `--surface` in both themes (target 7:1, AAA). Spot-check buttons (white text on `--brand`, white text on `--accent`) for AA at body size.
- **Build:** `pnpm build` succeeds on Vercel preview deploy; design system is visible at `<preview-url>/styleguide`.

## Open questions

None at locking time. The brainstorm resolved seven canonical decisions plus four refinements through visual prototyping, and the remaining "still open" items it called out are explicitly scoped *out* of this requirement (canvas migration, page application, atmosphere illustration, tier nesting). If something falls out during implementation that needs a real decision, raise it via a small follow-up doc, not by widening this requirement.

## Review checklist

To be filled in at review time per the M0/M1/M2/M2.5 review-doc convention. Reviewers should pull on at minimum:

- Token-naming discipline (semantic roles, not literal colors).
- Token-coverage gaps (anything in the mockup or palette-preview HTML that doesn't map cleanly to a token).
- Dark-mode value parity (every light value has a dark counterpart; nothing accidentally hard-coded).
- Component API ergonomics (`Mark` props in particular — `size`, `bordered`, `register`).
- Build / accessibility / contrast.

Per the milestone-lifecycle convention in `AGENTS.md`, status flips `draft` → `shipped` on the merge PR for this work, with a sibling `shipped: <YYYY-MM-DD>` field added.
