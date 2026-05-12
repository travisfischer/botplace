// Unit tests for the M2.5 visitor-pulse launch bot's pure logic.
// Targets the log-scale math, diff computation, and the partial-
// progress accounting reviewed for boundary correctness.

import { describe, expect, it } from "vitest";

import {
  BLOCK_PX,
  PIXELS_PER_BLOCK,
  blockDiff,
  computeNewLastBlocks,
  pixelsForBlock,
  viewersToBlocks,
} from "@/src/launch-bots/visitor-pulse-logic";

describe("visitor-pulse-logic", () => {
  describe("viewersToBlocks", () => {
    it("returns 0 for 0 or negative viewers", () => {
      expect(viewersToBlocks(0, 500)).toBe(0);
      expect(viewersToBlocks(-1, 500)).toBe(0);
    });
    it("matches the documented anchor points (1→1, 10→10, 100→20, 1000→30)", () => {
      expect(viewersToBlocks(1, 500)).toBe(Math.round(10 * Math.log10(2)));
      expect(viewersToBlocks(1, 500)).toBe(3);
      expect(viewersToBlocks(10, 500)).toBe(Math.round(10 * Math.log10(11)));
      expect(viewersToBlocks(100, 500)).toBe(Math.round(10 * Math.log10(101)));
      expect(viewersToBlocks(1000, 500)).toBe(Math.round(10 * Math.log10(1001)));
    });
    it("caps at maxBlocks even for very high counts", () => {
      expect(viewersToBlocks(1_000_000, 30)).toBe(30);
      expect(viewersToBlocks(1_000_000, 100)).toBe(60);
    });
    it("returns 0 when maxBlocks is 0 or negative (degenerate canvas)", () => {
      expect(viewersToBlocks(50, 0)).toBe(0);
      expect(viewersToBlocks(50, -10)).toBe(0);
    });
    it("returns 0 for non-finite inputs (NaN, Infinity)", () => {
      expect(viewersToBlocks(Number.NaN, 500)).toBe(0);
      expect(viewersToBlocks(Number.POSITIVE_INFINITY, 500)).toBe(0);
      expect(viewersToBlocks(Number.NEGATIVE_INFINITY, 500)).toBe(0);
    });
  });

  describe("blockDiff", () => {
    it("returns both empty when previous === target", () => {
      const d = blockDiff(5, 5);
      expect(d.toLight).toEqual([]);
      expect(d.toDark).toEqual([]);
    });
    it("emits LIGHT range when target > previous", () => {
      const d = blockDiff(3, 7);
      expect(d.toLight).toEqual([3, 4, 5, 6]);
      expect(d.toDark).toEqual([]);
    });
    it("emits DARK range when target < previous", () => {
      const d = blockDiff(7, 3);
      expect(d.toLight).toEqual([]);
      expect(d.toDark).toEqual([3, 4, 5, 6]);
    });
    it("0 → N: lights blocks [0..N)", () => {
      const d = blockDiff(0, 4);
      expect(d.toLight).toEqual([0, 1, 2, 3]);
      expect(d.toDark).toEqual([]);
    });
  });

  describe("computeNewLastBlocks", () => {
    it("advances to targetBlocks on a clean tick (no error)", () => {
      expect(
        computeNewLastBlocks({
          previousBlocks: 3,
          targetBlocks: 7,
          writtenPixels: 16,
          errored: false,
          wasLighting: true,
        }),
      ).toBe(7);
    });
    it("light-phase partial: previousBlocks + floor(written / 4)", () => {
      // We wrote 9 pixels into the lighting phase = 2 full blocks lit.
      expect(
        computeNewLastBlocks({
          previousBlocks: 5,
          targetBlocks: 12,
          writtenPixels: 9,
          errored: true,
          wasLighting: true,
        }),
      ).toBe(7);
    });
    it("light-phase partial with 0 written: keeps previousBlocks", () => {
      expect(
        computeNewLastBlocks({
          previousBlocks: 5,
          targetBlocks: 12,
          writtenPixels: 0,
          errored: true,
          wasLighting: true,
        }),
      ).toBe(5);
    });
    it("dark-phase partial: keeps previousBlocks regardless of writes", () => {
      // Reviewer's specific worry: when the failure is in the dark
      // phase, we should NOT advance past previousBlocks. The function
      // returns previousBlocks even with many writes.
      expect(
        computeNewLastBlocks({
          previousBlocks: 10,
          targetBlocks: 3,
          writtenPixels: 24,
          errored: true,
          wasLighting: false,
        }),
      ).toBe(10);
    });
    it("PIXELS_PER_BLOCK is 4 (2x2)", () => {
      expect(PIXELS_PER_BLOCK).toBe(4);
      expect(BLOCK_PX).toBe(2);
    });
  });

  describe("pixelsForBlock", () => {
    it("block N occupies (2N, 0), (2N+1, 0), (2N, 1), (2N+1, 1)", () => {
      expect(pixelsForBlock(0)).toEqual([
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]);
      expect(pixelsForBlock(5)).toEqual([
        [10, 0],
        [11, 0],
        [10, 1],
        [11, 1],
      ]);
    });
  });
});
