// Edge middleware — runs at Vercel's edge BEFORE the CDN cache, on every
// matching request, regardless of whether the response comes from cache.
// That's the right place to track active viewers: counting the function
// invocations would undercount by ~99% because the CDN absorbs steady-
// state polling.
//
// Strategy: every manifest request adds the client IP to a per-minute
// Redis SET with a 2-minute TTL. The /viewers endpoint reports the
// union of the current + previous minute sets — approximate "active
// viewers in the last ~2 minutes."
//
// Edge runtime: this code runs in V8 isolates (NOT Node.js). Use
// `@upstash/redis` which has an Edge build. NO Prisma here.

import { NextResponse, type NextRequest } from "next/server";
import { Redis } from "@upstash/redis";

export const config = {
  // Match all viewer-facing public read endpoints. The viewer count
  // covers anyone touching the public surface — manifest is the hot
  // path but a third-party scraper hitting chunks directly should
  // count as a viewer too. Excludes the /viewers endpoint itself
  // (would otherwise inflate the count via polling for its own value).
  matcher: ["/api/v1/public/sectors/:path*"],
};

// Lazy Redis client. Constructed on first invocation per isolate.
// `Redis.fromEnv()` auto-detects either canonical or KV_* env names.
let redis: Redis | null = null;
let warnedMissing = false;
let warnedFailure = false;
function getRedis(): Redis | null {
  if (redis) return redis;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    if (!warnedMissing) {
      warnedMissing = true;
      // Edge isolates log to Vercel's function logs.
      console.warn(
        "[viewer-tracker] Upstash env missing; viewer count will be 0.",
      );
    }
    return null;
  }
  redis = new Redis({ url, token });
  return redis;
}

function ipFrom(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

// Skip /viewers itself — its own poll traffic would otherwise inflate
// the count we're reporting. Sector id is captured but unused here;
// /viewers is per-sector via path matching.
function shouldTrack(pathname: string): boolean {
  if (!pathname.startsWith("/api/v1/public/sectors/")) return false;
  if (pathname.endsWith("/viewers")) return false;
  return true;
}

// Hard upper bound on how long we wait for Upstash before giving up.
// `lib/rate-limit.ts` uses 2_000ms for the same reason on the Node
// runtime; the edge runtime has a tighter overall invocation budget so
// the manifest request can't afford to hang on telemetry. 500ms is
// generous for a two-op pipeline against Upstash's edge region.
const UPSTASH_TIMEOUT_MS = 500;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`upstash_timeout_${ms}ms`));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl;
  if (!shouldTrack(url.pathname)) return NextResponse.next();

  const r = getRedis();
  if (r) {
    try {
      const ip = ipFrom(request);
      // Bucket by minute. Two adjacent buckets give a sliding ~2-minute
      // window when we union them at read time.
      const minute = Math.floor(Date.now() / 60_000);
      const key = `botplace:viewers:${minute}`;
      // Add this IP to the set; refresh the 2-minute TTL on every hit so
      // a busy minute's set always lives long enough to be read by the
      // /viewers endpoint in the next minute.
      // We use a pipeline to do both in one round trip.
      await withTimeout(
        r.pipeline().sadd(key, ip).expire(key, 120).exec(),
        UPSTASH_TIMEOUT_MS,
      );
    } catch (err) {
      // Telemetry is best-effort: don't fail the request because the
      // counter couldn't write. But do leave a greppable signal — a
      // sustained Upstash outage drives /viewers to 0, which drives
      // visitor-pulse to darken its entire meter (a user-visible
      // regression). Rate-limit to one warn per isolate so we don't
      // spam logs during a real outage.
      if (!warnedFailure) {
        warnedFailure = true;
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[viewer-tracker] upstash write failed (dependency=upstash): ${message}`,
        );
      }
    }
  }

  return NextResponse.next();
}
