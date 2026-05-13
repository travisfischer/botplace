// Unit tests for the M2.5 Conway launch bot's pure logic.
// Targets the boundaries the cron route can't easily exercise:
//   - palette-aware tie-break to LOWEST index on a 3-way color tie
//   - edge cells treat off-chunk neighbors as dead
//   - R-pentomino seed stays in-chunk for various chunk coordinates
//   - countAlive uses CONWAY_COLORS (not "any non-zero")
//   - chunkForTick covers all 100 chunks across the rotation period
//   - palette isolation: reserved colors (6, 7) flow through Conway untouched
//   - reserved top rows: Conway never writes y < RESERVED_TOP_ROWS in cy=0

import { describe, expect, it } from "vitest";

import {
  CONWAY_COLORS,
  R_PENTOMINO,
  RESERVED_TOP_ROWS,
  birthColor,
  chunkForTick,
  conwayStep,
  countAlive,
  isConwayColor,
  maybeSeed,
  mergeChanges,
  seedColorForChunk,
} from "@/src/launch-bots/conway-logic";

function bytesOf(rows: ReadonlyArray<ReadonlyArray<number>>): Uint8Array {
  const h = rows.length;
  const w = rows[0].length;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = rows[y][x];
  }
  return out;
}

describe("conway-logic", () => {
  describe("palette constants", () => {
    it("CONWAY_COLORS is exactly {1,2,3,4,5}", () => {
      expect([...CONWAY_COLORS]).toEqual([1, 2, 3, 4, 5]);
    });
    it("isConwayColor: 1..5 in, 0/6/7 out", () => {
      for (const c of [1, 2, 3, 4, 5]) expect(isConwayColor(c)).toBe(true);
      for (const c of [0, 6, 7, 8, -1]) expect(isConwayColor(c)).toBe(false);
    });
    it("RESERVED_TOP_ROWS is 2 (matches visitor-pulse meter height)", () => {
      expect(RESERVED_TOP_ROWS).toBe(2);
    });
  });

  describe("countAlive", () => {
    it("counts CONWAY_COLORS cells as alive", () => {
      expect(countAlive(new Uint8Array([0, 0, 0]))).toBe(0);
      expect(countAlive(new Uint8Array([1, 0, 2, 0, 5]))).toBe(3);
      expect(countAlive(new Uint8Array([1, 1, 1, 1]))).toBe(4);
    });
    it("does NOT count reserved colors (6, 7) as alive", () => {
      // 4 conway-color cells + 3 reserved cells → countAlive returns 4.
      expect(countAlive(new Uint8Array([1, 6, 2, 7, 3, 7, 4]))).toBe(4);
      // All reserved → 0 alive.
      expect(countAlive(new Uint8Array([6, 7, 6, 7]))).toBe(0);
    });
  });

  describe("birthColor", () => {
    it("returns the mode when one color dominates", () => {
      expect(birthColor([3, 3, 5])).toBe(3);
      expect(birthColor([2, 5, 5])).toBe(5);
    });
    it("picks the LOWEST palette index on a 3-way tie", () => {
      // 3 different colors, each count 1 → tie. Lowest wins.
      expect(birthColor([5, 3, 4])).toBe(3);
      expect(birthColor([4, 1, 5])).toBe(1);
      expect(birthColor([2, 5, 3])).toBe(2);
    });
    it("picks the LOWEST palette index on a 2-way tie (count = 1 each)", () => {
      // Only happens for aliveCount=2, but covered for completeness.
      expect(birthColor([5, 3])).toBe(3);
    });
  });

  describe("conwayStep", () => {
    it("kills a lone alive cell (underpopulation)", () => {
      const bytes = bytesOf([
        [0, 0, 0],
        [0, 3, 0],
        [0, 0, 0],
      ]);
      const { next, changes } = conwayStep(bytes, 3, /* cy = */ 5);
      expect(next[4]).toBe(0); // center cell died
      expect(changes).toHaveLength(1);
      expect(changes[0]).toEqual({ x: 1, y: 1, oldColor: 3, newColor: 0 });
    });

    it("survives an alive cell with exactly 2 alive neighbors (color preserved)", () => {
      // Three in a row → middle survives with 2 neighbors. Ends die.
      const bytes = bytesOf([
        [0, 0, 0],
        [5, 5, 5],
        [0, 0, 0],
      ]);
      const { next } = conwayStep(bytes, 3, 5);
      expect(next[3]).toBe(0); // left end died
      expect(next[4]).toBe(5); // middle survived in its color
      expect(next[5]).toBe(0); // right end died
    });

    it("births a dead cell with exactly 3 alive neighbors", () => {
      const bytes = bytesOf([
        [4, 0, 0],
        [4, 0, 0],
        [4, 0, 0],
      ]);
      const { next } = conwayStep(bytes, 3, 5);
      // Middle cell (1, 1) has 3 alive neighbors of color 4 → born as 4.
      expect(next[1 * 3 + 1]).toBe(4);
    });

    it("on a 3-way color tie at birth, uses LOWEST palette index", () => {
      const board = new Uint8Array(49);
      board[2 * 7 + 2] = 5;
      board[2 * 7 + 3] = 2;
      board[2 * 7 + 4] = 4;
      const { next } = conwayStep(board, 7, 5);
      expect(next[3 * 7 + 3]).toBe(2);
    });

    it("treats off-chunk neighbors as dead (corner cell)", () => {
      const bytes = bytesOf([
        [0, 1, 0],
        [1, 0, 0],
        [0, 0, 0],
      ]);
      bytes[1 * 3 + 1] = 2;
      const { next } = conwayStep(bytes, 3, 5);
      // (0,0) neighbors: (1,0)=1, (0,1)=1, (1,1)=2 → 3 alive, mode = 1.
      expect(next[0]).toBe(1);
    });

    it("returns a freshly-allocated next array (doesn't mutate input)", () => {
      const bytes = bytesOf([
        [0, 1, 0],
        [1, 1, 1],
        [0, 1, 0],
      ]);
      const original = new Uint8Array(bytes);
      conwayStep(bytes, 3, 5);
      expect(Array.from(bytes)).toEqual(Array.from(original));
    });

    it("preserves color-7 (sparkle) cells exactly — never overwrites them", () => {
      // Three alive conway cells around a color-7 anchor. Without
      // isolation, conway would treat 7 as alive and homogenize. With
      // isolation: 7 is ignored as a neighbor AND preserved at its
      // position.
      const bytes = bytesOf([
        [3, 3, 3],
        [0, 7, 0],
        [0, 0, 0],
      ]);
      const { next } = conwayStep(bytes, 3, 5);
      // Color-7 cell stays color-7.
      expect(next[1 * 3 + 1]).toBe(7);
      // The dead cell at (1, 2) has neighbors: (0,1)=0, (1,1)=7→ignored,
      // (2,1)=0, (0,2)=0, (2,2)=0 → 0 conway-color neighbors. No birth.
      expect(next[2 * 3 + 1]).toBe(0);
    });

    it("preserves color-6 (visitor-pulse meter) cells exactly", () => {
      const bytes = bytesOf([
        [3, 3, 3],
        [0, 6, 0],
        [0, 0, 0],
      ]);
      const { next } = conwayStep(bytes, 3, 5);
      expect(next[1 * 3 + 1]).toBe(6);
    });

    it("ignores reserved colors when counting alive neighbors for birth", () => {
      // Dead center cell with 2 conway-color neighbors + 1 color-7
      // neighbor. The 7 is ignored → aliveCount=2 → no birth.
      const bytes = bytesOf([
        [3, 7, 3],
        [0, 0, 0],
        [0, 0, 0],
      ]);
      const { next } = conwayStep(bytes, 3, 5);
      expect(next[1 * 3 + 1]).toBe(0);
    });

    it("skips cells in the reserved top-rows zone (absY < RESERVED_TOP_ROWS)", () => {
      // cy=0 means absolute y = y. Rows 0 and 1 must be preserved
      // verbatim regardless of their content (alive, dead, reserved
      // colors). Row 2+ evolves normally.
      const bytes = bytesOf([
        [6, 6, 6],
        [0, 1, 0],
        [3, 3, 3],
      ]);
      const { next } = conwayStep(bytes, 3, /* cy = */ 0);
      // Row 0 (color 6 meter) untouched.
      expect(next[0]).toBe(6);
      expect(next[1]).toBe(6);
      expect(next[2]).toBe(6);
      // Row 1 (a lone alive cell) — also in the reserved zone, untouched.
      expect(next[3]).toBe(0);
      expect(next[4]).toBe(1);
      expect(next[5]).toBe(0);
    });

    it("non-cy-0 chunks evolve top rows normally (only cy=0 has reserved zone)", () => {
      // Same byte pattern but cy=3 → absY=300..302, well outside the
      // reserved zone. Now Conway evolves rows 0+ normally.
      const bytes = bytesOf([
        [5, 5, 5],
        [0, 0, 0],
        [0, 0, 0],
      ]);
      const { next } = conwayStep(bytes, 3, /* cy = */ 3);
      // Middle of row 0 has 2 alive horizontal neighbors → survives.
      expect(next[1]).toBe(5);
      // Ends of row 0 have only 1 alive neighbor → die.
      expect(next[0]).toBe(0);
      expect(next[2]).toBe(0);
    });
  });

  describe("seedColorForChunk", () => {
    it("only returns CONWAY_COLORS (1..5)", () => {
      for (let cx = 0; cx < 10; cx++) {
        for (let cy = 0; cy < 10; cy++) {
          const c = seedColorForChunk(cx, cy);
          expect(c).toBeGreaterThanOrEqual(1);
          expect(c).toBeLessThanOrEqual(5);
        }
      }
    });
    it("is deterministic per (cx, cy)", () => {
      expect(seedColorForChunk(3, 5)).toBe(seedColorForChunk(3, 5));
      expect(seedColorForChunk(0, 0)).toBe(seedColorForChunk(0, 0));
    });
  });

  describe("maybeSeed", () => {
    it("seeds when alive count < MIN_ALIVE_FOR_NO_SEED", () => {
      const bytes = new Uint8Array(64 * 64); // empty chunk
      const changes = maybeSeed(bytes, 64, 5, 5);
      expect(changes).toHaveLength(R_PENTOMINO.length);
      const seedColor = seedColorForChunk(5, 5);
      expect(countAlive(bytes)).toBe(R_PENTOMINO.length);
      for (const change of changes) {
        expect(change.newColor).toBe(seedColor);
      }
    });

    it("does nothing when chunk has >= MIN_ALIVE_FOR_NO_SEED alive cells", () => {
      const bytes = new Uint8Array(64 * 64);
      // Sprinkle 12 alive cells (above the threshold).
      for (let i = 0; i < 12; i++) bytes[i * 17] = 1;
      const before = new Uint8Array(bytes);
      const changes = maybeSeed(bytes, 64, 0, 0);
      expect(changes).toHaveLength(0);
      expect(Array.from(bytes)).toEqual(Array.from(before));
    });

    it("doesn't count reserved-color cells toward the no-seed threshold", () => {
      // 12 color-7 cells (above threshold by raw count, but 0 by
      // CONWAY_COLORS count) — seed should still fire.
      const bytes = new Uint8Array(64 * 64);
      for (let i = 0; i < 12; i++) bytes[i * 17] = 7;
      const changes = maybeSeed(bytes, 64, 5, 5);
      expect(changes).toHaveLength(R_PENTOMINO.length);
    });

    it("keeps the R-pentomino strictly in-chunk for every chunk coord", () => {
      // chunks_x=10, chunks_y=10. Walk all 100 chunk coords on a
      // chunk_size=64 grid and assert every seed cell stays in bounds.
      for (let cx = 0; cx < 10; cx++) {
        for (let cy = 0; cy < 10; cy++) {
          const bytes = new Uint8Array(64 * 64);
          const changes = maybeSeed(bytes, 64, cx, cy);
          for (const c of changes) {
            expect(c.x).toBeGreaterThanOrEqual(0);
            expect(c.x).toBeLessThan(64);
            expect(c.y).toBeGreaterThanOrEqual(0);
            expect(c.y).toBeLessThan(64);
          }
        }
      }
    });

    it("for cy=0 chunks, never seeds inside the reserved top-rows zone", () => {
      for (let cx = 0; cx < 10; cx++) {
        const bytes = new Uint8Array(64 * 64);
        const changes = maybeSeed(bytes, 64, cx, 0);
        for (const c of changes) {
          // Absolute y == c.y when cy=0; must be >= RESERVED_TOP_ROWS.
          expect(c.y).toBeGreaterThanOrEqual(RESERVED_TOP_ROWS);
        }
      }
    });
  });

  describe("chunkForTick", () => {
    it("covers ALL chunks across one rotation period", () => {
      const seen = new Set<string>();
      const start = 0;
      for (let m = 0; m < 100; m++) {
        const { cx, cy } = chunkForTick(start + m * 60_000, 10, 10);
        seen.add(`${cx},${cy}`);
      }
      // 100 chunks × 1 min each → every chunk visited exactly once
      // during a 100-minute cycle. Crucially includes cy=6..9 (the
      // bottom 40% the previous chunkForMinute couldn't reach).
      expect(seen.size).toBe(100);
      // Spot-check: cy=9 is visited.
      const cy9 = [...seen].filter((s) => s.endsWith(",9"));
      expect(cy9.length).toBe(10);
    });
    it("wraps cleanly after one period", () => {
      // Tick at minute 0 and minute 100 should be the same chunk.
      const a = chunkForTick(0, 10, 10);
      const b = chunkForTick(100 * 60_000, 10, 10);
      expect(a).toEqual(b);
    });
    it("uses row-major order: idx = cy * chunks_x + cx", () => {
      expect(chunkForTick(0, 10, 10)).toEqual({ cx: 0, cy: 0 });
      expect(chunkForTick(1 * 60_000, 10, 10)).toEqual({ cx: 1, cy: 0 });
      expect(chunkForTick(10 * 60_000, 10, 10)).toEqual({ cx: 0, cy: 1 });
      expect(chunkForTick(15 * 60_000, 10, 10)).toEqual({ cx: 5, cy: 1 });
      expect(chunkForTick(99 * 60_000, 10, 10)).toEqual({ cx: 9, cy: 9 });
    });
    it("defaults to chunk 0 on negative or non-finite inputs", () => {
      expect(chunkForTick(-1, 10, 10)).toEqual({ cx: 0, cy: 0 });
      expect(chunkForTick(Number.NaN, 10, 10)).toEqual({ cx: 0, cy: 0 });
    });
  });

  describe("mergeChanges", () => {
    it("step changes win when both target the same cell", () => {
      const chunkSize = 4;
      const seed = [{ x: 1, y: 1, oldColor: 0, newColor: 3 }];
      const step = [{ x: 1, y: 1, oldColor: 0, newColor: 5 }];
      const merged = mergeChanges(seed, step, chunkSize);
      expect(merged).toHaveLength(1);
      expect(merged[0]).toEqual({ x: 1, y: 1, newColor: 5 });
    });
    it("keeps non-conflicting cells from both lists", () => {
      const seed = [{ x: 0, y: 0, oldColor: 0, newColor: 2 }];
      const step = [{ x: 1, y: 0, oldColor: 0, newColor: 5 }];
      const merged = mergeChanges(seed, step, 4);
      expect(merged).toHaveLength(2);
    });
  });
});
