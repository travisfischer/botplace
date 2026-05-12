// Pure logic for the M2.5 Conway launch bot. Lifted out of
// `app/api/cron/conway/route.ts` so the boundary cases (3-way tie
// breaks, edge-cell neighborhoods, seed-anchor bounds) can be tested
// without standing up the route, Vercel cron, or Upstash.
//
// Rules (palette-aware Conway):
//   - Alive = pixel has any non-zero palette index.
//   - Survive with 2 or 3 alive neighbors (color unchanged).
//   - Birth at a dead cell with exactly 3 alive neighbors → new color =
//     mode of those 3 neighbors' palette indices. On ties, pick the
//     LOWEST palette index (deterministic).
//   - Die otherwise (color → 0).
//
// Auto-seed: if the chunk has fewer than `minAliveForNoSeed` alive
// cells, drop an R-pentomino at a deterministic in-chunk position with
// a color derived from the chunk coordinates.

export const MIN_ALIVE_FOR_NO_SEED = 10;

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

export function countAlive(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0) n++;
  return n;
}

/**
 * One step of palette-aware Conway on a single chunk. Returns the next
 * chunk bytes (newly allocated) and the set of changed cells.
 *
 * Pure: same input → same output. No side effects. Tests rely on this.
 */
export function conwayStep(
  current: Uint8Array,
  chunkSize: number,
): { next: Uint8Array; changes: CellChange[] } {
  const next = new Uint8Array(current.length);
  const changes: CellChange[] = [];
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
        // Currently alive: survive iff 2 or 3 alive neighbors.
        newColor = aliveCount === 2 || aliveCount === 3 ? oldColor : 0;
      } else {
        // Currently dead: birth iff exactly 3 alive neighbors.
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
 * index. Deterministic — same neighbors → same color.
 *
 * Exported only for tests; the rest of the bot calls into `conwayStep`.
 */
export function birthColor(aliveNeighbors: number[]): number {
  if (aliveNeighbors.length === 0) {
    // Should never happen on the birth branch (caller checks
    // aliveCount === 3), but be defensive: palette 1 is the lowest
    // non-default color.
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
 * Deterministic per-chunk seed color so successive seeds at the same
 * chunk don't all use the same palette index. Skips palette 0 (the
 * default/dead color).
 */
export function seedColorForChunk(
  cx: number,
  cy: number,
  paletteSize: number,
): number {
  if (paletteSize <= 1) return 1;
  const hash = ((cx * 31 + cy) * 17 + 1) >>> 0;
  return 1 + (hash % (paletteSize - 1));
}

/**
 * Drop an R-pentomino into `bytes` if there are fewer than
 * `MIN_ALIVE_FOR_NO_SEED` alive cells. Mutates `bytes` in place and
 * returns the changes (or empty if no seed happened).
 *
 * The anchor is chosen deterministically from the chunk coordinates so
 * the seed lands in a predictable spot the operator can pre-compute.
 */
export function maybeSeed(
  bytes: Uint8Array,
  chunkSize: number,
  cx: number,
  cy: number,
  paletteSize: number,
): CellChange[] {
  if (countAlive(bytes) >= MIN_ALIVE_FOR_NO_SEED) return [];
  const color = seedColorForChunk(cx, cy, paletteSize);
  // Pick an anchor that keeps the 3x3 R-pentomino bounding box on-chunk.
  // Use a hashed but stable position; +2 offset keeps the pentomino
  // strictly interior (leaving at least 2 cells of margin on every side
  // before clipping kicks in).
  const anchorX = ((cx * 13 + cy * 7) % (chunkSize - 4)) + 2;
  const anchorY = ((cx * 17 + cy * 23) % (chunkSize - 4)) + 2;
  const changes: CellChange[] = [];
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

/**
 * Pick the chunk to visit on this tick from a given minute-of-hour
 * (0..59). The minute is injected so tests don't depend on wall-clock
 * time. Conway rotates deterministically: chunk index = minute mod
 * (chunks_x * chunks_y), with cx/cy projected out by row-major order.
 */
export function chunkForMinute(
  minuteOfHour: number,
  chunksX: number,
  chunksY: number,
): ChunkCoord {
  const total = chunksX * chunksY;
  // Defensive normalization for negative / non-integer inputs.
  const m =
    Number.isFinite(minuteOfHour) && minuteOfHour >= 0
      ? Math.floor(minuteOfHour)
      : 0;
  const idx = m % total;
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
