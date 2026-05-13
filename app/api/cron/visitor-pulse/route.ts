// GET /api/cron/visitor-pulse — M2.5 launch bot.
//
// Reserves the top two rows (y=0, y=1) as a 2x2-block "viewer meter."
// On each tick:
//   1. Read active viewer count from /api/v1/public/sectors/sector-1/viewers.
//   2. Compute the target block count on a log scale (1 viewer → 1 block,
//      10 → 10, 100 → 20, 1000 → 30, etc.). Capped at chunks_x*chunk_size/2
//      total blocks across the canvas.
//   3. Fully repaint every lit block (color 6 yellow) and dark every
//      block that USED to be lit but no longer should be (color 0).
//      Full-repaint is intentional: the meter self-heals against any
//      cell that may have been stomped on (e.g. a sparkle revert that
//      partially restored the wrong byte).
//   4. Persist the new block count in Upstash for the next tick to
//      know which blocks to dark.
//
// The meter strip (y=0..1) is reserved — Conway leaves it alone, and
// sparkle skips anchors that fall into it.
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
  PIXELS_PER_BLOCK,
  computeNewLastBlocks,
  planRepaint,
  viewersToBlocks,
} from "@/src/launch-bots/visitor-pulse-logic";

const PATH = "/api/cron/visitor-pulse";
const SECTOR_ID = "sector-1";
// `:v1:` namespace lets us evolve the value shape (e.g. add per-block
// color state) by bumping to `:v2:` without colliding with old data.
// TTL on the set: 7 days — refreshes every tick while the bot is
// active, expires automatically if the bot is disabled/removed so the
// key doesn't sit in Upstash forever.
const REDIS_KEY = `botplace:m25:v1:visitor-pulse:last_blocks:${SECTOR_ID}`;
const REDIS_KEY_TTL_SECONDS = 60 * 60 * 24 * 7;
// Cap writes per tick so a sudden viewer spike doesn't run past the
// 60s function timeout (each write spaces ≥1.1s for the POWER tier).
// At 45 writes × 1.1s = 49.5s, leaves a healthy buffer.
const MAX_WRITES_PER_TICK = 45;

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
    // Byte-identical to the wrong-CRON_SECRET response so a brute-force
    // guesser can't observe a status diff once they land on the right
    // secret. Internal log keeps the discriminating slug.
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

    const plan = planRepaint({
      previousBlocks,
      targetBlocks,
      maxBlocks,
      maxWrites: MAX_WRITES_PER_TICK,
    });

    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      bot_name: "m25-visitor-pulse",
      viewer_count: viewers.active,
      target_blocks: targetBlocks,
      previous_blocks: previousBlocks,
      planned_writes: plan.length,
    });

    let written = 0;
    let firstError: string | undefined;
    let firstErrorServerRequestId: string | undefined;
    // Track whether the in-flight pixel was a "light" or "dark" write
    // so partial-progress accounting can pick a sensible new
    // last_blocks (see computeNewLastBlocks for the cases).
    let wasLighting = plan.length > 0 ? plan[0].phase === "light" : true;
    for (const w of plan) {
      wasLighting = w.phase === "light";
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
      if (written < plan.length) await sleep(1100, signal);
    }

    // Decide what to persist. Clean tick → `targetBlocks` (the meter
    // now reflects the live count). Mid-tick failure → fall back to
    // partial-progress accounting against the diff baseline.
    const newLastBlocks = firstError
      ? computeNewLastBlocks({
          previousBlocks,
          targetBlocks,
          writtenPixels: Math.max(
            0,
            written - Math.max(0, targetBlocks * PIXELS_PER_BLOCK),
          ),
          errored: true,
          wasLighting,
        })
      : targetBlocks;
    if (r && newLastBlocks !== previousBlocks) {
      await r.set(REDIS_KEY, newLastBlocks, { ex: REDIS_KEY_TTL_SECONDS });
    }

    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      bot_name: "m25-visitor-pulse",
      pixels_written: written,
      planned_writes: plan.length,
      truncated: plan.length === MAX_WRITES_PER_TICK,
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
      planned_writes: plan.length,
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
