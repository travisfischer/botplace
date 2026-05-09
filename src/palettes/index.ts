// Palette config. M1 ships exactly one active tier — DawnBringer's 8.
// Multi-tier rollout (8/16/32) is documented in Possible Future Enhancements
// of the M1 requirement; when `palette_version = 2` ships, add it here.

export type PaletteVersion = 1;

export interface Palette {
  version: PaletteVersion;
  /** Hex strings, indexed 0..N-1. Stored on the canvas as the index. */
  colors: readonly string[];
}

// DawnBringer's 8 — https://lospec.com/palette-list/dawnbringers-8-color
export const PALETTE_V1: Palette = {
  version: 1,
  colors: [
    "#000000", // 0 — black
    "#55415f", // 1 — dark purple
    "#646964", // 2 — dark gray
    "#d77355", // 3 — orange
    "#508cd7", // 4 — blue
    "#64b964", // 5 — green
    "#e6c86e", // 6 — yellow
    "#dcf5ff", // 7 — off-white
  ],
};

const PALETTES: Record<PaletteVersion, Palette> = {
  1: PALETTE_V1,
};

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
