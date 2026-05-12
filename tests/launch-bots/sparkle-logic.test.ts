// Unit tests for the M2.5 sparkle launch bot's pure logic.
// Targets the boundaries the cron route can't easily exercise:
//   - "all 20 events are self-writes" returns null (sparkle skips)
//   - anchors near the canvas edge clip cleanly (not off-canvas writes)
//   - the 8 cardinal+diagonal offsets are correct

import { describe, expect, it } from "vitest";

import {
  SPARKLE_COLOR,
  SPARKLE_OFFSETS,
  pickNonSelfAnchor,
  sparkleTargets,
  type SparkleEvent,
} from "@/src/launch-bots/sparkle-logic";

const SELF = "m25-sparkle";

function ev(
  x: number,
  y: number,
  bot_name: string,
  accepted_at = "2026-05-12T12:00:00.000Z",
): SparkleEvent {
  return { x, y, bot_name, accepted_at };
}

describe("sparkle-logic", () => {
  describe("constants", () => {
    it("SPARKLE_COLOR is palette index 7", () => {
      expect(SPARKLE_COLOR).toBe(7);
    });
    it("8 surrounding offsets, excluding (0, 0)", () => {
      expect(SPARKLE_OFFSETS).toHaveLength(8);
      for (const [dx, dy] of SPARKLE_OFFSETS) {
        expect(dx === 0 && dy === 0).toBe(false);
        expect(Math.abs(dx)).toBeLessThanOrEqual(1);
        expect(Math.abs(dy)).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("pickNonSelfAnchor", () => {
    it("returns the first non-self event in a feed", () => {
      const events = [
        ev(10, 10, SELF),
        ev(20, 20, "alice"),
        ev(30, 30, "bob"),
      ];
      const anchor = pickNonSelfAnchor(events, SELF);
      expect(anchor).not.toBeNull();
      expect(anchor!.x).toBe(20);
      expect(anchor!.bot_name).toBe("alice");
    });
    it("returns null when every event is self-authored", () => {
      const events = [ev(1, 1, SELF), ev(2, 2, SELF), ev(3, 3, SELF)];
      expect(pickNonSelfAnchor(events, SELF)).toBeNull();
    });
    it("returns null on an empty feed", () => {
      expect(pickNonSelfAnchor([], SELF)).toBeNull();
    });
    it("returns the only event when there's exactly one non-self event", () => {
      const events = [ev(7, 7, "lonely-bot")];
      const anchor = pickNonSelfAnchor(events, SELF);
      expect(anchor!.bot_name).toBe("lonely-bot");
    });
  });

  describe("sparkleTargets", () => {
    it("returns all 8 surrounding pixels for a center anchor", () => {
      const targets = sparkleTargets(100, 100, 1000, 1000);
      expect(targets).toHaveLength(8);
    });
    it("clips top-left corner anchor (0, 0): drops 5 off-canvas, keeps 3", () => {
      const targets = sparkleTargets(0, 0, 1000, 1000);
      // From (0, 0): valid neighbors are (1, 0), (0, 1), (1, 1) — 3.
      expect(targets).toHaveLength(3);
      expect(targets).toContainEqual([1, 0]);
      expect(targets).toContainEqual([0, 1]);
      expect(targets).toContainEqual([1, 1]);
    });
    it("clips bottom-right corner anchor (W-1, H-1)", () => {
      const targets = sparkleTargets(999, 999, 1000, 1000);
      expect(targets).toHaveLength(3);
      expect(targets).toContainEqual([998, 998]);
      expect(targets).toContainEqual([999, 998]);
      expect(targets).toContainEqual([998, 999]);
    });
    it("clips top edge but not sides (y=0, x somewhere in the middle)", () => {
      const targets = sparkleTargets(500, 0, 1000, 1000);
      // Top row clipped: drops (dy=-1, *) = 3 cells. Keeps 5.
      expect(targets).toHaveLength(5);
      for (const [, y] of targets) expect(y).toBeGreaterThanOrEqual(0);
    });
    it("never writes off-canvas regardless of anchor position", () => {
      // Walk anchors across the corner regions and assert bounds.
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
    it("returns at most 8 targets", () => {
      const targets = sparkleTargets(50, 50, 1000, 1000);
      expect(targets.length).toBeLessThanOrEqual(8);
    });
  });
});
