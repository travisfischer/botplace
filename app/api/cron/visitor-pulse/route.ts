// GET /api/cron/visitor-pulse — M2.5 launch bot.
//
// Reserves the top two rows (y=0, y=1) as a 2x2-block "viewer meter."
// On each tick:
//   1. Read active viewer count from /api/v1/public/sectors/sector-1/viewers.
//   2. Compute the new block count on a log scale (1 viewer → 1 block,
//      10 → 10, 100 → 20, 1000 → 30, etc.). Capped at chunks_x*chunk_size/2
//      total blocks across the canvas.
//   3. Diff-paint against the previous block count (stored in Upstash):
//      only write the blocks that just lit up (count increased) or just
//      went dark (count decreased). Steady ±1 fluctuation = ~4 writes.
//   4. Persist the new count in Upstash for next tick.
//
// Triggered by Vercel cron `* * * * *` (every minute). Auth via the
// CRON_SECRET; bot key M25_VISITOR_PULSE_KEY (POWER tier, set up by
// scripts/m2.5/seed-launch-bots.mjs).

import { randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import { log } from "@/lib/log";
import {
  fetchSectorMeta,
  fetchViewers,
  isAuthorizedCron,
  isLaunchBotsEnabled,
  sleep,
  writePixel,
} from "@/src/launch-bots/runner";
import {
  BLOCK_PX,
  blockDiff,
  computeNewLastBlocks,
  pixelsForBlock,
  viewersToBlocks,
} from "@/src/launch-bots/visitor-pulse-logic";

const PATH = "/api/cron/visitor-pulse";
const SECTOR_ID = "sector-1";
const LIT_COLOR = 6; // yellow #e6c86e
const DEFAULT_COLOR = 0; // black, used to dark out previously-lit blocks
const REDIS_KEY = `botplace:m25:visitor-pulse:last_blocks:${SECTOR_ID}`;

let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (redis) return redis;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
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

  // Soft-launch gate. Vercel auto-fires the cron the moment the deploy
  // is live, before keys are provisioned. Return 200 `skipped` so the
  // interim state is greppable without faking failures.
  if (!isLaunchBotsEnabled()) {
    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      bot_name: "m25-visitor-pulse",
      skipped: true,
      reason: "bots_disabled",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json({
      bot: "m25-visitor-pulse",
      skipped: true,
      reason: "bots_disabled",
    });
  }

  const apiKey = process.env.M25_VISITOR_PULSE_KEY;
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
    const [meta, viewers] = await Promise.all([
      fetchSectorMeta(SECTOR_ID, signal),
      fetchViewers(SECTOR_ID, signal),
    ]);

    const maxBlocks = Math.floor(meta.width / BLOCK_PX);
    const targetBlocks = viewersToBlocks(viewers.active, maxBlocks);

    const r = getRedis();
    let previousBlocks = 0;
    if (r) {
      const stored = (await r.get(REDIS_KEY)) as number | null;
      if (typeof stored === "number") previousBlocks = stored;
    }

    // Diff: blocks newly lit (previous → target, lit up the new range)
    // and blocks newly dark (target → previous, darken the previously-
    // lit range past target).
    const { toLight, toDark } = blockDiff(previousBlocks, targetBlocks);

    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      bot_name: "m25-visitor-pulse",
      viewer_count: viewers.active,
      target_blocks: targetBlocks,
      previous_blocks: previousBlocks,
      to_light: toLight.length,
      to_dark: toDark.length,
    });

    // Write the diff. Each block = 4 pixel writes; spaced ≥1100ms apart
    // to comfortably stay under the POWER tier's 1/sec/bot ceiling.
    let written = 0;
    let firstError: string | undefined;
    let firstErrorServerRequestId: string | undefined;
    const blocksToPaint: Array<{ block: number; color: number }> = [
      ...toLight.map((b) => ({ block: b, color: LIT_COLOR })),
      ...toDark.map((b) => ({ block: b, color: DEFAULT_COLOR })),
    ];

    // Track whether the current block being painted is in the LIGHT-up
    // phase (LIT_COLOR) or the DARK-out phase (DEFAULT_COLOR). The
    // partial-progress accounting below uses this to decide whether
    // it's safe to advance `last_blocks` past `previousBlocks`.
    let wasLighting = false;
    for (const { block, color } of blocksToPaint) {
      wasLighting = color === LIT_COLOR;
      for (const [x, y] of pixelsForBlock(block)) {
        const result = await writePixel(
          { apiKey, sectorId: SECTOR_ID, x, y, color, parentRequestId: requestId },
          signal,
        );
        if (!result.ok) {
          firstError = firstError ?? result.error;
          firstErrorServerRequestId = firstErrorServerRequestId ?? result.serverRequestId;
          // Stop if we hit rate limit / other error to avoid burning
          // the rest of the budget. Next tick will pick up where we
          // left off (the previousBlocks count in Redis is unchanged
          // until we persist it at the end of this tick).
          break;
        }
        written++;
        await sleep(1100, signal);
      }
      if (firstError) break;
    }

    // Persist the new last_blocks count. Pure helper handles the four
    // outcomes (clean finish, light-phase partial, dark-phase partial,
    // dark-phase clean prefix).
    const newLastBlocks = computeNewLastBlocks({
      previousBlocks,
      targetBlocks,
      writtenPixels: written,
      errored: firstError !== undefined,
      wasLighting,
    });
    if (r && newLastBlocks !== previousBlocks) {
      await r.set(REDIS_KEY, newLastBlocks);
    }

    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      bot_name: "m25-visitor-pulse",
      pixels_written: written,
      latency_ms: Date.now() - startedAt,
      ...(firstError ? { error_slug: firstError } : {}),
      ...(firstErrorServerRequestId
        ? { downstream_request_id: firstErrorServerRequestId }
        : {}),
    });

    return Response.json({
      bot: "m25-visitor-pulse",
      viewer_count: viewers.active,
      target_blocks: targetBlocks,
      previous_blocks: previousBlocks,
      pixels_written: written,
      new_last_blocks: newLastBlocks,
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
