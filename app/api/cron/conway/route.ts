// GET /api/cron/conway — M2.5 launch bot.
//
// Conway's Game of Life on one chunk per minute, with palette-aware rules.
// Visits chunks deterministically by minute-of-hour:
//   chunkIndex = (now.minute_of_hour) % (chunks_x * chunks_y)
//   cx, cy = (chunkIndex % chunks_x, floor(chunkIndex / chunks_x))
//
// Rules (palette-aware Conway):
//   - Alive = pixel has any non-zero palette index.
//   - Survive with 2 or 3 alive neighbors (color unchanged).
//   - Birth at a dead cell with exactly 3 alive neighbors → new color =
//     mode of those 3 neighbors' palette indices. On ties (3 different
//     colors), pick the LOWEST palette index (deterministic).
//   - Die otherwise (color → 0).
//
// Auto-seed: if the chunk has fewer than 10 alive cells, drop an
// R-pentomino at a random in-chunk position with a deterministic color
// derived from the chunk coordinates. Keeps chunks from going permanently
// still.
//
// Writes up to 50 diff cells per tick, spaced ≥1.1s apart. If the diff
// is larger, the route's 60s function timeout caps the work; the
// remainder waits for the chunk's next visit (60 minutes later).

import { randomUUID } from "node:crypto";

import { log } from "@/lib/log";
import {
  fetchChunkBytes,
  fetchSectorMeta,
  isAuthorizedCron,
  isLaunchBotsEnabled,
  sleep,
  writePixel,
  type SectorMeta,
} from "@/src/launch-bots/runner";

const PATH = "/api/cron/conway";
const SECTOR_ID = "sector-1";
const MAX_WRITES_PER_TICK = 50;
const MIN_ALIVE_FOR_NO_SEED = 10;

// R-pentomino, the famously chaotic 5-cell Conway pattern. Offsets
// relative to a top-left anchor.
const R_PENTOMINO: Array<[number, number]> = [
  [1, 0],
  [2, 0],
  [0, 1],
  [1, 1],
  [1, 2],
];

interface ChunkCoord {
  cx: number;
  cy: number;
}

function chunkOfMinute(meta: SectorMeta): ChunkCoord {
  const total = meta.chunks_x * meta.chunks_y;
  const minuteOfHour = new Date().getUTCMinutes();
  const idx = minuteOfHour % total;
  return {
    cx: idx % meta.chunks_x,
    cy: Math.floor(idx / meta.chunks_x),
  };
}

/**
 * One step of palette-aware Conway. Returns the next chunk bytes and
 * the set of (in-chunk x, y, oldColor, newColor) cells that changed.
 */
function conwayStep(
  current: Uint8Array,
  chunkSize: number,
): { next: Uint8Array; changes: Array<{ x: number; y: number; oldColor: number; newColor: number }> } {
  const next = new Uint8Array(current.length);
  const changes: Array<{ x: number; y: number; oldColor: number; newColor: number }> = [];
  for (let y = 0; y < chunkSize; y++) {
    for (let x = 0; x < chunkSize; x++) {
      const i = y * chunkSize + x;
      const oldColor = current[i];
      const aliveNeighbors: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          // Edge cells: neighbors outside the chunk count as dead (the
          // chunk is its own little universe — multi-chunk Conway is an
          // M3+ enhancement).
          if (nx < 0 || ny < 0 || nx >= chunkSize || ny >= chunkSize) continue;
          const nColor = current[ny * chunkSize + nx];
          if (nColor !== 0) aliveNeighbors.push(nColor);
        }
      }
      const aliveCount = aliveNeighbors.length;
      let newColor: number;
      if (oldColor !== 0) {
        // Currently alive.
        newColor = aliveCount === 2 || aliveCount === 3 ? oldColor : 0;
      } else {
        // Currently dead.
        if (aliveCount === 3) {
          // Birth: mode of 3 neighbors, tie-break by lowest palette index.
          const counts = new Map<number, number>();
          for (const c of aliveNeighbors) counts.set(c, (counts.get(c) ?? 0) + 1);
          let bestColor = aliveNeighbors[0];
          let bestCount = 0;
          for (const [c, n] of counts.entries()) {
            if (n > bestCount || (n === bestCount && c < bestColor)) {
              bestColor = c;
              bestCount = n;
            }
          }
          newColor = bestColor;
        } else {
          newColor = 0;
        }
      }
      next[i] = newColor;
      if (newColor !== oldColor) {
        changes.push({ x, y, oldColor, newColor });
      }
    }
  }
  return { next, changes };
}

function countAlive(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0) n++;
  return n;
}

/**
 * Deterministic per-chunk seed color so successive seeds at the same
 * chunk don't all use the same palette index. Skips palette 0 (the
 * default/dead color).
 */
function seedColorForChunk(cx: number, cy: number, paletteSize: number): number {
  if (paletteSize <= 1) return 1;
  const hash = ((cx * 31 + cy) * 17 + 1) >>> 0;
  return 1 + (hash % (paletteSize - 1));
}

/**
 * Drop an R-pentomino into `bytes` if there's room, returning the
 * changes (or empty if no seed happened). The anchor is chosen
 * deterministically from the chunk coordinates so the seed lands in a
 * predictable but varying spot.
 */
