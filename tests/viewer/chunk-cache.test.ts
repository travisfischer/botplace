// Unit tests for the chunk cache + manifest diff. Pure logic — no DB,
// no network, no DOM. Runs in the default vitest environment.

import { describe, expect, it } from "vitest";

import {
  ChunkCache,
  compareVersion,
  type ManifestEntry,
} from "@/src/viewer/chunk-cache";

describe("compareVersion", () => {
  it("is 0 for equal strings", () => {
    expect(compareVersion("0", "0")).toBe(0);
    expect(compareVersion("12345678901234567890", "12345678901234567890")).toBe(0);
  });

  it("orders by length first (handles big bigints correctly)", () => {
    expect(compareVersion("9", "10")).toBe(-1);
    expect(compareVersion("100", "99")).toBe(1);
    expect(compareVersion("99999999999999", "100000000000000")).toBe(-1);
  });

  it("orders lexicographically when lengths match", () => {
    expect(compareVersion("11", "12")).toBe(-1);
    expect(compareVersion("12", "11")).toBe(1);
  });
});

describe("ChunkCache", () => {
  it("set/get/has/version round-trip", () => {
    const c = new ChunkCache();
    expect(c.has(0, 0)).toBe(false);
    expect(c.get(0, 0)).toBeUndefined();
    expect(c.version(0, 0)).toBeUndefined();
    const bytes = new Uint8Array([1, 2, 3]);
    c.set(0, 0, "5", bytes);
    expect(c.has(0, 0)).toBe(true);
    expect(c.version(0, 0)).toBe("5");
    expect(c.get(0, 0)?.bytes).toBe(bytes);
  });

  it("entries iterate in (y, x) order", () => {
    const c = new ChunkCache();
    c.set(2, 0, "1", new Uint8Array());
    c.set(0, 1, "1", new Uint8Array());
    c.set(0, 0, "1", new Uint8Array());
    c.set(1, 0, "1", new Uint8Array());
    const order = [...c.entries()].map(([x, y]) => `${x},${y}`);
    expect(order).toEqual(["0,0", "1,0", "2,0", "0,1"]);
  });

  describe("diff", () => {
    function entry(
      chunk_x: number,
      chunk_y: number,
      version: string,
    ): ManifestEntry {
      return { chunk_x, chunk_y, version, updated_at: "2026-05-09T00:00:00Z" };
    }

    it("returns all manifest entries for empty cache", () => {
      const cache = new ChunkCache();
      const stale = cache.diff([entry(0, 0, "1"), entry(1, 0, "3")]);
      expect(stale.length).toBe(2);
    });

    it("excludes entries where local >= remote", () => {
      const cache = new ChunkCache();
      cache.set(0, 0, "5", new Uint8Array());
      cache.set(1, 0, "3", new Uint8Array());
      const stale = cache.diff([
        entry(0, 0, "5"), // equal → skip
        entry(1, 0, "4"), // remote > local → include
        entry(2, 0, "1"), // not in local → include
      ]);
      expect(stale.map((e) => `${e.chunk_x},${e.chunk_y}`)).toEqual([
        "1,0",
        "2,0",
      ]);
    });

    it("keeps locally-cached chunks not present in manifest (IM-1)", () => {
      // Manifest omits unwritten chunks. If a chunk we have cached locally
      // is missing from the manifest, that's expected — we don't drop it.
      const cache = new ChunkCache();
      cache.set(5, 5, "10", new Uint8Array());
      const stale = cache.diff([entry(0, 0, "1")]);
      expect(stale.length).toBe(1);
      expect(stale[0].chunk_x).toBe(0);
      // The (5,5) chunk we had cached is still in the cache.
      expect(cache.has(5, 5)).toBe(true);
    });

    it("handles bigint-grade versions correctly", () => {
      const cache = new ChunkCache();
      cache.set(0, 0, "9999999999", new Uint8Array());
      const stale = cache.diff([entry(0, 0, "10000000000")]);
      // Length-aware comparison should detect 10000000000 > 9999999999.
      expect(stale.length).toBe(1);
    });
  });
});
