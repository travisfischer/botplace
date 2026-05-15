import { describe, expect, it } from "vitest";
import {
  PALETTE_V1,
  getPalette,
  isValidColorIndex,
  listPalettes,
  paletteToPublicJson,
} from "@/src/palettes";

describe("PALETTE_V1", () => {
  it("has 8 colors", () => {
    expect(PALETTE_V1.colors.length).toBe(8);
  });

  it("uses lowercase #rrggbb hex strings", () => {
    for (const c of PALETTE_V1.colors) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("keeps color descriptions aligned with palette indices and hex values", () => {
    expect(PALETTE_V1.colorDescriptions).toHaveLength(PALETTE_V1.colors.length);
    for (const [index, color] of PALETTE_V1.colorDescriptions.entries()) {
      expect(color.index).toBe(index);
      expect(color.hex).toBe(PALETTE_V1.colors[index]);
      expect(color.name.length).toBeGreaterThan(0);
      expect(color.description.length).toBeGreaterThan(20);
    }
  });
});

describe("getPalette", () => {
  it("returns the v1 palette for version 1", () => {
    expect(getPalette(1)).toBe(PALETTE_V1);
  });

  it("returns null for unknown versions", () => {
    expect(getPalette(0)).toBeNull();
    expect(getPalette(2)).toBeNull();
    expect(getPalette(99)).toBeNull();
  });
});

describe("listPalettes", () => {
  it("returns public palettes in version order", () => {
    expect(listPalettes()).toEqual([PALETTE_V1]);
  });
});

describe("paletteToPublicJson", () => {
  it("returns descriptive public metadata", () => {
    expect(paletteToPublicJson(PALETTE_V1)).toMatchObject({
      version: 1,
      name: "Botplace 8",
      color_count: 8,
      colors: expect.arrayContaining([
        expect.objectContaining({
          index: 0,
          hex: "#000000",
          name: "black",
        }),
      ]),
    });
  });
});

describe("isValidColorIndex", () => {
  it("accepts indices 0..7 for v1", () => {
    for (let i = 0; i < 8; i++) {
      expect(isValidColorIndex(1, i)).toBe(true);
    }
  });

  it("rejects out-of-range indices", () => {
    expect(isValidColorIndex(1, -1)).toBe(false);
    expect(isValidColorIndex(1, 8)).toBe(false);
    expect(isValidColorIndex(1, 99)).toBe(false);
  });

  it("rejects non-integers", () => {
    expect(isValidColorIndex(1, 1.5)).toBe(false);
    expect(isValidColorIndex(1, NaN)).toBe(false);
    expect(isValidColorIndex(1, Infinity)).toBe(false);
  });

  it("rejects unknown palette versions", () => {
    expect(isValidColorIndex(0, 0)).toBe(false);
    expect(isValidColorIndex(2, 0)).toBe(false);
  });
});
