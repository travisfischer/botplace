// Shared domain logic for "build a BPSS snapshot of one sector filtered
// to the pixels a given bot is the CURRENT author of." Backs
// GET /api/v1/public/sectors/:id/bots/:handle/snapshot. The output
// shape (`SnapshotChunk[]` + max version) is the same one the
// unfiltered snapshot route hands to `encodeSnapshot`, so the public
// viewer's `decodeSnapshot` consumes both without branching.

import { prisma } from "@/lib/prisma";
import { CHUNK_BYTES, CHUNK_SIZE } from "@/src/pixels";
import type { SnapshotChunk } from "@/src/viewer/snapshot";

export interface FilteredSnapshotResult {
  chunks: SnapshotChunk[];
  /** Number of pixels in the snapshot — surfaced as a header for the page UI. */
  pixelCount: number;
  /**
   * Largest pixel_event.id observed across the whole sector at query time.
   * Used as part of the ETag so the filtered view busts cache when ANY
   * write to the sector lands (any write can change which bot is the
   * current author somewhere on the canvas).
   */
  maxEventId: bigint;
}

/**
 * Build a filtered snapshot for `(sectorId, botId)` showing only pixels
 * where `botId` is the most-recent writer.
 *
 * **Query strategy.** Reads all events for the sector ordered by `id DESC`,
 * keeps the first occurrence per `(x, y)` (= latest write), filters to the
 * target bot, packs each surviving pixel into its chunk byte. Chunks with
 * zero authored pixels are omitted from the output entirely (the BPSS
 * decoder treats absent chunks as default-color, same convention as the
 * unfiltered snapshot).
 *
 * **Scaling note.** O(events in sector). Fine for sector-1 today (small
 * volume); at ~1M events the in-app dedupe would dominate. A composite
 * index `(sector_id, x, y, id DESC)` + a raw `DISTINCT ON (x, y)` query
 * would short-scan instead. Not needed for MVP — left as a known lever.
 *
 * @param defaultColor Palette index that "blank" pixels should render as.
 *                     Unused in the chunk bytes themselves (absent chunks
 *                     handle the blank case); kept on the interface so
 *                     callers don't have to redundantly look it up if we
 *                     ever switch to a sparse byte-array encoding.
 */
export async function buildBotFilteredSnapshot(input: {
  sectorId: string;
  botId: string;
  chunksX: number;
  chunksY: number;
  defaultColor: number;
}): Promise<FilteredSnapshotResult> {
  void input.defaultColor; // documented above; not consumed today.

  const events = await prisma.pixelEvent.findMany({
    where: { sectorId: input.sectorId },
    orderBy: { id: "desc" },
    select: { id: true, x: true, y: true, color: true, botId: true },
  });

  let maxEventId = 0n;

  // Keep the FIRST occurrence per (x, y) — events are id-DESC so that's
  // the latest write at the coord. Then filter to the target bot.
  const seen = new Set<number>();
  const authored: Array<{ x: number; y: number; color: number }> = [];
  for (const e of events) {
    if (e.id > maxEventId) maxEventId = e.id;
    const key = e.y * 65_536 + e.x; // packed key; sector dims << 65k
    if (seen.has(key)) continue;
    seen.add(key);
    if (e.botId !== input.botId) continue;
    authored.push({ x: e.x, y: e.y, color: e.color });
  }

  // Pack into chunks. Allocate lazily so we only build chunks that have
  // at least one authored pixel.
  const chunkMap = new Map<string, Uint8Array>();
  for (const p of authored) {
    const cx = Math.floor(p.x / CHUNK_SIZE);
    const cy = Math.floor(p.y / CHUNK_SIZE);
    const key = `${cx},${cy}`;
    let bytes = chunkMap.get(key);
    if (!bytes) {
      bytes = new Uint8Array(CHUNK_BYTES); // zero-filled = default_color slot
      chunkMap.set(key, bytes);
    }
    const inX = p.x - cx * CHUNK_SIZE;
    const inY = p.y - cy * CHUNK_SIZE;
    bytes[inY * CHUNK_SIZE + inX] = p.color;
  }

  const chunks: SnapshotChunk[] = [];
  // Iterate in row-major chunk order so the encoded byte stream is
  // deterministic for a given input set — predictable ETags + readable
  // snapshot dumps in the logs.
  for (let cy = 0; cy < input.chunksY; cy++) {
    for (let cx = 0; cx < input.chunksX; cx++) {
      const bytes = chunkMap.get(`${cx},${cy}`);
      if (!bytes) continue;
      chunks.push({
        chunk_x: cx,
        chunk_y: cy,
        // The filtered view doesn't track per-chunk versions; version 0
        // is fine because we never consume it (the viewer's chunk cache
        // is bypassed in static mode — see SectorViewer's
        // `staticSnapshotUrl` branch).
        version: "0",
        bytes,
      });
    }
  }

  return { chunks, pixelCount: authored.length, maxEventId };
}
