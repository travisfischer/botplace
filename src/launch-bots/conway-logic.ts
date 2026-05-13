// Pure logic for the M2.5 Conway launch bot. Lifted out of
// `app/api/cron/conway/route.ts` so the boundary cases (3-way tie
// breaks, edge-cell neighborhoods, seed-anchor bounds, palette
// isolation) can be tested without standing up the route, Vercel cron,
// or Upstash.
//
// Conway operates on a reserved slice of the palette so it doesn't
// interact with the other launch bots:
//   - 0 (dead)        — always background
//   - 1..5            — Conway's palette (plum, gray, red, blue, green)
//   - 6 (yellow)      — reserved for visitor-pulse meter; Conway leaves
//                       these cells untouched and ignores them when
//                       counting alive neighbors.
//   - 7 (off-white)   — reserved for sparkle bursts; same treatment.
//
// In addition Conway leaves the top two rows of the canvas (absolute
// y < 2) alone so visitor-pulse owns the meter strip uncontested.
//
// Rules (palette-aware Conway, restricted to CONWAY_COLORS):
//   - Alive = pixel has a palette index in CONWAY_COLORS.
//   - Survive with 2 or 3 alive neighbors (color unchanged).
//   - Birth at a dead cell (color 0) with exactly 3 alive neighbors →
//     new color = mode of those 3 neighbors' palette indices. On ties
//     (3 different colors), pick the LOWEST palette index.
//   - Die otherwise (color → 0).
//
// Auto-seed: if the chunk has fewer than `MIN_ALIVE_FOR_NO_SEED` alive
// (CONWAY_COLORS-counted) cells, drop an R-pentomino at a deterministic
// in-chunk position with a Conway-palette color derived from the chunk
// coordinates.

export const MIN_ALIVE_FOR_NO_SEED = 10;

/**
 * The palette slice Conway is allowed to read and write. Other indices
 * (0 = dead, 6 = visitor-pulse meter, 7 = sparkle bursts) are reserved
 * for other bots and Conway treats them as transparent — neither
 * counted as alive nor overwritten.
 */
export const CONWAY_COLORS: ReadonlyArray<number> = [1, 2, 3, 4, 5];

/**
 * Top rows of the canvas reserved for the visitor-pulse meter. Conway
 * skips any cell whose ABSOLUTE y is less than this so the meter strip
 * is never overwritten regardless of what's painted there.
 */
export const RESERVED_TOP_ROWS = 2;

/** R-pentomino offsets relative to a top-left anchor. */
export const R_PENTOMINO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [2, 0],
  [0, 1],
  [1, 1],
  [1, 2],
];

export interface CellChange {
  x: number;
  y: number;
  oldColor: number;
  newColor: number;
}

export interface ChunkCoord {
  cx: number;
  cy: number;
}

/** True iff `c` is one of Conway's palette indices. */
export function isConwayColor(c: number): boolean {
  return c >= 1 && c <= 5;
}

/**
 * Count cells in `bytes` whose palette index is in CONWAY_COLORS.
 * Cells in colors 6/7 (other bots) are skipped — they don't count as
 * alive for Conway's purposes.
 */
export function countAlive(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (isConwayColor(bytes[i])) n++;
  }
  return n;
}

/**
 * One step of palette-aware Conway on a single chunk. Returns the next
 * chunk bytes (newly allocated) and the set of changed cells.
 *
 * `cy` is the chunk's y-index; combined with `chunkSize` it lets the
 * step skip cells whose ABSOLUTE y is in the reserved top-rows zone
 * owned by visitor-pulse.
 *
 * Cells holding a reserved color (6 or 7) are left exactly as they are
 * — Conway never overwrites a sparkle or meter pixel. They also don't
 * count as alive neighbors.
 *
 * Pure: same input → same output. No side effects.
 */
