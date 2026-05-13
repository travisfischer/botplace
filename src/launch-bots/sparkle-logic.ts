// Pure logic for the M2.5 sparkle launch bot.
//
// Sparkle paints a "slow-mo explosion" radiating outward from the last
// few non-self pixel writes. Each anchor shoots a couple of light-color
// pixels along two deterministic directions, ring-by-ring outward.
// Every lit pixel is then reverted to its previous color so the
// explosion is purely transient and never persists on the canvas.
//
// The bot stays off Conway's palette (1..5) and the visitor-pulse
// meter color (6). All light writes use SPARKLE_COLOR (palette index
// 7), and reverts restore the exact byte that was there before — so
// sparkle plays nicely with the meter strip and with Conway's
// palette-isolated grid.

/** Off-white palette index used for sparkle pixels. */
export const SPARKLE_COLOR = 7;

/** Number of most-recent non-self anchors sparkle uses per tick. */
export const SPARKLE_ANCHOR_COUNT = 3;

/** Number of directions each anchor shoots in. */
export const SPARKLE_DIRS_PER_ANCHOR = 2;

/** Number of rings outward each anchor explodes through per tick. */
export const SPARKLE_RING_COUNT = 3;

/**
 * The 8 cardinal+diagonal offsets a ring can move along. Each anchor
 * picks SPARKLE_DIRS_PER_ANCHOR of these deterministically from a
 * hash of its (x, y) so its explosion shape is stable per tick.
 */
export const SPARKLE_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],          [1, 0],
  [-1, 1],  [0, 1], [1, 1],
];

/** Subset of `/api/v1/public/sectors/:id/events` items sparkle reads. */
export interface SparkleEvent {
  x: number;
  y: number;
  bot_name: string;
  accepted_at: string;
}

/**
 * Pick the most recent event NOT authored by sparkle itself, or null
 * if every event in the feed is a self-write.
 *
 * Kept for backward compatibility with M2.5 tests and as the "did
 * anyone else write recently?" shortcut. The explosion path uses
 * `pickRecentNonSelfAnchors` instead.
 */
export function pickNonSelfAnchor(
  events: ReadonlyArray<SparkleEvent>,
  selfBotName: string,
): SparkleEvent | null {
  for (const e of events) {
    if (e.bot_name !== selfBotName) return e;
  }
  return null;
}

/**
 * Pick the N most recent non-self events from the feed, dropping
 * duplicates at the same (x, y) — the previous anchor of an
 * about-to-explode pixel covers what the current anchor would have
 * lit. The feed is descending by id (M2.5 contract), so the first N
 * non-self entries are the freshest.
 */
