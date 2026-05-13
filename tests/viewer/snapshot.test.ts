// Codec round-trip tests for the binary snapshot format. Pure logic —
// no DB, no network. Verifies the on-wire layout and the failure modes
// the viewer/route handler depend on.

import { describe, expect, it } from "vitest";

import {
  SNAPSHOT_FORMAT_VERSION,
  SNAPSHOT_MAGIC,
  decodeSnapshot,
  encodeSnapshot,
  type SnapshotChunk,
} from "@/src/viewer/snapshot";

const CHUNK_SIZE = 4; // small test size — 16 bytes per chunk
const CHUNK_BYTES = CHUNK_SIZE * CHUNK_SIZE;

function bytes(fill: number): Uint8Array {
  const b = new Uint8Array(CHUNK_BYTES);
  b.fill(fill);
  return b;
}

describe("snapshot codec", () => {
  it("encodes an empty snapshot as just the 16-byte header", () => {
    const buf = encodeSnapshot([], { chunk_size: CHUNK_SIZE });
    expect(buf.length).toBe(16);
    // Magic.
    for (let i = 0; i < SNAPSHOT_MAGIC.length; i++) {
      expect(buf[i]).toBe(SNAPSHOT_MAGIC[i]);
    }
    expect(buf[4]).toBe(SNAPSHOT_FORMAT_VERSION);
    // Decode-side parses chunk_size and chunk_count = 0.
    const decoded = decodeSnapshot(buf);
    expect(decoded.chunk_size).toBe(CHUNK_SIZE);
    expect(decoded.chunks).toEqual([]);
  });

  it("round-trips multiple chunks preserving order and bytes", () => {
    const chunks: SnapshotChunk[] = [
      { chunk_x: 0, chunk_y: 0, version: "1", bytes: bytes(0xa1) },
      { chunk_x: 3, chunk_y: 1, version: "42", bytes: bytes(0xb2) },
      { chunk_x: 2, chunk_y: 7, version: "100", bytes: bytes(0xc3) },
    ];
    const buf = encodeSnapshot(chunks, { chunk_size: CHUNK_SIZE });
    const decoded = decodeSnapshot(buf);
    expect(decoded.chunk_size).toBe(CHUNK_SIZE);
    expect(decoded.chunks.length).toBe(3);
    for (let i = 0; i < chunks.length; i++) {
      expect(decoded.chunks[i].chunk_x).toBe(chunks[i].chunk_x);
      expect(decoded.chunks[i].chunk_y).toBe(chunks[i].chunk_y);
      expect(decoded.chunks[i].version).toBe(chunks[i].version);
      expect(decoded.chunks[i].bytes.length).toBe(CHUNK_BYTES);
      expect(decoded.chunks[i].bytes).toEqual(chunks[i].bytes);
    }
  });

  it("handles bigint-grade versions without precision loss", () => {
    const huge = "9999999999999999999"; // > 2^53
    const chunks: SnapshotChunk[] = [
      { chunk_x: 1, chunk_y: 2, version: huge, bytes: bytes(0x00) },
    ];
    const buf = encodeSnapshot(chunks, { chunk_size: CHUNK_SIZE });
    const decoded = decodeSnapshot(buf);
    expect(decoded.chunks[0].version).toBe(huge);
  });

  it("rejects a chunk whose bytes are the wrong length", () => {
    const chunks: SnapshotChunk[] = [
      {
        chunk_x: 0,
        chunk_y: 0,
        version: "1",
        bytes: new Uint8Array(CHUNK_BYTES - 1),
      },
    ];
    expect(() => encodeSnapshot(chunks, { chunk_size: CHUNK_SIZE })).toThrow(
      /expected/,
    );
  });

  it("decodes correctly even when the underlying buffer has a non-zero offset", () => {
    // Simulate what `new Uint8Array(await res.arrayBuffer()).subarray(N)`
    // looks like — a Uint8Array view with byteOffset > 0. The decoder
    // uses DataView(buf.buffer, buf.byteOffset, buf.byteLength) so this
    // must work.
    const inner = encodeSnapshot(
      [{ chunk_x: 5, chunk_y: 6, version: "7", bytes: bytes(0x55) }],
      { chunk_size: CHUNK_SIZE },
    );
    const padded = new Uint8Array(inner.length + 8);
    padded.set(inner, 8);
    const view = padded.subarray(8);
    const decoded = decodeSnapshot(view);
    expect(decoded.chunks[0].chunk_x).toBe(5);
    expect(decoded.chunks[0].chunk_y).toBe(6);
    expect(decoded.chunks[0].version).toBe("7");
    expect(decoded.chunks[0].bytes[0]).toBe(0x55);
  });

  it("rejects buffers smaller than the header", () => {
    expect(() => decodeSnapshot(new Uint8Array(8))).toThrow(/too short/);
  });

  it("rejects a bad magic", () => {
    const buf = encodeSnapshot([], { chunk_size: CHUNK_SIZE });
    buf[0] = 0xff;
    expect(() => decodeSnapshot(buf)).toThrow(/magic/);
  });

  it("rejects an unknown format version", () => {
    const buf = encodeSnapshot([], { chunk_size: CHUNK_SIZE });
    buf[4] = 99;
    expect(() => decodeSnapshot(buf)).toThrow(/format version/);
  });

  it("rejects truncated bodies", () => {
    const buf = encodeSnapshot(
      [{ chunk_x: 0, chunk_y: 0, version: "1", bytes: bytes(1) }],
      { chunk_size: CHUNK_SIZE },
    );
    const trunc = buf.subarray(0, buf.length - 1);
    expect(() => decodeSnapshot(trunc)).toThrow(/length/);
  });

  it("decoded chunk bytes are decoupled from the source buffer", () => {
    // After decode, mutating the source must not affect the cached
    // bytes the viewer hands to the canvas.
    const buf = encodeSnapshot(
      [{ chunk_x: 0, chunk_y: 0, version: "1", bytes: bytes(0xaa) }],
      { chunk_size: CHUNK_SIZE },
    );
    const decoded = decodeSnapshot(buf);
    // Mutate the source buffer's data region.
    buf.fill(0x00, 16);
    expect(decoded.chunks[0].bytes[0]).toBe(0xaa);
  });
});
