// Unit tests for the M2.5 Conway launch bot's pure logic.
// Targets the boundaries the cron route can't easily exercise:
//   - palette-aware tie-break to LOWEST index on a 3-way color tie
//   - edge cells treat off-chunk neighbors as dead
//   - R-pentomino seed stays in-chunk for various chunk coordinates
//   - countAlive uses non-zero (any palette index) as the "alive" rule
//   - chunkForMinute is deterministic per minute-of-hour

import { describe, expect, it } from "vitest";

import {
  R_PENTOMINO,
  birthColor,
  chunkForMinute,
  conwayStep,
  countAlive,
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
  describe("countAlive", () => {
    it("counts any non-zero cell as alive", () => {
      expect(countAlive(new Uint8Array([0, 0, 0]))).toBe(0);
      expect(countAlive(new Uint8Array([1, 0, 2, 0, 7]))).toBe(3);
      expect(countAlive(new Uint8Array([1, 1, 1, 1]))).toBe(4);
    });
  });

  describe("birthColor", () => {
    it("returns the mode when one color dominates", () => {
      expect(birthColor([3, 3, 5])).toBe(3);
      expect(birthColor([2, 7, 7])).toBe(7);
    });
    it("picks the LOWEST palette index on a 3-way tie", () => {
      // 3 different colors, each count 1 → tie. Lowest wins.
      expect(birthColor([5, 3, 7])).toBe(3);
      expect(birthColor([7, 1, 4])).toBe(1);
      expect(birthColor([2, 6, 9])).toBe(2);
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
      const { next, changes } = conwayStep(bytes, 3);
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
      const { next } = conwayStep(bytes, 3);
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
      const { next } = conwayStep(bytes, 3);
      // Middle cell (1, 1) has 3 alive neighbors of color 4 → born as 4.
      expect(next[1 * 3 + 1]).toBe(4);
    });

    it("on a 3-way color tie at birth, uses LOWEST palette index", () => {
      // Place three alive cells of distinct colors around the dead center.
      // Use 7×7 board so neighbor offsets are clean and unambiguous.
      // Center (3, 3) is dead. Neighbors: (2,2)=5, (3,2)=2, (4,2)=7 →
      // 3 alive neighbors with colors {5, 2, 7}.
      const board = new Uint8Array(49);
      board[2 * 7 + 2] = 5;
      board[2 * 7 + 3] = 2;
      board[2 * 7 + 4] = 7;
      const { next } = conwayStep(board, 7);
      expect(next[3 * 7 + 3]).toBe(2);
    });

    it("treats off-chunk neighbors as dead (corner cell)", () => {
      // Corner cell (0, 0) of a 3x3 chunk has only 3 in-chunk neighbors.
      // Make all three alive → corner birth, color = mode = lowest tie.
      const bytes = bytesOf([
        [0, 1, 0],
        [1, 0, 0],
        [0, 0, 0],
      ]);
      // (0,0) is dead, neighbors at (1,0)=1, (0,1)=1, (1,1)=0. That's
      // 2 alive neighbors, not 3 → corner stays dead. Add (1,1) alive.
      bytes[1 * 3 + 1] = 2;
      const { next } = conwayStep(bytes, 3);
      // (0,0) neighbors: (1,0)=1, (0,1)=1, (1,1)=2 → 3 alive, mode = 1
      // (count 2 of color 1, count 1 of color 2 — 1 wins).
      expect(next[0]).toBe(1);
    });

    it("returns a freshly-allocated next array (doesn't mutate input)", () => {
      const bytes = bytesOf([
        [0, 1, 0],
        [1, 1, 1],
        [0, 1, 0],
      ]);
      const original = new Uint8Array(bytes);
      conwayStep(bytes, 3);
      expect(Array.from(bytes)).toEqual(Array.from(original));
    });
  });

  describe("seedColorForChunk", () => {
    it("skips palette 0 (the default/dead color)", () => {
      for (let cx = 0; cx < 10; cx++) {
        for (let cy = 0; cy < 10; cy++) {
          const c = seedColorForChunk(cx, cy, 8);
          expect(c).toBeGreaterThanOrEqual(1);
          expect(c).toBeLessThanOrEqual(7);
        }
      }
    });
    it("is deterministic per (cx, cy)", () => {
      expect(seedColorForChunk(3, 5, 8)).toBe(seedColorForChunk(3, 5, 8));
      expect(seedColorForChunk(0, 0, 8)).toBe(seedColorForChunk(0, 0, 8));
    });
    it("returns 1 when paletteSize <= 1", () => {
      expect(seedColorForChunk(0, 0, 0)).toBe(1);
      expect(seedColorForChunk(7, 7, 1)).toBe(1);
    });
  });

  describe("maybeSeed", () => {
    it("seeds when alive count < MIN_ALIVE_FOR_NO_SEED", () => {
      const bytes = new Uint8Array(64 * 64); // empty chunk
      const changes = maybeSeed(bytes, 64, 0, 0, 8);
      expect(changes).toHaveLength(R_PENTOMINO.length);
      // The 5 pentomino cells should now be set to the seed color.
      const seedColor = seedColorForChunk(0, 0, 8);
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
      const changes = maybeSeed(bytes, 64, 0, 0, 8);
      expect(changes).toHaveLength(0);
      expect(Array.from(bytes)).toEqual(Array.from(before));
    });

    it("keeps the R-pentomino strictly in-chunk for every chunk coord", () => {
      // chunks_x=10, chunks_y=10. Walk all 100 chunk coords on a
      // chunk_size=64 grid and assert every seed cell stays in bounds.
      for (let cx = 0; cx < 10; cx++) {
        for (let cy = 0; cy < 10; cy++) {
          const bytes = new Uint8Array(64 * 64);
          const changes = maybeSeed(bytes, 64, cx, cy, 8);
          for (const c of changes) {
            expect(c.x).toBeGreaterThanOrEqual(0);
            expect(c.x).toBeLessThan(64);
            expect(c.y).toBeGreaterThanOrEqual(0);
            expect(c.y).toBeLessThan(64);
          }
        }
      }
    });
  });

  describe("chunkForMinute", () => {
    it("walks every chunk index across one full hour", () => {
      const seen = new Set<string>();
      for (let m = 0; m < 60; m++) {
        const { cx, cy } = chunkForMinute(m, 10, 10);
        seen.add(`${cx},${cy}`);
      }
      // With 100 chunks and 60 minutes, we hit minutes 0..59 → indexes
      // 0..59 → 60 distinct chunks.
      expect(seen.size).toBe(60);
    });
    it("wraps the chunk index when total > minute", () => {
      // chunks 4×4 = 16; minute 17 → idx 1.
      expect(chunkForMinute(17, 4, 4)).toEqual({ cx: 1, cy: 0 });
    });
    it("uses row-major order: idx = cy * chunks_x + cx", () => {
      expect(chunkForMinute(0, 10, 10)).toEqual({ cx: 0, cy: 0 });
      expect(chunkForMinute(1, 10, 10)).toEqual({ cx: 1, cy: 0 });
      expect(chunkForMinute(10, 10, 10)).toEqual({ cx: 0, cy: 1 });
      expect(chunkForMinute(15, 10, 10)).toEqual({ cx: 5, cy: 1 });
    });
    it("defaults to chunk 0 on negative or non-finite inputs", () => {
      expect(chunkForMinute(-1, 10, 10)).toEqual({ cx: 0, cy: 0 });
      expect(chunkForMinute(Number.NaN, 10, 10)).toEqual({ cx: 0, cy: 0 });
    });
  });

  describe("mergeChanges", () => {
    it("step changes win when both target the same cell", () => {
      const chunkSize = 4;
      const seed = [{ x: 1, y: 1, oldColor: 0, newColor: 3 }];
      const step = [{ x: 1, y: 1, oldColor: 0, newColor: 7 }];
      const merged = mergeChanges(seed, step, chunkSize);
      expect(merged).toHaveLength(1);
      expect(merged[0]).toEqual({ x: 1, y: 1, newColor: 7 });
    });
    it("keeps non-conflicting cells from both lists", () => {
      const seed = [{ x: 0, y: 0, oldColor: 0, newColor: 2 }];
      const step = [{ x: 1, y: 0, oldColor: 0, newColor: 5 }];
      const merged = mergeChanges(seed, step, 4);
      expect(merged).toHaveLength(2);
    });
  });
});
