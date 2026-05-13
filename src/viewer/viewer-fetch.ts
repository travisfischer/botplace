// Network glue between the chunk cache and the public read endpoints.
// Pure-ish: the fetch impl is injected so tests can substitute a fake.
//
// `fetchManifest` and `fetchChunkIfChanged` together implement one tick of
// the viewer's polling loop. The cache is the single source of truth for
// "what version do we have for this chunk"; the ETag is derived from it
// when we have one.

import { ChunkCache, type ManifestEntry } from "./chunk-cache";
import { decodeSnapshot, type DecodedSnapshot } from "./snapshot";

export type FetchImpl = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface FetcherOpts {
  baseUrl?: string;
  fetchImpl?: FetchImpl;
}

function urlFor(base: string | undefined, path: string): string {
  if (!base) return path;
  return base.replace(/\/$/, "") + path;
}

/**
 * Typed error for 429 / 503 responses. The poll loop catches this and
 * uses `retryAfterSeconds` as the floor on the next schedule, honoring
 * the V3-spec'd "respect Retry-After, double the poll interval until
 * success" contract.
 */
export class RateLimitedError extends Error {
  readonly retryAfterSeconds: number;
  readonly status: number;
  constructor(status: number, retryAfterSeconds: number, message: string) {
    super(message);
    this.name = "RateLimitedError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function parseRetryAfter(res: Response): number {
  const raw = res.headers.get("retry-after");
  if (!raw) return 0;
  // RFC 7231: Retry-After is either delta-seconds (integer) or HTTP-date.
  // The server only emits delta-seconds; parse defensively anyway.
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
  }
  return 0;
}

function rateLimitedFromResponse(res: Response, label: string): RateLimitedError {
  return new RateLimitedError(
    res.status,
    parseRetryAfter(res),
    `${label} ${res.status}`,
  );
}

/**
 * Fetch the full-canvas snapshot in one round trip. Used by the viewer
 * on initial mount so the canvas paints immediately instead of walking
 * the manifest + per-chunk fetches. The polling loop takes over for
 * incremental updates after the snapshot lands.
 */
export async function fetchSnapshot(
  sectorId: string,
  signal: AbortSignal,
  opts: FetcherOpts = {},
): Promise<DecodedSnapshot> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const res = await fetchImpl(
    urlFor(opts.baseUrl, `/api/v1/public/sectors/${sectorId}/snapshot`),
    {
      signal,
      // Omit cookies: the public read endpoints don't use auth, and
      // sending the Auth.js session cookie causes Vercel's CDN to skip
      // cache for personalized responses — every viewer poll hits origin
      // and burns the per-IP rate-limit bucket.
      credentials: "omit",
      headers: { Accept: "application/octet-stream" },
    },
  );
  if (res.status === 429 || res.status === 503) {
    throw rateLimitedFromResponse(res, "snapshot");
  }
  if (!res.ok) {
    throw new Error(`snapshot ${res.status}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return decodeSnapshot(buf);
}

export async function fetchManifest(
  sectorId: string,
  signal: AbortSignal,
  opts: FetcherOpts = {},
): Promise<ManifestEntry[]> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const res = await fetchImpl(
    urlFor(opts.baseUrl, `/api/v1/public/sectors/${sectorId}/manifest`),
    {
      signal,
      credentials: "omit",
      headers: { Accept: "application/json" },
    },
  );
  if (res.status === 429 || res.status === 503) {
    throw rateLimitedFromResponse(res, "manifest");
  }
  if (!res.ok) {
    throw new Error(`manifest ${res.status}`);
  }
  return (await res.json()) as ManifestEntry[];
}

export interface ChunkFetchResult {
  chunkX: number;
  chunkY: number;
  /** "200" with new bytes, "304" cache hit, or "skipped" no-op. */
  outcome: "updated" | "not_modified" | "skipped";
  version?: string;
}

/**
 * Fetch a single chunk if the manifest entry's version is newer than
 * what the cache has. Sends `If-None-Match` when we already have a
 * version cached, so a CDN/origin 304 round-trips cleanly.
 */
export async function fetchChunkIfChanged(
  sectorId: string,
  entry: ManifestEntry,
  cache: ChunkCache,
  signal: AbortSignal,
  opts: FetcherOpts = {},
): Promise<ChunkFetchResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const cached = cache.version(entry.chunk_x, entry.chunk_y);
  const headers: Record<string, string> = {};
  if (cached !== undefined) {
    headers["If-None-Match"] = `"${cached}"`;
  }

  const res = await fetchImpl(
    urlFor(
      opts.baseUrl,
      `/api/v1/public/sectors/${sectorId}/chunks/${entry.chunk_x}/${entry.chunk_y}`,
    ),
    { signal, credentials: "omit", headers },
  );
  if (res.status === 304) {
    return {
      chunkX: entry.chunk_x,
      chunkY: entry.chunk_y,
      outcome: "not_modified",
      version: cached,
    };
  }
  if (res.status === 429 || res.status === 503) {
    throw rateLimitedFromResponse(
      res,
      `chunk (${entry.chunk_x},${entry.chunk_y})`,
    );
  }
  if (!res.ok) {
    throw new Error(`chunk ${res.status} (${entry.chunk_x},${entry.chunk_y})`);
  }
  const version =
    res.headers.get("X-Chunk-Version") ?? entry.version ?? "0";
  const buf = new Uint8Array(await res.arrayBuffer());
  cache.set(entry.chunk_x, entry.chunk_y, version, buf);
  return {
    chunkX: entry.chunk_x,
    chunkY: entry.chunk_y,
    outcome: "updated",
    version,
  };
}
