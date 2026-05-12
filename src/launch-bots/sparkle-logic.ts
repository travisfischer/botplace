// Pure logic for the M2.5 sparkle launch bot. Extracted from
// `app/api/cron/sparkle/route.ts` so the anchor-selection rule and
// bounds clipping can be tested without standing up the public
// /events endpoint, Vercel cron, or `writePixel`.

/** Off-white palette index used for sparkle pixels. */
export const SPARKLE_COLOR = 7;

/** The 8 cardinal+diagonal offsets around an anchor (excludes (0, 0)). */
export const SPARKLE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
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
 * if every event in the feed is a self-write. The feed is descending
 * by id (M2.5 contract), so the first non-self entry is the freshest
 * candidate to halo.
 *
 * Pure: no side effects, no clock dependencies.
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
 * Given an anchor pixel and canvas dimensions, return the set of
 * sparkle-pixel coordinates clipped to the canvas. Off-canvas offsets
 * (anchor near the edge) are dropped.
 */
export function sparkleTargets(
  anchorX: number,
  anchorY: number,
  canvasWidth: number,
  canvasHeight: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const [dx, dy] of SPARKLE_OFFSETS) {
    const x = anchorX + dx;
    const y = anchorY + dy;
    if (x < 0 || y < 0) continue;
    if (x >= canvasWidth || y >= canvasHeight) continue;
    out.push([x, y]);
  }
  return out;
}
