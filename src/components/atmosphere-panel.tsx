// Atmosphere layer panel — banded-sky gradient block per the Nagai
// design system's atmosphere spec. Hard-stop CSS gradients (never smooth
// blends); two registers — daytime (cobalt → cream) and sunset (indigo
// → gold). The hex literals here are atmosphere *spec*, not chrome
// styling — they live in the design system as the canonical sky bands,
// just like canvas drawing palettes (src/palettes/) live as data.
//
// Used by simple pages (auth) per requirement-20260520-0914 F8 to
// carry the vibe on otherwise-quiet surfaces.
//
// Texture pass: when `texture` is on (default), the panel composites
// three layers:
//
//   1. Base banded gradient (the canonical Nagai band stops).
//   2. SVG pixel scatter — ~1,250 individual specks placed by a
//      seeded PRNG, one per <rect>. Specks cluster near band
//      boundaries (exponential distribution from each boundary's Y
//      position) and the falloff has a long tail so some pixels land
//      deep in band territory. Each speck is colored as the
//      "invading" band — band-B pixels above the boundary, band-A
//      pixels below — exactly how real pixel-art dither extends a
//      transition into adjacent flat fills. Output is deterministic
//      across renders (fixed seed) so SSR / client paint match.
//   3. Faint scanline overlay (vinyl-record-era grain).
//
// No new palette entries — every speck reuses an existing band hex.

import { cn } from "@/src/lib/utils";

export type AtmosphereRegister = "sunset" | "daytime";

export interface AtmospherePanelProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "style"> {
  register?: AtmosphereRegister;
  /** Render a small sun disc on the sky. Defaults to true for sunset,
   *  false for daytime (the daytime register reads as midday + cloud,
   *  not horizon — disc is optional). */
  withSun?: boolean;
  /** Render the pixel scatter + scanline overlay. Defaults to true.
   *  Turn off for tiny thumbnails where the texture looks fussy. */
  texture?: boolean;
}

// Canonical band stops from the design-system requirement.
// `end` is the percentage where the band terminates (next band's start).
interface Band {
  color: string;
  end: number;
}

const SUNSET_BANDS: readonly Band[] = [
  { color: "#3A4E8C", end: 20 }, // indigo
  { color: "#8B4E8E", end: 40 }, // mauve
  { color: "#C2477E", end: 58 }, // magenta
  { color: "#EE6C4D", end: 76 }, // coral
  { color: "#F4A06A", end: 90 }, // peach
  { color: "#F2C14E", end: 100 }, // gold
];

const DAYTIME_BANDS: readonly Band[] = [
  { color: "#1F5FA8", end: 18 },
  { color: "#2D7DD2", end: 36 },
  { color: "#4A97D8", end: 52 },
  { color: "#79B8E0", end: 66 },
  { color: "#B3D9EC", end: 80 },
  { color: "#E7F1F2", end: 100 },
];

// Faint horizontal scanline — every 3px, 1px of low-opacity ink.
// Provides era-appropriate film/vinyl grain without color shift.
const SCANLINE_LAYER =
  "repeating-linear-gradient(to bottom, transparent 0 2px, rgba(0,0,0,0.05) 2px 3px)";

// Seeded PRNG. Stable across renders so server-rendered and client-
// rehydrated DOMs match. Two seeds chosen to give visually distinct
// scatter per register.
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// SVG viewBox edge length. Picked so 1-unit specks render as
// ~2-3 CSS pixels at the full-page panel size (e.g. ~1100×700 on
// desktop → 2.75 px-per-unit), and 2-unit specks render as ~5-6 CSS
// pixels — the "current size" the user likes. Together they give
// two-size grain variation. `preserveAspectRatio="none"` stretches
// the viewBox to fit, so the per-unit screen size varies by panel
// dimensions.
const VB = 400;

// Exponential distribution scale, in viewBox units. With VB=400 and
// SCALE=12, most specks fall within ±36 units (~9% of panel height)
// of a boundary; the long tail extends to ±80+ units in rare draws
// (~20% of panel height). That's the "deep scatter" range — same
// panel-relative spread as the previous VB=200 / SCALE=6 setup.
const SCATTER_SCALE = 12;

// Specks per band boundary. 5 boundaries × ~280 = ~1,400 <rect>
// elements per register. URL-encoded SVG is ~60KB inline — well
// within reasonable data-URI sizes and gzip'd fine in transit.
const SPECKS_PER_BOUNDARY = 280;

interface Speck {
  x: number;
  y: number;
  /** Edge length in viewBox units (1 or 2). 1 reads as fine grain
   *  on screen (~2-3 CSS px); 2 reads as the larger pixel-art
   *  speck the user liked (~5-6 CSS px). */
  size: number;
  color: string;
}

