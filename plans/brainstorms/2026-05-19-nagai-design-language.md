---
date: 2026-05-19
topic: nagai-design-language
status: draft
---

# Brainstorm: Nagai Design Language

A visual identity for Botplace anchored on the city-pop illustration work of
Hiroshi Nagai. This document pins the *direction* in words and proposes a
concrete starting palette + token structure. It is cheap to iterate on — react
to it freely; nothing here is locked until it graduates into a requirement doc.

## Decisions (resolved 2026-05-19)

Travis answered the open questions. Folded in:

1. **Two palettes, not one.** The original framing — "canvas palette = subset of
   the UI master palette" — was wrong. A ~10-color *brand* palette and a tuned
   *drawing* palette are different artifacts with different jobs. They must
   harmonize, but neither is a subset of the other. See "Palettes" below.
2. **Canvas drawing palette → the Endesga (EDG) family.** Travis values
   DawnBringer's 8 precisely because a pro game artist honed it to render
   arbitrary, legible scenes from few colors, and it scales. The warm
   counterpart with the same properties is ENDESGA's EDG family
   (EDG8/16/32/64) — pro-honed, versatile, warm, an explicit scaling family.
   Adopt EDG as the canvas direction. Migrate the single shipped canvas palette
   to EDG8 as `paletteVersion: 2`; defer the 16/32 *tier* palettes (and the
   nesting question) to the milestone that builds the tier mechanic.
3. **Migrate, scoped.** Travis prefers migrating sooner. The 8-color migration
   is small (one new palette version); the 8→16→32 scaling craft is the
   deferrable part — and a natural place for a designer partnership later.
4. **Typography stays out of the way.** No pixel font for running text. One warm
   grotesque family for display + body, set in the calm modernist-block idiom of
   the *A Long Vacation* album cover (Travis's reference). A monospace for the
   bot API / code / docs. An Emigre-style or pixel face is reserved for the
   *logo/wordmark only* — era signal without harming legibility. Type
   communicates content; color and form carry the era.
5. **Dark mode: architected now, shipped later.** Tokens use semantic role names
   so dark mode is a value swap, not a rebuild. Ship light first; dark is a
   fast-follow. Nagai's sunset/night register is the dark-mode source.
6. **Atmosphere: start light.** Gallery principle — a few placed illustrations
   (hero / loading / empty states). The app and the canvas are the star.
7. **Illustration sourcing.** Primary aspiration: render illustrations in the
   canvas's *own pixel grammar* — which means they use the EDG canvas palette,
   so the drawing palette does double duty (bot art *and* our atmosphere art).
   AI generation as exploration/fallback.

Still genuinely open: exact UI brand-palette hex values (Travis can't judge
these as isolated swatches — needs to see them applied); exact font choices;
the tier mechanic's nesting model (do 8/16/32 need to be nested supersets, or
are they independent versioned palettes?).

**Cohesion is congruence, not identity (added 2026-05-19).** Tested by dropping
a real Nagai cover (the Webflow-hosted cover-art2 reference) into the mockup's
canvas frame. The proposed UI palette doesn't *clone* that specific cover — and
that's intentional. Different Nagai pieces sit at different points on the
temperature/saturation spectrum; tuning the UI to any single painting would
clash with the rest of the family, with bot-painted EDG art on the canvas, and
with whatever atmosphere illustrations get made. The UI's job is to be the
calm gallery wall that works with the whole family. Sticking with the proposed
palette as the working hypothesis; iterate from applied-page signal, not from
single-image comparison. Semantic tokens make later value tweaks cheap.

**Coral is highlight, not action (added 2026-05-19).** Travis flagged that a
red-family primary CTA reads as destructive (error / cancel / decline) to
web-trained users — true. Reshuffled: `--brand` (cobalt sky) is the primary-CTA
color; `--accent` (coral) is reserved for highlight / energy roles — live
indicators, hot stats, attention badges, the wordmark accent square. Coral
never appears on a primary button. General principle worth carrying into the
requirement doc: **red-family is a "look here" color, not a "do this" color.**
Token names unchanged; role assignment is what shifted.

**Mark / icon: sunset bands + sun disc, borderless default (added
2026-05-19).** Replaces the 4-color square placeholder mark. The Nagai
banded sunset sky, with a small yellow sun disc as focal point, is the
mark — distilled directly from the atmosphere layer, so favicon, topbar
mark, hero illustration, and dark-mode palette source all derive from the
same visual idea.

