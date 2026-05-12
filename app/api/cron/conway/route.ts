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
  chunkForMinute,
  conwayStep,
  countAlive,
  maybeSeed,
  mergeChanges,
} from "@/src/launch-bots/conway-logic";
import {
  fetchChunkBytes,
  fetchSectorMeta,
  isAuthorizedCron,
  isLaunchBotsEnabled,
  sleep,
  writePixel,
} from "@/src/launch-bots/runner";

const PATH = "/api/cron/conway";
const SECTOR_ID = "sector-1";
const MAX_WRITES_PER_TICK = 50;

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
    const { cx, cy } = chunkForMinute(
      new Date().getUTCMinutes(),
      meta.chunks_x,
      meta.chunks_y,
    );
    const bytes = await fetchChunkBytes(SECTOR_ID, cx, cy, signal);
    const baseAlive = countAlive(bytes);

    // Conway step (operates on a copy so we still have the original
    // bytes available for `maybeSeed`).
    const { changes: stepChanges } = conwayStep(bytes.slice(), meta.chunk_size);

    // Auto-seed when the chunk has too few alive cells. Operates on the
    // ORIGINAL state.
    const seedChanges = maybeSeed(
      bytes,
      meta.chunk_size,
      cx,
      cy,
      meta.palette.length,
    );

    // Combine. Step changes win when both target the same in-chunk cell
    // (seed runs first, but step is the canonical evolution).
    const allChanges = mergeChanges(seedChanges, stepChanges, meta.chunk_size);

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