function maybeSeed(
  bytes: Uint8Array,
  chunkSize: number,
  cx: number,
  cy: number,
  paletteSize: number,
): Array<{ x: number; y: number; oldColor: number; newColor: number }> {
  if (countAlive(bytes) >= MIN_ALIVE_FOR_NO_SEED) return [];
  const color = seedColorForChunk(cx, cy, paletteSize);
  // Pick an anchor that keeps the 3x3 R-pentomino bounding box on-chunk.
  // Use a hashed but stable position.
  const anchorX = ((cx * 13 + cy * 7) % (chunkSize - 4)) + 2;
  const anchorY = ((cx * 17 + cy * 23) % (chunkSize - 4)) + 2;
  const changes: Array<{ x: number; y: number; oldColor: number; newColor: number }> = [];
  for (const [dx, dy] of R_PENTOMINO) {
    const x = anchorX + dx;
    const y = anchorY + dy;
    const i = y * chunkSize + x;
    const oldColor = bytes[i];
    if (oldColor !== color) {
      bytes[i] = color;
      changes.push({ x, y, oldColor, newColor: color });
    }
  }
  return changes;
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  if (!isAuthorizedCron(request)) {
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 404,
      error_slug: "not_found",
    });
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // Soft-launch gate. See visitor-pulse for the rationale.
  if (!isLaunchBotsEnabled()) {
    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      bot_name: "m25-conway",
      skipped: true,
      reason: "bots_disabled",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json({
      bot: "m25-conway",
      skipped: true,
      reason: "bots_disabled",
    });
  }

  const apiKey = process.env.M25_CONWAY_KEY;
  if (!apiKey) {
    log("error", {
      request_id: requestId,
      path: PATH,
      status: 500,
      error_slug: "missing_bot_key",
    });
    return Response.json({ error: "missing_bot_key" }, { status: 500 });
  }

  const signal = request.signal;

  try {
    const meta = await fetchSectorMeta(SECTOR_ID, signal);
    const { cx, cy } = chunkOfMinute(meta);
    const bytes = await fetchChunkBytes(SECTOR_ID, cx, cy, signal);
    const baseAlive = countAlive(bytes);

    // Conway step.
    const { changes: stepChanges } = conwayStep(bytes.slice(), meta.chunk_size);

    // Auto-seed when the chunk has too few alive cells. Operates on the
    // PRE-step state so we don't double-mutate the same byte.
    const seedChanges = maybeSeed(
      bytes,
      meta.chunk_size,
      cx,
      cy,
      meta.palette.length,
    );

    // Combine. Step changes win when both target the same in-chunk cell
    // (seed runs first, but step is the canonical evolution).
    const merged = new Map<number, { x: number; y: number; newColor: number }>();
    for (const c of seedChanges) {
      merged.set(c.y * meta.chunk_size + c.x, {
        x: c.x,
        y: c.y,
        newColor: c.newColor,
      });
    }
    for (const c of stepChanges) {
      merged.set(c.y * meta.chunk_size + c.x, {
        x: c.x,
        y: c.y,
        newColor: c.newColor,
      });
    }
    const allChanges = [...merged.values()];

    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      bot_name: "m25-conway",
      chunk: `${cx},${cy}`,
      base_alive: baseAlive,
      seed_changes: seedChanges.length,
      step_changes: stepChanges.length,
      total_changes: allChanges.length,
    });

    // Write up to MAX_WRITES_PER_TICK changes, spaced ≥1.1s.
    const writeBudget = Math.min(allChanges.length, MAX_WRITES_PER_TICK);
    let written = 0;
    let firstError: string | undefined;
    let firstErrorServerRequestId: string | undefined;
    for (let i = 0; i < writeBudget; i++) {
      const { x: inX, y: inY, newColor } = allChanges[i];
      const absX = cx * meta.chunk_size + inX;
      const absY = cy * meta.chunk_size + inY;
      const result = await writePixel(
        {
          apiKey,
          sectorId: SECTOR_ID,
          x: absX,
          y: absY,
          color: newColor,
          parentRequestId: requestId,
        },
        signal,
      );
      if (!result.ok) {
        firstError = firstError ?? result.error;
        firstErrorServerRequestId = firstErrorServerRequestId ?? result.serverRequestId;
        break;
      }
      written++;
      // Last write doesn't need a trailing sleep.
      if (i < writeBudget - 1) await sleep(1100, signal);
    }

    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      bot_name: "m25-conway",
      chunk: `${cx},${cy}`,
      pixels_written: written,
      total_changes: allChanges.length,
      truncated: allChanges.length > MAX_WRITES_PER_TICK,
      latency_ms: Date.now() - startedAt,
      ...(firstError ? { error_slug: firstError } : {}),
      ...(firstErrorServerRequestId
        ? { downstream_request_id: firstErrorServerRequestId }
        : {}),
    });

    return Response.json({
      bot: "m25-conway",
      chunk: { cx, cy },
      base_alive: baseAlive,
      step_changes: stepChanges.length,
      seed_changes: seedChanges.length,
      pixels_written: written,
      total_changes: allChanges.length,
      truncated: allChanges.length > MAX_WRITES_PER_TICK,
      ...(firstError ? { first_error: firstError } : {}),
    });
  } catch (err) {
    log("error", {
      request_id: requestId,
      path: PATH,
      status: 500,
      error_slug: "internal_error",
      error_class: err instanceof Error ? err.constructor.name : "unknown",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