- **Borderless is the default** at every size, including the 16px favicon.
  The gradient fills the full frame, the mark pops more, the system-wide
  ink border is *chrome* not *identity* and was leaking into logo
  territory.
- **Bordered is a reserved variant** for cases where the mark needs to live
  inside another bordered surface or wants a more "framed / vintage record
  label" treatment. The icon-exploration grids in the palette preview keep
  their borders to serve as that reference.
- **Sun disc on both icon and favicon** — even at 16px the small yellow
  circle (≈5px) reads, and dropping it broke the "sunset over the horizon"
  metaphor that the disc completes. Visual idea is consistent at every
  scale; no responsive-logo variant needed.

Bands (indigo → mauve → magenta → coral → peach → gold) at non-uniform
heights (20/20/18/18/14/10%) — the bands compress toward the horizon, which
is the actual Nagai signature, not equal stripes.

Production assets (proper `.ico`, multi-size PNGs, `apple-touch-icon`,
`safari-pinned-tab.svg`, dark-tab variant) are requirement-doc territory;
the inline-SVG favicon in the HTML mocks proves the default variant works
at 16px.

**Danger color tested, deferred (added 2026-05-19).** Tried adding `--danger`
as an 11th role. First pass (`#B73A2E` brick) read as register-mismatched —
muted/earthen against a bright/saturated palette. Second pass
(`#D63A2E` vivid red) was visually closer but the underlying call was wrong:
the "semantic conflict" case for a dedicated danger color (LIVE pill vs error
toast both coral) is theoretically clean but practically thin — text, icon,
and position do almost all the work distinguishing error from highlight at
the point of use. Decision: stick with the 10-role palette; let coral play
double duty in error states for now, with text + icon doing the
disambiguation. Revisit if real error screens prove the need. Semantic
tokens make later addition cheap. General principle worth carrying forward:
**resist palette growth driven by theoretical conflicts; add roles when real
screens demand them.**

## Problem / Opportunity

Botplace works but looks generic. There is no cohesive visual identity: no
considered palette, no type system, no component vocabulary. Every new page is
designed ad hoc, and the result reads as "unstyled app" rather than "a place."

The opportunity is larger than "make it pretty." The product premise is *bots
painting a shared canvas of colored pixels*. A design language built from the
right source can do three things at once:

1. Give the human-facing app a distinctive, timeless, nostalgic identity.
2. **Harmonize with the canvas itself** — the product is literally an indexed
   grid of colors; the app chrome and the canvas content can share one palette.
3. Lower the design burden on a non-designer maintainer by replacing ad-hoc
   decisions with a small, reusable token + component system.

Non-goal for this milestone: this is a *design system*, not a redesign of
specific features. We define the vocabulary; applying it page-by-page is
follow-on work.

## The anchor: why Hiroshi Nagai

Travis anchored on Nagai's work after an exploratory tour of late-80s/90s
aesthetics. What resonates, in his words:

- Southern California scenery and palette.
- Epic sky and water gradients.
- Tropical plants, cars, pools, resort architecture.
- A "low-fi" warmth — it *feels* like pixel art without being pixel art.

That last point is the key technical insight. Nagai's work is flat
airbrush/gouache illustration, but it shares pixel art's **grammar**:

- **Limited, harmonized palette** — a painting uses ~15–25 colors total.
- **Flat, unmodulated color fields** — a wall is one color; a pool is three.
- **Hard geometric edges** — no soft blending between shapes.
- **Banded, posterized gradients** — the sky reads as discrete steps.
- **Colored shadows, never black** — flat hard-edged blocks of muted
  lavender/blue-grey.

All five are trivially expressible in CSS/SVG, and all five are *exactly* what
an indexed-color pixel canvas already does. The aesthetic is structurally
compatible with what Botplace is. That is why this anchor is a good bet rather
than a costume.

Reference works to look at while reading this doc:

- Eiichi Ohtaki — *A Long Vacation* (1981). The definitive Nagai cover:
  deep-blue sky, a single cloud, pool, parasol. The daytime register.
- Nagai's Niagara-label / city-pop record jackets of the early–mid 1980s —
  the broader body of pools, palms, and modernist architecture.
- His sunset-register pieces — magenta/coral/peach/gold skies — for the
  alternate (evening) palette.

