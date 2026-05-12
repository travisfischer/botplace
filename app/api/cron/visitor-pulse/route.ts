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
  sleep,
  writePixel,
} from "@/src/launch-bots/runner";

const PATH = "/api/cron/visitor-pulse";
const SECTOR_ID = "sector-1";
const LIT_COLOR = 6; // yellow #e6c86e
const DEFAULT_COLOR = 0; // black, used to dark out previously-lit blocks
const REDIS_KEY = `botplace:m25:visitor-pulse:last_blocks:${SECTOR_ID}`;
// Block layout: each meter unit is a 2x2 pixel square in the top-left
// of the canvas. Block N occupies pixels (2N, 0), (2N+1, 0), (2N, 1),
// (2N+1, 1).
const BLOCK_PX = 2;

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

/** Log-scale: 1→1, 10→10, 100→20, 1000→30 blocks. Capped at maxBlocks. */
function viewersToBlocks(active: number, maxBlocks: number): number {
  if (active <= 0) return 0;
  const blocks = Math.round(10 * Math.log10(active + 1));
  return Math.min(blocks, maxBlocks);
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
    const toLight: number[] = [];
    const toDark: number[] = [];
    for (let b = previousBlocks; b < targetBlocks; b++) toLight.push(b);
    for (let b = targetBlocks; b < previousBlocks; b++) toDark.push(b);

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
    const blocksToPaint: Array<{ block: number; color: number }> = [
      ...toLight.map((b) => ({ block: b, color: LIT_COLOR })),
      ...toDark.map((b) => ({ block: b, color: DEFAULT_COLOR })),
    ];

    for (const { block, color } of blocksToPaint) {
      const xBase = block * BLOCK_PX;
      // 2x2 block: 4 pixels.
      const pixels: Array<[number, number]> = [
        [xBase, 0],
        [xBase + 1, 0],
        [xBase, 1],
        [xBase + 1, 1],
      ];
      for (const [x, y] of pixels) {
        const result = await writePixel({ apiKey, sectorId: SECTOR_ID, x, y, color }, signal);
        if (!result.ok) {
          firstError = firstError ?? result.error;
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

    // Persist the new last_blocks count. Use the highest block index we
    // successfully painted so a partial diff doesn't lose progress.
    let newLastBlocks = previousBlocks;
    if (!firstError) {
      newLastBlocks = targetBlocks;
    } else if (toLight.length > 0 && written > 0) {
      // We were lighting up new blocks and got partway; persist progress.
      const fullBlocksLit = Math.floor(written / 4);
      newLastBlocks = previousBlocks + fullBlocksLit;
    }
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