function generateScatterSpecks(bands: readonly Band[], seed: number): Speck[] {
  const rng = mulberry32(seed);
  const specks: Speck[] = [];

  for (let i = 0; i < bands.length - 1; i++) {
    const a = bands[i].color;
    const b = bands[i + 1].color;
    const boundaryY = (bands[i].end / 100) * VB;

    for (let j = 0; j < SPECKS_PER_BOUNDARY; j++) {
      // Exponential offset from boundary with random sign — long
      // tail in both directions so specks extend deep into bands.
      const sign = rng() < 0.5 ? -1 : 1;
      const u = Math.max(rng(), 1e-6);
      const magnitude = -Math.log(u) * SCATTER_SCALE;
      const yOffset = sign * magnitude;
      const y = Math.floor(boundaryY + yOffset);
      if (y < 0 || y >= VB) continue;
      const x = Math.floor(rng() * VB);

      // "Minority invader" coloring: above the boundary the speck is
      // band-B (the band below) bleeding upward; below, it's band-A
      // bleeding downward.
      const color = yOffset < 0 ? b : a;

      // ~65/35 mix between size-1 (fine grain) and size-2 (larger
      // pixel-art speck). Skewed toward fine grain so the texture
      // reads as airbrush dust with occasional larger pixel accents,
      // rather than a uniform two-size dot pattern.
      const size = rng() < 0.65 ? 1 : 2;

      specks.push({ x, y, size, color });
    }
  }

  return specks;
}

function buildScatterSvg(bands: readonly Band[], seed: number): string {
  const specks = generateScatterSpecks(bands, seed);

  // Group by color so the `fill` attribute lives on a wrapping <g>
  // rather than on every <rect> — chops ~30% off the SVG payload.
  // Width/height stay on each <rect> since SVG doesn't inherit those
  // from <g>; size varies per speck (1 or 2).
  const byColor = new Map<string, Speck[]>();
  for (const s of specks) {
    let arr = byColor.get(s.color);
    if (!arr) {
      arr = [];
      byColor.set(s.color, arr);
    }
    arr.push(s);
  }

  const groups: string[] = [];
  for (const [color, arr] of byColor) {
    const rects = arr
      .map(
        (s) =>
          `<rect x="${s.x}" y="${s.y}" width="${s.size}" height="${s.size}"/>`,
      )
      .join("");
    groups.push(`<g fill="${color}">${rects}</g>`);
  }

  // `shape-rendering="crispEdges"` keeps the specks pixel-aligned
  // even when the SVG is stretched to a non-integer scale by
  // preserveAspectRatio="none".
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" preserveAspectRatio="none" shape-rendering="crispEdges">${groups.join("")}</svg>`;
}

function svgToDataUri(svg: string): string {
  // encodeURIComponent is safe and standard; inflates only slightly
  // for our content (mostly ASCII).
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

// Pre-computed scatter URLs (one per register). Generated once at
// module load — the seeded PRNG is deterministic, so this is stable
// across server + client paints.
const SUNSET_SCATTER_URL = svgToDataUri(
  buildScatterSvg(SUNSET_BANDS, 0xbadc0ffe),
);
const DAYTIME_SCATTER_URL = svgToDataUri(
  buildScatterSvg(DAYTIME_BANDS, 0x1eafdeed),
);

function baseGradient(bands: readonly Band[]): string {
  const stops = bands
    .map((b, i) => {
      const start = i === 0 ? 0 : bands[i - 1].end;
      return `${b.color} ${start}% ${b.end}%`;
    })
    .join(", ");
  return `linear-gradient(to bottom, ${stops})`;
}

// Full multi-layer background. CSS background layers paint
// first-listed-on-top, so the order is:
//   1. Scanline (top, drawn last)
//   2. SVG pixel scatter (middle)
//   3. Base banded gradient (bottom, drawn first)
function buildSkyBackground(
  bands: readonly Band[],
  scatterUrl: string,
): string {
  return [
    SCANLINE_LAYER,
    `${scatterUrl} 0 0 / 100% 100% no-repeat`,
    baseGradient(bands),
  ].join(", ");
}

function buildFlatBackground(bands: readonly Band[]): string {
  return baseGradient(bands);
}

export function AtmospherePanel({
  register = "sunset",
  withSun,
  texture = true,
  className,
  children,
  ...props
}: AtmospherePanelProps) {
  const showSun = withSun ?? register === "sunset";
  const bands = register === "sunset" ? SUNSET_BANDS : DAYTIME_BANDS;
  const scatterUrl =
    register === "sunset" ? SUNSET_SCATTER_URL : DAYTIME_SCATTER_URL;
  const background = texture
    ? buildSkyBackground(bands, scatterUrl)
    : buildFlatBackground(bands);

  return (
    <div
      className={cn(
        "relative overflow-hidden border-[1.5px] border-border",
        className,
      )}
      style={{ background }}
      {...props}
    >
      {showSun ? (
        <span
          aria-hidden
          className="absolute rounded-full"
          style={{
            width: "14%",
            aspectRatio: "1",
            top: "58%",
            right: "8%",
            background: "#F4D662",
          }}
        />
      ) : null}
      {children}
    </div>
  );
}