Archive: <https://japonista.com/collections/hiroshi-nagai> and
<https://www.thevinylfactory.com/features/japanese-illustrator-hiroshi-nagai-cover-art>.

## Design philosophy: two layers

The single most important idea, and the one that keeps a non-designer out of
trouble. The aesthetic splits into two layers that are treated **completely
differently**:

### 1. The Atmosphere layer

Heroes, loading screens, empty states, margin illustrations, favicon. This is
where literal Nagai imagery lives — skies, pools, palms, a lone car. It carries
the *emotion*. It is allowed to be lush, gradient-rich, and illustrative.

### 2. The System layer

Buttons, inputs, panels, tables, navigation, typography — the chrome used
thousands of times per session. This must **not** look like a Nagai painting.
A UI where everything is a tropical gradient is unusable and garish. The System
layer only inherits the *DNA*: warm palette, flat fills, hard edges, restraint.

**The gallery-wall principle:** build a calm, quiet, functional UI that acts as
a gallery wall for a small number of beautiful Nagai-grade illustrations. The
illustrations do the emotional work; the chrome stays out of the way.

**The Nagai shadow rule:** Nagai's shadows are flat, hard-edged, offset blocks
of a darker/cooler palette color — never blurry drop shadows. This gives the
System layer one dead-simple, on-brand rule for depth and elevation: a raised
element casts a flat offset rectangle of a single shadow color. Era-appropriate,
trivial in CSS, and impossible to get subtly wrong.

## The UI brand palette (proposed)

The brand palette for the **app chrome** — distinct from the canvas drawing
palette (see "Palettes" below). Derived from Nagai's daytime register. Values
are a **starting proposal** — react to them; they are best judged applied, not
as isolated swatches.

| Role            | Token            | Hex       | Drawn from                         |
|-----------------|------------------|-----------|------------------------------------|
| Page background | `--bg`           | `#FBF4E6` | sun-bleached sand / warm paper     |
| Surface / panel | `--surface`      | `#FFFCF4` | warm-white modernist building wall |
| Text (primary)  | `--ink`          | `#2B2A24` | warm near-black (not pure `#000`)  |
| Text (muted)    | `--ink-muted`    | `#6E6A5C` | warm grey                          |
| Brand / primary | `--brand`        | `#2D7DD2` | the deep cobalt Nagai sky          |
| Accent / action | `--accent`       | `#EE6C4D` | sunset coral — the "lone red car"  |
| Info / support  | `--pool`         | `#2BA3AE` | pool turquoise                     |
| Success         | `--palm`         | `#4C9A6A` | flat mid-green palm foliage        |
| Warning / focus | `--sun`          | `#F2C14E` | parasol / sun gold                 |
| Elevation shadow| `--shadow`       | `#B7B2C8` | Nagai's flat lavender wall shadow  |

Notes:

- **Warm neutrals, not grey.** Background is warm sand, not white; text is a
  warm near-black, not `#000`. This single choice carries most of the "warmth."
- **One loud accent, used sparingly.** Coral `--accent` is the primary-action /
  highlight color — the lone red car in the composition. If it shows up
  everywhere it stops being special.
- **A second register exists.** Nagai also painted sunsets (magenta → coral →
  peach → gold) and nights. That is a natural source for a dark mode or for
  Atmosphere-layer variety — flagged in Open Questions, not specced here.

## Palettes: two artifacts, one mood

There are **two palettes**, with different jobs. They share a temperature and a
sensibility (warm, sun-faded, Nagai) but neither is a subset of the other.

### 1. The UI brand palette

~10 named role-colors for the app chrome. Job: identity, legibility, hierarchy.
Muted and calm. Proposed values are in the section above; I author this one.

### 2. The canvas drawing palette

The indexed palette bots paint with. Job: render *arbitrary, legible* images
from a tiny number of colors. This needs proper value ramps, hue-shifting, a
neutral ramp, and full hue coverage — a specialized craft, not a curated
brand set. **It should not be freehanded.**

Today the canvas uses exactly **one** palette — DawnBringer's 8-color
(`src/palettes/index.ts`, `PALETTE_V1`). It is excellent *because* a pro game
artist honed it for exactly that job. The "three palettes" Travis recalled are
the planned 8/16/32 *tiers* from the M1 requirement — only the 8 ships.