export function conwayStep(
  current: Uint8Array,
  chunkSize: number,
  cy: number = 0,
): { next: Uint8Array; changes: CellChange[] } {
  const next = new Uint8Array(current.length);
  // Default to the input — reserved cells (top-rows, color 6/7) flow
  // through unchanged.
  next.set(current);
  const changes: CellChange[] = [];
  for (let y = 0; y < chunkSize; y++) {
    const absY = cy * chunkSize + y;
    if (absY < RESERVED_TOP_ROWS) continue;
    for (let x = 0; x < chunkSize; x++) {
      const i = y * chunkSize + x;
      const oldColor = current[i];
      // Reserved colors are left alone — `next.set(current)` already
      // preserved them.
      if (oldColor === 6 || oldColor === 7) continue;
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
          if (isConwayColor(nColor)) aliveNeighbors.push(nColor);
        }
      }
      const aliveCount = aliveNeighbors.length;
      let newColor: number;
      if (isConwayColor(oldColor)) {
        // Currently alive: survive iff 2 or 3 alive neighbors.
        newColor = aliveCount === 2 || aliveCount === 3 ? oldColor : 0;
      } else {
        // Currently dead (color 0): birth iff exactly 3 alive
        // neighbors. (oldColor 6/7 was already filtered out above.)
        if (aliveCount === 3) {
          newColor = birthColor(aliveNeighbors);
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

/**
 * Birth color rule: the mode of `aliveNeighbors`. On ties (two or more
 * colors appear the same number of times), pick the LOWEST palette
 * index. Deterministic — same neighbors → same color. Callers only pass
 * Conway-palette neighbors (1..5), but the function tolerates other
 * values defensively.
 *
 * Exported only for tests; the rest of the bot calls into `conwayStep`.
 */
export function birthColor(aliveNeighbors: number[]): number {
  if (aliveNeighbors.length === 0) {
    // Should never happen on the birth branch (caller checks
    // aliveCount === 3), but be defensive: palette 1 is the lowest
    // Conway color.
    return 1;
  }
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
  return bestColor;
}

/**
 * Deterministic per-chunk seed color, picked from CONWAY_COLORS so the
 * seed never collides with the visitor-pulse meter (6) or a sparkle
 * burst (7).
 */
export function seedColorForChunk(cx: number, cy: number): number {
  const hash = ((cx * 31 + cy) * 17 + 1) >>> 0;
  return CONWAY_COLORS[hash % CONWAY_COLORS.length];
}

/**
 * Drop an R-pentomino into `bytes` if there are fewer than
 * `MIN_ALIVE_FOR_NO_SEED` (Conway-counted) alive cells. Mutates `bytes`
 * in place and returns the changes (or empty if no seed happened).
 *
 * The anchor is chosen deterministically from the chunk coordinates and
 * pushed below the reserved-top-rows zone when needed so the seed never
 * lands in the visitor-pulse meter strip.
 */
export function maybeSeed(
  bytes: Uint8Array,
  chunkSize: number,
  cx: number,
  cy: number,
): CellChange[] {
  if (countAlive(bytes) >= MIN_ALIVE_FOR_NO_SEED) return [];
  const color = seedColorForChunk(cx, cy);
  // Pick an anchor that keeps the 3x3 R-pentomino bounding box on-chunk
  // AND below the meter strip. `+2` offset keeps the pentomino strictly
  // interior. For cy=0 we additionally push the anchor below row
  // `RESERVED_TOP_ROWS` to keep it out of the meter.
  const interior = Math.max(0, chunkSize - 4);
  const minY = cy === 0 ? RESERVED_TOP_ROWS : 0;
  const anchorX = (((cx * 13 + cy * 7) % interior) + interior) % interior + 2;
  const baseY = (((cx * 17 + cy * 23) % interior) + interior) % interior + 2;
  const anchorY = Math.max(baseY, minY);
  const changes: CellChange[] = [];
  for (const [dx, dy] of R_PENTOMINO) {
    const x = anchorX + dx;
    const y = anchorY + dy;
    if (x < 0 || y < 0 || x >= chunkSize || y >= chunkSize) continue;
    const i = y * chunkSize + x;
    const oldColor = bytes[i];
    // Don't overwrite a reserved-color cell with a seed.
    if (oldColor === 6 || oldColor === 7) continue;
    if (oldColor !== color) {
      bytes[i] = color;
      changes.push({ x, y, oldColor, newColor: color });
    }
  }
  return changes;
}

/**
 * Pick the chunk to visit on this tick. Uses wall-clock minutes since
 * epoch instead of minute-of-hour so every chunk index is reached —
 * `Math.floor(nowMs / 60_000) % (chunksX * chunksY)` cycles through
 * the full grid even when there are more chunks than minutes in an
 * hour (the previous behavior bottomed out at chunk 59 of 100,
 * leaving the bottom 40% of a 10×10 grid permanently unvisited).
 *
 * `nowMs` is injected so tests don't depend on wall-clock time.
 */
export function chunkForTick(
  nowMs: number,
  chunksX: number,
  chunksY: number,
): ChunkCoord {
  const total = chunksX * chunksY;
  const ms =
    Number.isFinite(nowMs) && nowMs >= 0 ? Math.floor(nowMs) : 0;
  const minute = Math.floor(ms / 60_000);
  const idx = minute % total;
  return {
    cx: idx % chunksX,
    cy: Math.floor(idx / chunksX),
  };
}

/**
 * Merge step-changes over seed-changes for a single tick: seed runs
 * first, but step changes win on conflicts because step is the
 * canonical evolution. Returned in insertion order (seed first, then
 * step) with each cell appearing at most once.
 */
export function mergeChanges(
  seedChanges: CellChange[],
  stepChanges: CellChange[],
  chunkSize: number,
): Array<{ x: number; y: number; newColor: number }> {
  const merged = new Map<number, { x: number; y: number; newColor: number }>();
  for (const c of seedChanges) {
    merged.set(c.y * chunkSize + c.x, {
      x: c.x,
      y: c.y,
      newColor: c.newColor,
    });
  }
  for (const c of stepChanges) {
    merged.set(c.y * chunkSize + c.x, {
      x: c.x,
      y: c.y,
      newColor: c.newColor,
    });
  }
  return [...merged.values()];
}
