// Per-tab chunk cache with manifest-diff logic. Pure (no fetch, no DOM) so
// the diff path is unit-testable in isolation.
//
// IM-1: manifest omits unwritten chunks. Anything not in the manifest is
// either "never seen" (paint default_color) or "was written but the row
// disappeared" (impossible without an admin action; we leave the local
// bytes in place — see `diff` doc).

export interface ManifestEntry {
  chunk_x: number;
  chunk_y: number;
  /** BigInt-as-string. Compare with `compareVersion`, never `>`. */
  version: string;
  updated_at: string;
}

export interface CachedChunk {
  /** Stringified bigint matching ETag without quotes. */
  version: string;
  /** 10000-byte packed palette indices. */
  bytes: Uint8Array;
}

function key(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/**
 * Compare two BigInt-as-string values. Returns -1, 0, or 1. Strings are
 * required because the version is `bigint` server-side; JS `Number` would
 * lose precision past 2^53.
 *
 * Versions are non-negative integers without leading zeros (Prisma's
 * stringify of a positive bigint), so length-then-lex is correct.
 */
export function compareVersion(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : 1;
}

export class ChunkCache {
  private readonly chunks = new Map<string, CachedChunk>();

  has(cx: number, cy: number): boolean {
    return this.chunks.has(key(cx, cy));
  }

  get(cx: number, cy: number): CachedChunk | undefined {
    return this.chunks.get(key(cx, cy));
  }

  /**
   * Stringified version we last cached, for `If-None-Match` headers. Used
   * even when we know a newer version is available — the 304 path will
   * trigger if anyone (including a CDN edge) has a fresher version that
   * matches the same ETag, but the typical case is a direct 200 with new
   * bytes.
   */
  version(cx: number, cy: number): string | undefined {
    return this.chunks.get(key(cx, cy))?.version;
  }

  set(cx: number, cy: number, version: string, bytes: Uint8Array): void {
    this.chunks.set(key(cx, cy), { version, bytes });
  }

  /**
   * Iterate chunks in (chunk_y, chunk_x) order — same order the manifest
   * uses, useful for deterministic repaint loops.
   */
  *entries(): Generator<[number, number, CachedChunk]> {
    const sorted = [...this.chunks.entries()].sort(([a], [b]) => {
      const [ax, ay] = a.split(",").map(Number);
      const [bx, by] = b.split(",").map(Number);
      return ay - by || ax - bx;
    });
    for (const [k, v] of sorted) {
      const [cx, cy] = k.split(",").map(Number);
      yield [cx, cy, v];
    }
  }

  /**
   * Compare a remote manifest against the local cache. Returns chunks that
   * the client should re-fetch — those where the manifest's version is
   * strictly greater than the cached version, plus any manifest entries we
   * don't have at all.
   *
   * Chunks present locally but absent from the manifest are NOT included.
   * In M2 the manifest omits unwritten chunks (IM-1), so a missing entry
   * means "never written" — the local bytes (if any) remain valid because
   * pixel writes are append-only. Future operator deletions would need a
   * different signal.
   */
  diff(manifest: readonly ManifestEntry[]): ManifestEntry[] {
    const stale: ManifestEntry[] = [];
    for (const entry of manifest) {
      const local = this.chunks.get(key(entry.chunk_x, entry.chunk_y));
      if (!local || compareVersion(entry.version, local.version) > 0) {
        stale.push(entry);
      }
    }
    return stale;
  }
}
