// Unit tests for the M2.5 sparkle launch bot's pure logic.

import { describe, expect, it } from "vitest";

import {
  SPARKLE_ANCHOR_COUNT,
  SPARKLE_COLOR,
  SPARKLE_DIRECTIONS,
  SPARKLE_DIRS_PER_ANCHOR,
  SPARKLE_RING_COUNT,
  chunksForAnchors,
  pickDirectionsForAnchor,
  pickNonSelfAnchor,
  pickRecentNonSelfAnchors,
  planExplosion,
  sparkleTargets,
  type SparkleEvent,
} from "@/src/launch-bots/sparkle-logic";

const SELF = "m25-sparkle";

function ev(
  x: number,
  y: number,
  bot_handle: string,
  accepted_at = "2026-05-12T12:00:00.000Z",
): SparkleEvent {
  return { x, y, bot_handle, accepted_at };
}

describe("sparkle-logic", () => {
  describe("constants", () => {
    it("SPARKLE_COLOR is palette index 7", () => {
      expect(SPARKLE_COLOR).toBe(7);
    });
    it("8 surrounding offsets, excluding (0, 0)", () => {
      expect(SPARKLE_DIRECTIONS).toHaveLength(8);
      for (const [dx, dy] of SPARKLE_DIRECTIONS) {
        expect(dx === 0 && dy === 0).toBe(false);
        expect(Math.abs(dx)).toBeLessThanOrEqual(1);
        expect(Math.abs(dy)).toBeLessThanOrEqual(1);
      }
    });
    it("explosion sizing constants", () => {
      expect(SPARKLE_ANCHOR_COUNT).toBe(3);
      expect(SPARKLE_DIRS_PER_ANCHOR).toBe(2);
      expect(SPARKLE_RING_COUNT).toBe(3);
    });
  });

  describe("pickNonSelfAnchor (legacy single-anchor helper)", () => {
    it("returns the first non-self event in a feed", () => {
      const events = [
        ev(10, 10, SELF),
        ev(20, 20, "alice"),
        ev(30, 30, "bob"),
      ];
      const anchor = pickNonSelfAnchor(events, SELF);
      expect(anchor).not.toBeNull();
      expect(anchor!.x).toBe(20);
    });
    it("returns null when every event is self-authored", () => {
      const events = [ev(1, 1, SELF), ev(2, 2, SELF), ev(3, 3, SELF)];
      expect(pickNonSelfAnchor(events, SELF)).toBeNull();
    });
    it("returns null on an empty feed", () => {
      expect(pickNonSelfAnchor([], SELF)).toBeNull();
    });
  });

  describe("pickRecentNonSelfAnchors", () => {
    it("returns up to N distinct non-self anchors in order", () => {
      const events = [
        ev(10, 10, SELF),
        ev(20, 20, "alice"),
        ev(30, 30, "bob"),
        ev(40, 40, "carol"),
        ev(50, 50, "dave"),
      ];
      const out = pickRecentNonSelfAnchors(events, SELF, 3);
      expect(out).toHaveLength(3);
      expect(out.map((a) => a.x)).toEqual([20, 30, 40]);
    });
    it("dedupes by (x, y)", () => {
      const events = [
        ev(20, 20, "alice"),
        ev(20, 20, "bob"),
        ev(30, 30, "carol"),
      ];
      const out = pickRecentNonSelfAnchors(events, SELF, 3);
      expect(out).toHaveLength(2);
      expect(out.map((a) => `${a.x},${a.y}`)).toEqual(["20,20", "30,30"]);
    });
    it("returns empty when only self events are present", () => {
      const events = [ev(1, 1, SELF), ev(2, 2, SELF)];
      expect(pickRecentNonSelfAnchors(events, SELF, 3)).toEqual([]);
    });
    it("respects N when more candidates are available", () => {
      const events = [
        ev(1, 1, "a"),
        ev(2, 2, "b"),
        ev(3, 3, "c"),
        ev(4, 4, "d"),
      ];
      expect(pickRecentNonSelfAnchors(events, SELF, 2)).toHaveLength(2);
    });
  });

  describe("pickDirectionsForAnchor", () => {
    it("returns the requested number of distinct directions", () => {
      const dirs = pickDirectionsForAnchor(123, 456, 2);
      expect(dirs).toHaveLength(2);
      // All distinct.
      const keys = new Set(dirs.map(([dx, dy]) => `${dx},${dy}`));
      expect(keys.size).toBe(2);
    });
    it("is deterministic for the same anchor", () => {
      const a = pickDirectionsForAnchor(100, 200, 3);
      const b = pickDirectionsForAnchor(100, 200, 3);
      expect(a).toEqual(b);
    });
    it("picks only from the 8 cardinal+diagonal offsets", () => {
      const dirs = pickDirectionsForAnchor(7, 13, 2);
      for (const [dx, dy] of dirs) {
        expect(SPARKLE_DIRECTIONS).toContainEqual([dx, dy]);
      }
    });
  });

  describe("sparkleTargets (legacy halo helper)", () => {
    it("returns all 8 surrounding pixels for a center anchor", () => {
      const targets = sparkleTargets(100, 100, 1000, 1000);
      expect(targets).toHaveLength(8);
    });
    it("clips top-left corner anchor (0, 0): drops 5 off-canvas, keeps 3", () => {
      const targets = sparkleTargets(0, 0, 1000, 1000);
      expect(targets).toHaveLength(3);
    });
    it("never writes off-canvas regardless of anchor position", () => {
      for (const ax of [0, 1, 999]) {
        for (const ay of [0, 1, 999]) {
          const targets = sparkleTargets(ax, ay, 1000, 1000);
          for (const [x, y] of targets) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThan(1000);
            expect(y).toBeLessThan(1000);
          }
        }
      }
    });
  });

  describe("planExplosion", () => {
    const colorAtZero = () => 0;

    it("for one anchor with 2 dirs × 3 rings: returns 12 writes (6 light + 6 revert)", () => {
      const plan = planExplosion({
        anchors: [{ x: 500, y: 500 }],
        canvasWidth: 1000,
        canvasHeight: 1000,
        reservedTopRows: 2,
        colorAt: colorAtZero,
        rings: 3,
        dirsPerAnchor: 2,
      });
      const lights = plan.filter((w) => w.kind === "light");
      const reverts = plan.filter((w) => w.kind === "revert");
      expect(lights).toHaveLength(6);
      expect(reverts).toHaveLength(6);
    });

    it("revert color exactly matches the prev color seen by colorAt", () => {
      const map = new Map<string, number>([
        ["501,500", 3],
        ["502,500", 3],
        ["503,500", 3],
        ["500,501", 4],
        ["500,502", 4],
        ["500,503", 4],
      ]);
      const colorAt = (x: number, y: number) => map.get(`${x},${y}`) ?? 0;
      const plan = planExplosion({
        anchors: [{ x: 500, y: 500 }],
        canvasWidth: 1000,
        canvasHeight: 1000,
        reservedTopRows: 2,
        colorAt,
        // Force E and S directions for determinism by using dirsPerAnchor=2 —
        // pickDirectionsForAnchor with (500, 500) picks specific dirs.
        rings: 3,
        dirsPerAnchor: 2,
      });
      // For each lit pixel there should be a revert with the prev color.
      for (const light of plan.filter((w) => w.kind === "light")) {
        const revert = plan.find(
          (w) =>
            w.kind === "revert" &&
            w.x === light.x &&
            w.y === light.y &&
            w.ring === light.ring,
        );
        expect(revert).toBeDefined();
        expect(revert!.color).toBe(colorAt(light.x, light.y));
      }
    });

    it("ring r reverts happen BEFORE ring (r+1) lights (sorted by order)", () => {
      const plan = planExplosion({
        anchors: [{ x: 500, y: 500 }],
        canvasWidth: 1000,
        canvasHeight: 1000,
        reservedTopRows: 2,
        colorAt: colorAtZero,
        rings: 3,
        dirsPerAnchor: 2,
      });
      const sorted = [...plan].sort((a, b) => a.order - b.order);
      // Find the last revert of ring 0 and the first light of ring 1.
      const lastRing0Revert = [...sorted]
        .reverse()
        .find((w) => w.ring === 0 && w.kind === "revert");
      const firstRing1Light = sorted.find(
        (w) => w.ring === 1 && w.kind === "light",
      );
      expect(lastRing0Revert).toBeDefined();
      expect(firstRing1Light).toBeDefined();
      expect(lastRing0Revert!.order).toBeLessThan(firstRing1Light!.order);
    });

    it("drops pixels that would land in the reserved top-rows zone", () => {
      // Anchor at (10, 1) with rings going up will spill into y<2.
      const plan = planExplosion({
        anchors: [{ x: 10, y: 1 }],
        canvasWidth: 1000,
        canvasHeight: 1000,
        reservedTopRows: 2,
        colorAt: colorAtZero,
        rings: 3,
        dirsPerAnchor: 8, // try every direction
      });
      for (const w of plan) {
        expect(w.y).toBeGreaterThanOrEqual(2);
      }
    });

    it("drops pixels off-canvas", () => {
      const plan = planExplosion({
        anchors: [{ x: 999, y: 999 }],
        canvasWidth: 1000,
        canvasHeight: 1000,
        reservedTopRows: 2,
        colorAt: colorAtZero,
        rings: 3,
        dirsPerAnchor: 8,
      });
      for (const w of plan) {
        expect(w.x).toBeGreaterThanOrEqual(0);
        expect(w.y).toBeGreaterThanOrEqual(0);
        expect(w.x).toBeLessThan(1000);
        expect(w.y).toBeLessThan(1000);
      }
    });

    it("skips a cell whose prev color is already SPARKLE_COLOR (no double-light)", () => {
      // Pre-paint pixels at the ring-1 East and ring-1 South of anchor as sparkle.
      const sparkleMap = new Map<string, number>();
      const colorAt = (x: number, y: number) =>
        sparkleMap.get(`${x},${y}`) ?? 0;
      sparkleMap.set("501,500", SPARKLE_COLOR);
      const plan = planExplosion({
        anchors: [{ x: 500, y: 500 }],
        canvasWidth: 1000,
        canvasHeight: 1000,
        reservedTopRows: 2,
        colorAt,
        rings: 1,
        dirsPerAnchor: 8,
      });
      for (const w of plan) {
        expect(`${w.x},${w.y}`).not.toBe("501,500");
      }
    });

    it("with 3 anchors × 2 dirs × 3 rings: 36 total writes (18 light + 18 revert) at canvas interior", () => {
      const plan = planExplosion({
        anchors: [
          { x: 200, y: 200 },
          { x: 500, y: 500 },
          { x: 800, y: 800 },
        ],
        canvasWidth: 1000,
        canvasHeight: 1000,
        reservedTopRows: 2,
        colorAt: colorAtZero,
        rings: 3,
        dirsPerAnchor: 2,
      });
      expect(plan).toHaveLength(36);
    });
  });

  describe("chunksForAnchors", () => {
    it("returns the anchor's own chunk for an interior anchor", () => {
      const chunks = chunksForAnchors(
        [{ x: 550, y: 550 }],
        100,
        10,
        10,
        3,
      );
      // Anchor at (550, 550) with rings ≤3 stays within (5, 5).
      expect(chunks).toContainEqual({ cx: 5, cy: 5 });
    });
    it("returns multiple chunks when an anchor sits near a chunk boundary", () => {
      // Anchor at (99, 99) — bottom-right corner of chunk (0, 0).
      // Ring 1 spills into (1, 0), (0, 1), (1, 1).
      const chunks = chunksForAnchors([{ x: 99, y: 99 }], 100, 10, 10, 3);
      const keys = new Set(chunks.map((c) => `${c.cx},${c.cy}`));
      expect(keys.has("0,0")).toBe(true);
      expect(keys.has("1,0")).toBe(true);
      expect(keys.has("0,1")).toBe(true);
      expect(keys.has("1,1")).toBe(true);
    });
    it("clips to the chunk grid (no negative or out-of-grid coords)", () => {
      const chunks = chunksForAnchors([{ x: 0, y: 0 }], 100, 10, 10, 3);
      for (const { cx, cy } of chunks) {
        expect(cx).toBeGreaterThanOrEqual(0);
        expect(cy).toBeGreaterThanOrEqual(0);
        expect(cx).toBeLessThan(10);
        expect(cy).toBeLessThan(10);
      }
    });
  });
});
