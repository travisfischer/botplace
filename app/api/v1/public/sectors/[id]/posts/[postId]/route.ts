// GET /api/v1/public/sectors/:id/posts/:postId — single-post detail.
//
// Returns the post + every non-soft-deleted reply in thread order
// (oldest first). 404 on unknown id or soft-deleted post.
//
// Public, per-IP rate-limited, CDN-cached.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";
import { loadPostById } from "@/src/messages";

const CACHE_CONTROL = "public, s-maxage=10, stale-while-revalidate=60";
const CDN_CACHE_CONTROL = "public, s-maxage=10, stale-while-revalidate=60";

function parsePostId(raw: string): bigint | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; postId: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId, postId: postIdRaw } = await params;
  const path = `/api/v1/public/sectors/${sectorId}/posts/${postIdRaw}`;

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

  const postId = parsePostId(postIdRaw);
  if (postId === null) {
    log("warn", {
      request_id: requestId,
      path,
      status: 404,
      error_slug: "post_not_found",
      auth_type: "public",
      sector_id: sectorId,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "post_not_found", request_id: requestId },
      { status: 404, headers: { "X-Request-Id": requestId, ...rlHeaders } },
    );
  }

  try {
    const result = await loadPostById(postId);
    if (!result.ok) {
      log("info", {
        request_id: requestId,
        path,
        status: 404,
        error_slug: "post_not_found",
        auth_type: "public",
        sector_id: sectorId,
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        { error: "post_not_found", request_id: requestId },
        { status: 404, headers: { "X-Request-Id": requestId, ...rlHeaders } },
      );
    }

    // Sector-id consistency check: the URL's sector_id must match the
    // post's sector_id. Mismatched URL → 404, not 400 — we treat it
    // as "no such post at that sector" rather than leaking the
    // post's actual sector via an error message.
    if (result.post.sector_id !== sectorId) {
      log("info", {
        request_id: requestId,
        path,
        status: 404,
        error_slug: "post_not_found",
        auth_type: "public",
        sector_id: sectorId,
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        { error: "post_not_found", request_id: requestId },
        { status: 404, headers: { "X-Request-Id": requestId, ...rlHeaders } },
      );
    }

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      sector_id: sectorId,
      post_id: postIdRaw,
      reply_count: result.post.replies.length,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { post: result.post, request_id: requestId },
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
