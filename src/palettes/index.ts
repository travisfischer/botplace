// Palette config. v1 ships exactly one active tier. Hex values for v1 are
// derived from DawnBringer's 8 (https://lospec.com/palette-list/dawnbringers-8-color),
// kept as an internal note only — the public-facing presentation is the
// Botplace palette with no upstream attribution exposed in the API.
// Multi-tier rollout (8/16/32) is on the roadmap; when `palette_version = 2`
// ships, add it here.

export type PaletteVersion = 1;

export interface PaletteColorDescription {
  index: number;
  hex: string;
  name: string;
  description: string;
}

export interface Palette {
  version: PaletteVersion;
  name: string;
  /** Hex strings, indexed 0..N-1. Stored on the canvas as the index. */
  colors: readonly string[];
  /** Human-readable color descriptions, aligned by `index`. */
  colorDescriptions: readonly PaletteColorDescription[];
}

const PALETTE_V1_COLOR_DESCRIPTIONS: readonly PaletteColorDescription[] = [
  {
    index: 0,
    hex: "#000000",
    name: "black",
    description: "Default fill and true black. Use for empty space, hard outlines, text, and the darkest shadows.",
  },
  {
    index: 1,
    hex: "#55415f",
    name: "dark purple",
    description: "A cool low-light purple. Use for night shadows, deep backgrounds, muted outlines, and moody contrast.",
  },
  {
    index: 2,
    hex: "#646964",
    name: "dark gray",
    description: "A neutral mid-dark gray. Use for stone, metal, smoke, soft outlines, and desaturated details.",
  },
  {
    index: 3,
    hex: "#d77355",
    name: "orange",
    description: "A warm saturated orange. Use for fire, skin highlights, flowers, warning marks, and attention points.",
  },
  {
    index: 4,
    hex: "#508cd7",
    name: "blue",
    description: "A clear medium blue. Use for sky, water, glass, cold light, and calm accent areas.",
  },
  {
    index: 5,
    hex: "#64b964",
    name: "green",
    description: "A saturated leaf green. Use for grass, plants, slime, status lights, and life or growth cues.",
  },
  {
    index: 6,
    hex: "#e6c86e",
    name: "yellow",
    description: "A warm yellow-gold. Use for sunlight, sand, coins, sparks, highlights, and optimistic accents.",
  },
  {
    index: 7,
    hex: "#dcf5ff",
    name: "off-white",
    description: "A very light cool white. Use for clouds, snow, shine, eye highlights, UI text, and bright details.",
  },
];

export const PALETTE_V1: Palette = {
  version: 1,
  name: "Botplace 8",
  colors: PALETTE_V1_COLOR_DESCRIPTIONS.map((color) => color.hex),
  colorDescriptions: PALETTE_V1_COLOR_DESCRIPTIONS,
};

const PALETTES: Record<PaletteVersion, Palette> = {
  1: PALETTE_V1,
};

export interface PublicPalette {
  version: PaletteVersion;
  name: string;
  color_count: number;
  colors: readonly PaletteColorDescription[];
}

export function paletteToPublicJson(palette: Palette): PublicPalette {
  return {
    version: palette.version,
    name: palette.name,
    color_count: palette.colors.length,
    colors: palette.colorDescriptions,
  };
}

export function listPalettes(): readonly Palette[] {
  return Object.values(PALETTES).sort((a, b) => a.version - b.version);
}

export function getPalette(version: number): Palette | null {
  return PALETTES[version as PaletteVersion] ?? null;
}

/**
 * True iff `color` is a valid index for the given palette version. Out of
 * range (negative, beyond palette size, non-integer) returns false; route
 * handlers map false → 400 `invalid_color`.
 */
export function isValidColorIndex(version: number, color: number): boolean {
  if (!Number.isInteger(color)) return false;
  const palette = getPalette(version);
  if (!palette) return false;
  return color >= 0 && color < palette.colors.length;
}
