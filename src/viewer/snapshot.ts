// Binary snapshot format for the full canvas state. Used by the public
// snapshot endpoint (server: encode) and the viewer's initial-paint path
// (client: decode). Pure logic — no fetch, no DB, no DOM — so the codec
// is shared by both runtimes and unit-testable in isolation.
//
// Layout (little-endian throughout):
//
//   offset  size            field
//   ------  ----            -----
//   0       4 bytes         magic = "BPSS"
//   4       1 byte          format version = 1
//   5       3 bytes         reserved (zero)
//   8       4 bytes (u32)   chunk_size (pixels per side)
//   12      4 bytes (u32)   chunk_count (N)
//   16      N × 12 bytes    index entries: { u16 chunk_x, u16 chunk_y,
//                                            u64 version }
//   ...     N × CB bytes    chunk data, in index order (CB = chunk_size²)
//
// Empty sectors encode to just the 16-byte header. Per-chunk versions
// match the wire format from the chunk endpoint (BigInt → decimal string
// on decode) so the cache can seed `If-None-Match` from snapshot bytes
// the same way it does from a chunk fetch.

export const SNAPSHOT_MAGIC = new Uint8Array([0x42, 0x50, 0x53, 0x53]); // "BPSS"
export const SNAPSHOT_FORMAT_VERSION = 1;
const HEADER_BYTES = 16;
const ENTRY_BYTES = 12;

export interface SnapshotChunk {
  chunk_x: number;
  chunk_y: number;
  /** BigInt-as-string, matching ManifestEntry.version on the wire. */
  version: string;
  /** chunk_size² palette indices. */
  bytes: Uint8Array;
}

export interface DecodedSnapshot {
  chunk_size: number;
  chunks: SnapshotChunk[];
}

export interface EncodeOptions {
  chunk_size: number;
}

export function encodeSnapshot(
  chunks: readonly SnapshotChunk[],
  opts: EncodeOptions,
): Uint8Array<ArrayBuffer> {
  const { chunk_size } = opts;
  const chunkBytes = chunk_size * chunk_size;
  for (const c of chunks) {
    if (c.bytes.length !== chunkBytes) {
      throw new Error(
        `snapshot chunk (${c.chunk_x},${c.chunk_y}) has ${c.bytes.length} bytes; expected ${chunkBytes}`,
      );
    }
  }
  const totalBytes = HEADER_BYTES + chunks.length * (ENTRY_BYTES + chunkBytes);
  const buf = new Uint8Array(totalBytes);
  const view = new DataView(buf.buffer);

  buf.set(SNAPSHOT_MAGIC, 0);
  view.setUint8(4, SNAPSHOT_FORMAT_VERSION);
  // bytes 5..7 stay zero (reserved).
  view.setUint32(8, chunk_size, true);
  view.setUint32(12, chunks.length, true);

  let off = HEADER_BYTES;
  for (const c of chunks) {
    view.setUint16(off, c.chunk_x, true);
    view.setUint16(off + 2, c.chunk_y, true);
    view.setBigUint64(off + 4, BigInt(c.version), true);
    off += ENTRY_BYTES;
  }
  for (const c of chunks) {
    buf.set(c.bytes, off);
    off += chunkBytes;
  }
  return buf;
}

export function decodeSnapshot(buf: Uint8Array): DecodedSnapshot {
  if (buf.length < HEADER_BYTES) {
    throw new Error(`snapshot too short: ${buf.length} < ${HEADER_BYTES}`);
  }
  for (let i = 0; i < SNAPSHOT_MAGIC.length; i++) {
    if (buf[i] !== SNAPSHOT_MAGIC[i]) {
      throw new Error("snapshot magic mismatch");
    }
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const formatVersion = view.getUint8(4);
  if (formatVersion !== SNAPSHOT_FORMAT_VERSION) {
    throw new Error(
      `snapshot format version ${formatVersion} not supported (expected ${SNAPSHOT_FORMAT_VERSION})`,
    );
  }
  const chunk_size = view.getUint32(8, true);
  const chunk_count = view.getUint32(12, true);
  const chunkBytes = chunk_size * chunk_size;
  const expectedBytes = HEADER_BYTES + chunk_count * (ENTRY_BYTES + chunkBytes);
  if (buf.length !== expectedBytes) {
    throw new Error(
      `snapshot length ${buf.length} != expected ${expectedBytes} (chunk_size=${chunk_size}, chunk_count=${chunk_count})`,
    );
  }

  const chunks: SnapshotChunk[] = [];
  const dataBase = HEADER_BYTES + chunk_count * ENTRY_BYTES;
  for (let i = 0; i < chunk_count; i++) {
    const entryOff = HEADER_BYTES + i * ENTRY_BYTES;
    const chunk_x = view.getUint16(entryOff, true);
    const chunk_y = view.getUint16(entryOff + 2, true);
    const version = view.getBigUint64(entryOff + 4, true).toString();
    const dataOff = dataBase + i * chunkBytes;
    // Copy out so the snapshot's underlying buffer can be GC'd once
    // callers hand individual chunk bytes off to longer-lived caches.
    const bytes = new Uint8Array(chunkBytes);
    bytes.set(buf.subarray(dataOff, dataOff + chunkBytes));
    chunks.push({ chunk_x, chunk_y, version, bytes });
  }
  return { chunk_size, chunks };
}
