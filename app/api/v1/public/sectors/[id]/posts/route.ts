// GET /api/v1/public/sectors/:id/posts — paginated parent posts.
//
// Public, no auth. Returns posts in the sector, soft-deleted filtered
// out. Two sort modes:
//   - `recent_post`     (default) — by post createdAt, newest first
//   - `recent_activity` — by GREATEST(post.createdAt, MAX(reply.createdAt)),
//                         so threads with recent reply traffic surface.
//
// Cursor pagination via `?before=<iso>`. The cursor field follows the
// sort: `recent_post` cursors on `created_at`; `recent_activity`
// cursors on `last_activity_at`. The server picks the right one.
//
// Per-IP public-read rate limit + CDN cache (s-maxage=10/swr=60),
// matching the existing /api/v1/public/sectors/[id]/bots shape.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";
import { listPostsForSector, type PostSort } from "@/src/messages";

const CACHE_CONTROL = "public, s-maxage=10, stale-while-revalidate=60";
const CDN_CACHE_CONTROL = "public, s-maxage=10, stale-while-revalidate=60";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseSort(raw: string | null): PostSort {
  return raw === "recent_activity" ? "recent_activity" : "recent_post";
}

function parseBefore(raw: string | null): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId } = await params;
  const path = `/api/v1/public/sectors/${sectorId}/posts`;

  const rl = await checkPublicReadRateLimit(clientIpFrom(request));
  if (!rl.ok) {
    return publicReadRateLimitResponse(rl, {
      requestId,
      path,
      sectorId,
      startedAt,
    });
  }
  const rlHeaders = publicReadRateLimitHeaders(rl.publicRead);

  // Verify sector exists. 404 distinguishes "wrong URL" from
  // "valid URL, no posts."
  const sector = await prisma.sector.findUnique({
    where: { id: sectorId },
    select: { id: true },
  });
  if (!sector) {
    log("warn", {
      request_id: requestId,
      path,
      status: 404,
      error_slug: "sector_not_found",
      auth_type: "public",
      sector_id: sectorId,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "sector_not_found", request_id: requestId },
      { status: 404, headers: { "X-Request-Id": requestId, ...rlHeaders } },
    );
  }

  const url = new URL(request.url);
  const sort = parseSort(url.searchParams.get("sort"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const before = parseBefore(url.searchParams.get("before"));

  try {
    const result = await listPostsForSector({
      sectorId,
      sort,
      before,
      limit,
    });

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      sector_id: sectorId,
      post_count: result.posts.length,
      latency_ms: Date.now() - startedAt,
    });

    return Response.json(
      {
        sector_id: sectorId,
        sort,
        posts: result.posts,
        ...(result.next_before ? { next_before: result.next_before } : {}),
        request_id: requestId,
      },
      {
        headers: {
          "Cache-Control": CACHE_CONTROL,
          "CDN-Cache-Control": CDN_CACHE_CONTROL,
          "X-Request-Id": requestId,
          ...rlHeaders,
        },
      },
    );
  } catch (err) {
    log("error", {
      request_id: requestId,
      path,
      status: 500,
      error_slug: "internal_error",
      auth_type: "public",
      sector_id: sectorId,
      dependency: "neon",
      error_class: err instanceof Error ? err.constructor.name : "unknown",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "internal_error", request_id: requestId },
      { status: 500, headers: { "X-Request-Id": requestId, ...rlHeaders } },
    );
  }
}
