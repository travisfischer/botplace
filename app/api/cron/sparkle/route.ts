// GET /api/cron/sparkle — M2.5 launch bot.
//
// Sparkle paints a "slow-mo explosion" radiating outward from the last
// few non-self pixel writes. Each tick:
//   1. Read recent events from /api/v1/public/sectors/sector-1/events
//      (filtering out sparkle's own writes by bot_name).
//   2. Pick up to SPARKLE_ANCHOR_COUNT distinct non-self anchors.
//   3. For each anchor, pick SPARKLE_DIRS_PER_ANCHOR deterministic
//      directions and shoot SPARKLE_RING_COUNT rings outward.
//   4. For each ring: light the ring's pixels with SPARKLE_COLOR (7),
//      then revert each to its previous color. The explosion is purely
//      transient — the canvas state after the tick equals the state
//      before, minus any rate-limit-induced partial revert.
//
// Writes are spaced ≥1.1s to honor the POWER tier's 1/sec/bot bucket.

import { randomUUID } from "node:crypto";

import { log } from "@/lib/log";
import {
  fetchChunkBytes,
  fetchEvents,
  fetchSectorMeta,
  isAuthorizedCron,
  isLaunchBotsEnabled,
  sleep,
  writePixel,
} from "@/src/launch-bots/runner";
import {
  SPARKLE_ANCHOR_COUNT,
  SPARKLE_COLOR,
  SPARKLE_DIRS_PER_ANCHOR,
  SPARKLE_RING_COUNT,
  chunksForAnchors,
  pickRecentNonSelfAnchors,
  planExplosion,
} from "@/src/launch-bots/sparkle-logic";
import { RESERVED_TOP_ROWS } from "@/src/launch-bots/conway-logic";

const PATH = "/api/cron/sparkle";
const SECTOR_ID = "sector-1";
const SELF_BOT_NAME = "m25-sparkle";

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
      bot_name: SELF_BOT_NAME,
      skipped: true,
      reason: "bots_disabled",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json({
      bot: SELF_BOT_NAME,
      skipped: true,
      reason: "bots_disabled",
    });
  }

  const apiKey = process.env.M25_SPARKLE_KEY;
  if (!apiKey) {
    // Byte-identical to the wrong-CRON_SECRET response — see
    // visitor-pulse for rationale.
    log("error", {
      request_id: requestId,
      path: PATH,
      status: 404,
      error_slug: "missing_bot_key",
    });
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const signal = request.signal;

  try {
    // Pull recent events + sector dimensions in parallel.
    const [events, meta] = await Promise.all([
      fetchEvents(SECTOR_ID, 30, signal),
      fetchSectorMeta(SECTOR_ID, signal),
    ]);

    const anchors = pickRecentNonSelfAnchors(
      events,
      SELF_BOT_NAME,
      SPARKLE_ANCHOR_COUNT,
    );
    if (anchors.length === 0) {
      log("info", {
        request_id: requestId,
        path: PATH,
        status: 200,
        bot_name: SELF_BOT_NAME,
        sparkle_skipped: true,
        reason: "no_non_self_event",
        latency_ms: Date.now() - startedAt,
      });
      return Response.json({
        bot: SELF_BOT_NAME,
        skipped: true,
        reason: "no_non_self_event",
      });
    }

    // Fetch every chunk an explosion ring could touch (cheap — usually
    // 1–4 chunks). Cached in a Map keyed by `cx,cy` so the ColorAt
    // closure can resolve any (x, y) without a network call.
    const chunkCoords = chunksForAnchors(
      anchors,
      meta.chunk_size,
      meta.chunks_x,
      meta.chunks_y,
      SPARKLE_RING_COUNT,
    );
    const chunkBytes = new Map<string, Uint8Array>();
    await Promise.all(
      chunkCoords.map(async ({ cx, cy }) => {
        const bytes = await fetchChunkBytes(SECTOR_ID, cx, cy, signal);
        chunkBytes.set(`${cx},${cy}`, bytes);
      }),
    );

    const colorAt = (x: number, y: number): number => {
      const cx = Math.floor(x / meta.chunk_size);
      const cy = Math.floor(y / meta.chunk_size);
      const bytes = chunkBytes.get(`${cx},${cy}`);
      if (!bytes) return 0;
      const inX = x - cx * meta.chunk_size;
      const inY = y - cy * meta.chunk_size;
      return bytes[inY * meta.chunk_size + inX];
    };

    const plan = planExplosion({
      anchors,
      canvasWidth: meta.width,
      canvasHeight: meta.height,
      reservedTopRows: RESERVED_TOP_ROWS,
      colorAt,
      rings: SPARKLE_RING_COUNT,
      dirsPerAnchor: SPARKLE_DIRS_PER_ANCHOR,
    });

    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      bot_name: SELF_BOT_NAME,
      anchors: anchors.map((a) => ({ x: a.x, y: a.y, author: a.bot_name })),
      planned_writes: plan.length,
      rings: SPARKLE_RING_COUNT,
    });

    let written = 0;
    let firstError: string | undefined;
    let firstErrorServerRequestId: string | undefined;
    for (const w of plan) {
      const result = await writePixel(
        {
          apiKey,
          sectorId: SECTOR_ID,
          x: w.x,
          y: w.y,
          color: w.color,
          parentRequestId: requestId,
        },
        signal,
      );
      if (!result.ok) {
        firstError = firstError ?? result.error;
        firstErrorServerRequestId =
          firstErrorServerRequestId ?? result.serverRequestId;
        break;
      }
      written++;
      // Last write doesn't need a trailing sleep.
      if (written < plan.length) await sleep(1100, signal);
    }

    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      bot_name: SELF_BOT_NAME,
      pixels_written: written,
      planned_writes: plan.length,
      latency_ms: Date.now() - startedAt,
      ...(firstError ? { error_slug: firstError } : {}),
      ...(firstErrorServerRequestId
        ? { downstream_request_id: firstErrorServerRequestId }
        : {}),
    });

    return Response.json({
      bot: SELF_BOT_NAME,
      anchors: anchors.map((a) => ({ x: a.x, y: a.y })),
      pixels_written: written,
      planned_writes: plan.length,
      sparkle_color: SPARKLE_COLOR,
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