**Decision: adopt the Endesga (EDG) family.** ENDESGA's palettes are the warm
counterpart to DawnBringer's — pro-honed over years, high-coverage, versatile,
and an explicit scaling family (EDG8 → EDG16 → EDG32 → EDG64). EDG is warm and
"materialistic" by reputation, which lands much closer to Nagai than DB's
cooler cast, *without* giving up the craft Travis is (correctly) unwilling to
freehand.

- **EDG8** (`#fdfdf8 #d32734 #da7d22 #e6da29 #28c641 #2d93dd #7b53ad #1b1c33`)
  — replaces `PALETTE_V1` as `paletteVersion: 2`.
- **EDG16 / EDG32** — the natural homes for the 16/32 tiers, adopted when the
  tier mechanic is actually built.

Caveat — **the canvas palette is product data.** M2.5 launch bots are keyed to
`PALETTE_V1` and every painted pixel stores a palette *index*. Introducing
`paletteVersion: 2` is a real (small) migration: a new palette entry plus
deciding what happens to existing sectors/pixels. The UI tokens can ship with
zero canvas changes, so the migration is sequenced separately in the
requirement doc.

Open within this: do the 8/16/32 tiers need to be **nested** (a tier-8 bot's
colors valid on a tier-32 canvas), or are they independent versioned palettes?
EDG8/16/32 are *not* strict supersets of each other — if nesting is required,
that is a custom-palette / designer task. Flagged for the tier milestone.

## Proposed token + packaging structure

For a Next.js App Router app, maintained by a non-designer:

- **CSS custom properties are the source of truth** for values. They are
  runtime-readable, themeable (light/dark), and — crucially — the canvas
  renderer can read the same variables, keeping app and canvas in literal sync.
- **Tailwind theme `extend`** layers on top, mapping utility classes
  (`bg-surface`, `text-ink`, `shadow-flat`) to those CSS variables.
- **Component structure is lifted, not hand-rolled.** Use shadcn/ui (Radix
  primitives underneath) for accessible component skeletons — dialogs,
  dropdowns, focus management — then apply the Nagai *skin* via tokens.
  Structure borrowed; aesthetic ours.

Token categories to define: `color`, `typography` (family + scale), `space`,
`radius`, `border`, `shadow` (the flat-offset rule), `gradient` (banded sky
definitions for the Atmosphere layer).

## Atmosphere illustrations: sourcing

The Atmosphere layer needs actual Nagai-grade illustrations, and Travis is not
an illustrator. Options, to be chosen later:

- Commission an illustrator — best quality, highest cost.
- AI-generate and curate heavily — pragmatic for "a few placed pieces."
- Build them as flat SVG/CSS gradient scenes — viable for Nagai's simple
  grammar (sky gradient + sun + palm silhouette + pool).
- **Render them in the canvas's own pixel grammar** — a low-res scene,
  nearest-neighbor upscaled or ordered-dithered. Strongest idea: the app's
  décor and the product become *the same medium*. Maximum cohesion, and it
  leans into the low-res warmth instead of fighting it.

## Deliverable sequence

1. **This brainstorm** — direction + starting palette. (current step)
2. **Requirement doc** — locks the palette, type, token structure, component
   list, and the canvas-palette decision.
3. **Tokens + a living `/styleguide` page** — every token and component
   rendered on one route. This is the non-designer's verification surface and
   is agent-native/testable.
4. **Incremental application** — apply the system to real pages, page by page.

## Open questions

The original six are resolved — see "Decisions" near the top. What remains:

1. **UI brand-palette values** — the proposed hexes, judged *applied* (not as
   swatches). To be validated against the applied mockup.
2. **Font choices** — concrete families for display/body + mono + the logo
   face. Direction is set; specific picks are requirement-doc detail.
3. **Tier nesting model** — deferred to the canvas-tier milestone.
4. **Canvas migration sequencing** — when/how `paletteVersion: 2` ships
   relative to the UI work; what happens to existing v1 pixels.

## Recommended next step

Travis can't judge a palette as isolated swatches — fair, nor can most people.
So the next artifact is an **applied mockup**: a real Botplace screen rendered
in the UI brand palette + proposed type, with the canvas showing art in EDG8,
plus one atmosphere illustration in pixel grammar. That makes the whole system
concrete enough to react to. After that lands: the requirement doc + a
`/styleguide` scaffold.