export function pickRecentNonSelfAnchors(
  events: ReadonlyArray<SparkleEvent>,
  selfBotName: string,
  n: number,
): SparkleEvent[] {
  const out: SparkleEvent[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (e.bot_name === selfBotName) continue;
    const key = `${e.x},${e.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Deterministic direction picker for an anchor. Returns
 * `count` distinct offsets drawn from SPARKLE_DIRECTIONS, biased by a
 * hash of the anchor's (x, y) so visually adjacent anchors don't all
 * pick the same directions.
 */
export function pickDirectionsForAnchor(
  anchorX: number,
  anchorY: number,
  count: number,
): Array<readonly [number, number]> {
  const hash = ((anchorX * 73856093) ^ (anchorY * 19349663)) >>> 0;
  const start = hash % SPARKLE_DIRECTIONS.length;
  const stride = 1 + (hash % (SPARKLE_DIRECTIONS.length - 1));
  const picked: Array<readonly [number, number]> = [];
  const seen = new Set<number>();
  let idx = start;
  while (picked.length < count && seen.size < SPARKLE_DIRECTIONS.length) {
    if (!seen.has(idx)) {
      seen.add(idx);
      picked.push(SPARKLE_DIRECTIONS[idx]);
    }
    idx = (idx + stride) % SPARKLE_DIRECTIONS.length;
  }
  return picked;
}

/**
 * Given an anchor pixel and canvas dimensions, return the set of
 * sparkle-pixel coordinates clipped to the canvas. Off-canvas offsets
 * (anchor near the edge) are dropped.
 *
 * Kept for backward compatibility with M2.5 tests.
 */
export function sparkleTargets(
  anchorX: number,
  anchorY: number,
  canvasWidth: number,
  canvasHeight: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [dx, dy] of SPARKLE_DIRECTIONS) {
    const x = anchorX + dx;
    const y = anchorY + dy;
    if (x < 0 || y < 0) continue;
    if (x >= canvasWidth || y >= canvasHeight) continue;
    out.push([x, y]);
  }
  return out;
}

export interface ExplosionWrite {
  x: number;
  y: number;
  color: number;
  /**
   * Ordering hint within a tick. Lower numbers paint first. The
   * explosion plan interleaves so a viewer sees the wave expand
   * outward: ring r's reverts run right before ring (r+1)'s lights.
   */
  order: number;
  /** Whether this write is the "light up" or the "revert" half. */
  kind: "light" | "revert";
  /** Ring index (0 = innermost), useful for log fields. */
  ring: number;
}

/**
 * Function returning the pixel currently painted at (x, y) on the
 * canvas. The route fetches each anchor's chunk bytes once at
 * tick-start and wraps that in a closure passed here. Out-of-bounds
 * queries return 0.
 */
export type ColorAt = (x: number, y: number) => number;

/**
 * Build the full explosion plan for a tick: for each anchor, walk N
 * rings outward, lighting then reverting `dirsPerAnchor` pixels per
 * ring. The plan is a flat list of `ExplosionWrite` records in the
 * order they should be applied, so the route can just iterate.
 *
 * Visual structure (rings indexed 0..R-1):
 *   - ring 0 lights (all anchors × dirs) → ring 0 reverts
 *   - ring 1 lights → ring 1 reverts
 *   - ...
 *   - ring R-1 lights → ring R-1 reverts
 *
 * Each ring's reverts MUST run after its lights but BEFORE the next
 * ring's lights, otherwise the explosion looks like a static halo.
 *
 * Pixels that would fall off the canvas, into another bot's reserved
 * top-rows zone, or onto an already-light sparkle cell are dropped.
 */
export function planExplosion(input: {
  anchors: ReadonlyArray<{ x: number; y: number }>;
  canvasWidth: number;
  canvasHeight: number;
  /** y < reservedTopRows is never written to (visitor-pulse meter). */
  reservedTopRows: number;
  /** Pixel-color lookup; see `ColorAt`. */
  colorAt: ColorAt;
  rings?: number;
  dirsPerAnchor?: number;
}): ExplosionWrite[] {
  const rings = input.rings ?? SPARKLE_RING_COUNT;
  const dirsPerAnchor = input.dirsPerAnchor ?? SPARKLE_DIRS_PER_ANCHOR;
  const plan: ExplosionWrite[] = [];
  // Per-pixel order counter — every write gets a strictly increasing
  // order so a simple sort produces the correct execution sequence.
  let order = 0;

  // Cache directions per anchor.
  const dirsByAnchor = input.anchors.map((a) =>
    pickDirectionsForAnchor(a.x, a.y, dirsPerAnchor),
  );

  for (let r = 0; r < rings; r++) {
    // Light phase for ring r.
    const lit: Array<{ x: number; y: number; prev: number }> = [];
    for (let i = 0; i < input.anchors.length; i++) {
      const anchor = input.anchors[i];
      for (const [dx, dy] of dirsByAnchor[i]) {
        const x = anchor.x + dx * (r + 1);
        const y = anchor.y + dy * (r + 1);
        if (x < 0 || y < 0) continue;
        if (x >= input.canvasWidth || y >= input.canvasHeight) continue;
        if (y < input.reservedTopRows) continue;
        const prev = input.colorAt(x, y);
        // Don't double-light a cell that's already sparkle-colored
        // (a stale sparkle from a previous tick or a duplicate
        // direction). The revert would otherwise paint color 7 on
        // top of color 7, wasting a rate-limit slot.
        if (prev === SPARKLE_COLOR) continue;
        plan.push({ x, y, color: SPARKLE_COLOR, order: order++, kind: "light", ring: r });
        lit.push({ x, y, prev });
      }
    }
    // Revert phase for ring r — restore the exact prev color so the
    // explosion leaves no trace.
    for (const { x, y, prev } of lit) {
      plan.push({ x, y, color: prev, order: order++, kind: "revert", ring: r });
    }
  }
  return plan;
}

/**
 * Given a list of anchors, return the distinct chunks the explosion
 * touches so the route knows which chunks' bytes to fetch upfront.
 * Drops chunk coords that fall outside the grid.
 */
export function chunksForAnchors(
  anchors: ReadonlyArray<{ x: number; y: number }>,
  chunkSize: number,
  chunksX: number,
  chunksY: number,
  rings: number = SPARKLE_RING_COUNT,
): Array<{ cx: number; cy: number }> {
  const seen = new Set<string>();
  const out: Array<{ cx: number; cy: number }> = [];
  for (const a of anchors) {
    // Ring r writes can land up to `rings` cells in any direction.
    for (let dy = -rings; dy <= rings; dy++) {
      for (let dx = -rings; dx <= rings; dx++) {
        const x = a.x + dx;
        const y = a.y + dy;
        if (x < 0 || y < 0) continue;
        const cx = Math.floor(x / chunkSize);
        const cy = Math.floor(y / chunkSize);
        if (cx < 0 || cy < 0 || cx >= chunksX || cy >= chunksY) continue;
        const key = `${cx},${cy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ cx, cy });
      }
    }
  }
  return out;
}
