import { describe, expect, it } from "vitest";
import { PALETTE_V1, getPalette, isValidColorIndex } from "@/src/palettes";

describe("PALETTE_V1", () => {
  it("has 8 colors", () => {
    expect(PALETTE_V1.colors.length).toBe(8);
  });

  it("uses lowercase #rrggbb hex strings", () => {
    for (const c of PALETTE_V1.colors) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
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
