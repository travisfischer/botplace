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
      await r.pipeline().sadd(key, ip).expire(key, 120).exec();
    } catch {
      // Telemetry is best-effort. Don't fail the request because the
      // counter couldn't write.
    }
  }

  return NextResponse.next();
}
