// Pure logic for the M2.5 visitor-pulse launch bot. Extracted from
// `app/api/cron/visitor-pulse/route.ts` so the log-scale meter math,
// repaint planning, and the partial-progress accounting can be tested
// without standing up Vercel cron + Upstash.

/** Visual: each meter unit is a 2x2 pixel square in the top-left. */
export const BLOCK_PX = 2;
export const PIXELS_PER_BLOCK = BLOCK_PX * BLOCK_PX; // 4

/**
 * Palette indices used by the meter. The lit color (yellow #e6c86e) is
 * reserved — Conway treats it as transparent so the meter strip can be
 * fully repainted every tick without colliding with Conway's grid.
 */
export const METER_LIT_COLOR = 6;
export const METER_DARK_COLOR = 0;

/**
 * Log scale chosen so the visible block count grows roughly linearly
 * with order-of-magnitude jumps in viewer count: 1→1, 10→10, 100→20,
 * 1000→30, etc. Capped at `maxBlocks` (= canvas width / BLOCK_PX) so
 * the meter never overflows the top two rows.
 *
 * Math: `round(10 * log10(active + 1))`. The `+1` keeps the curve
 * defined at active=0 and avoids spiky behavior near the origin.
 */
export function viewersToBlocks(active: number, maxBlocks: number): number {
  if (!Number.isFinite(active) || active <= 0) return 0;
  if (maxBlocks <= 0) return 0;
  const blocks = Math.round(10 * Math.log10(active + 1));
  return Math.min(blocks, maxBlocks);
}

/**
 * Given a previous and target block count, compute the two diff lists:
 * blocks to LIGHT (previous → target when target > previous) and
 * blocks to DARK (target → previous when target < previous). Returned
 * as half-open ranges by block index so callers can walk and paint.
 *
 * Idempotent if previous === target (both lists empty). Retained for
 * tests that exercise diff math directly; the cron route uses
 * `planRepaint` instead.
 */
export function blockDiff(
  previousBlocks: number,
  targetBlocks: number,
): { toLight: number[]; toDark: number[] } {
  const toLight: number[] = [];
  const toDark: number[] = [];
  for (let b = previousBlocks; b < targetBlocks; b++) toLight.push(b);
  for (let b = targetBlocks; b < previousBlocks; b++) toDark.push(b);
  return { toLight, toDark };
}

/**
 * After a tick that may have completed only some of its planned
 * writes, compute the new `last_blocks` count to persist. The pure
 * helper handles three failure modes:
 *
 *   1. No error → tick finished, persist `targetBlocks` exactly.
 *   2. Error during the LIGHT-up phase → persist the partial progress
 *      so the next tick picks up where this one left off:
 *      `previousBlocks + floor(written / PIXELS_PER_BLOCK)`.
 *   3. Error during the DARK-out phase → keep `previousBlocks`
 *      (don't claim progress on darkening; the next tick will redo
 *      from the recorded baseline).
 *
 * `wasLighting` distinguishes (2) from (3): true means the failed
 * write was in the lighting phase.
 *
 * Retained for tests; the full-repaint route uses `targetBlocks`
 * directly on clean ticks and falls back to this helper when a write
 * errors mid-tick.
 */
export function computeNewLastBlocks(input: {
  previousBlocks: number;
  targetBlocks: number;
  writtenPixels: number;
  errored: boolean;
  wasLighting: boolean;
}): number {
  if (!input.errored) return input.targetBlocks;
  if (input.wasLighting && input.writtenPixels > 0) {
    const fullBlocksLit = Math.floor(input.writtenPixels / PIXELS_PER_BLOCK);
    return input.previousBlocks + fullBlocksLit;
  }
  return input.previousBlocks;
}

/**
 * Coordinates of the 4 pixels for a given block index. Block N occupies
 * (2N, 0), (2N+1, 0), (2N, 1), (2N+1, 1).
 */
export function pixelsForBlock(blockIndex: number): Array<[number, number]> {
  const xBase = blockIndex * BLOCK_PX;
  return [
    [xBase, 0],
    [xBase + 1, 0],
    [xBase, 1],
    [xBase + 1, 1],
  ];
}

export interface MeterWrite {
  x: number;
  y: number;
  color: number;
  block: number;
  phase: "light" | "dark";
}

/**
 * Build the per-tick paint plan for the meter. Unlike a diff-only
 * approach, this fully repaints every lit block on every tick so the
 * meter self-heals against any cell that some other process may have
 * stomped on. Past-target blocks (shrinking meter) are darkened.
 *
 * Bounded by `maxWrites` so a high viewer count doesn't blow through
 * the 60s function timeout (each write costs ≥1.1s at POWER tier).
 * Lit blocks are prioritized over dark-outs.
 */
export function planRepaint(input: {
  previousBlocks: number;
  targetBlocks: number;
  maxBlocks: number;
  maxWrites: number;
}): MeterWrite[] {
  const plan: MeterWrite[] = [];
  const cappedTarget = Math.max(0, Math.min(input.targetBlocks, input.maxBlocks));
  const cappedPrevious = Math.max(
    0,
    Math.min(input.previousBlocks, input.maxBlocks),
  );

  // Light phase first: repaint every block that should be lit.
  for (let b = 0; b < cappedTarget; b++) {
    for (const [x, y] of pixelsForBlock(b)) {
      plan.push({ x, y, color: METER_LIT_COLOR, block: b, phase: "light" });
    }
  }
  // Dark phase: any block that USED to be lit beyond the current
  // target should be darkened back to 0.
  for (let b = cappedTarget; b < cappedPrevious; b++) {
    for (const [x, y] of pixelsForBlock(b)) {
      plan.push({ x, y, color: METER_DARK_COLOR, block: b, phase: "dark" });
    }
  }
  if (plan.length <= input.maxWrites) return plan;
  return plan.slice(0, input.maxWrites);
}
