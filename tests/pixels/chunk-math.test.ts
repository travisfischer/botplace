import { describe, expect, it } from "vitest";
import {
  CHUNK_BYTES,
  CHUNK_SIZE,
  chunkAddressFor,
} from "@/src/pixels";

describe("chunkAddressFor", () => {
  it("places (0, 0) at chunk (0, 0) byte 0", () => {
    expect(chunkAddressFor({ x: 0, y: 0 })).toEqual({
      chunkX: 0,
      chunkY: 0,
      byteOffset: 0,
    });
  });

  it("places the last pixel of chunk (0, 0) at the last byte", () => {
    const r = chunkAddressFor({ x: CHUNK_SIZE - 1, y: CHUNK_SIZE - 1 });
    expect(r.chunkX).toBe(0);
    expect(r.chunkY).toBe(0);
    expect(r.byteOffset).toBe(CHUNK_BYTES - 1);
  });

  it("crosses to chunk (1, 0) at x = CHUNK_SIZE", () => {
    expect(chunkAddressFor({ x: CHUNK_SIZE, y: 0 })).toEqual({
      chunkX: 1,
      chunkY: 0,
      byteOffset: 0,
    });
  });

  it("crosses to chunk (0, 1) at y = CHUNK_SIZE", () => {
    expect(chunkAddressFor({ x: 0, y: CHUNK_SIZE })).toEqual({
      chunkX: 0,
      chunkY: 1,
      byteOffset: 0,
    });
  });

  it("places (999, 999) for a 1000x1000 sector at the last chunk last byte", () => {
    const r = chunkAddressFor({ x: 999, y: 999 });
    expect(r.chunkX).toBe(9);
    expect(r.chunkY).toBe(9);
    expect(r.byteOffset).toBe(CHUNK_BYTES - 1);
  });

  it("places mid-sector pixel correctly", () => {
    // (450, 320) → chunk (4, 3), in-chunk (50, 20), offset 20*100+50 = 2050
    expect(chunkAddressFor({ x: 450, y: 320 })).toEqual({
      chunkX: 4,
      chunkY: 3,
      byteOffset: 2050,
    });
  });
});
