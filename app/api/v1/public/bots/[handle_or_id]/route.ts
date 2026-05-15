// GET /api/v1/public/bots/:handle_or_id — public bot-detail endpoint.
//
// Single route accepts either a handle or a cuid id. Dispatch is by
// shape:
//   - input matches /^c[a-z0-9]{24}$/  → query by id
//   - else                              → validate against the handle
//                                         regex and query by handle
//
// Returns the public bot-detail shape: `handle`, `display_name`,
// `description`, `description_updated_at`, `rate_tier`, `created_at`,
// `last_seen_at`. No `id`, no `owner_id`, no `api_keys` — handle is
// the canonical public identifier.
//
// Public; no auth. CDN-cached briefly so the canvas's bot-detail UI
// can pull this on every pixel click without origin pressure.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";
import { botPublicDetailToJson, getBotPublicDetail } from "@/src/bots";
import { isValidHandle } from "@/src/bots/handle";

const CACHE_CONTROL = "public, s-maxage=10, stale-while-revalidate=60";
const CDN_CACHE_CONTROL = "public, s-maxage=10, stale-while-revalidate=60";

const CUID_REGEX = /^c[a-z0-9]{24}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle_or_id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { handle_or_id } = await params;
  const path = `/api/v1/public/bots/${handle_or_id}`;

  const rl = await checkPublicReadRateLimit(clientIpFrom(request));
  if (!rl.ok) {
    return publicReadRateLimitResponse(rl, {
      requestId,
      path,
      startedAt,
    });
  }
  const rlHeaders = publicReadRateLimitHeaders(rl.publicRead);

  // Dispatch by shape. Cuids are 25 chars starting with `c`; handles
  // are 3–32 chars in `/^[a-z][a-z0-9-]{2,31}$/`. The shapes overlap
  // narrowly (a 25-char no-hyphen handle starting with `c` could match
  // both), but `id` lookup wins for cuid-shaped inputs — both columns
  // are unique, so a real cuid never collides with a real handle.
  let byId: string | undefined;
  let byHandle: string | undefined;
  if (CUID_REGEX.test(handle_or_id)) {
    byId = handle_or_id;
  } else if (isValidHandle(handle_or_id)) {
    byHandle = handle_or_id;
  } else {
    log("warn", {
      request_id: requestId,
      path,
      status: 400,
      error_slug: "invalid_input",
      auth_type: "public",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      {
        error: "invalid_input",
        field: "handle_or_id",
        reason: "handle_or_id_invalid",
        message:
          "Path segment must be a bot handle or a cuid id (`c` + 24 lowercase alphanumerics)",
        request_id: requestId,
      },
      {
        status: 400,
        headers: { "X-Request-Id": requestId, ...rlHeaders },
      },
    );
  }

  try {
    const detail = await getBotPublicDetail({ handle: byHandle, id: byId });
    if (!detail) {
      log("info", {
        request_id: requestId,
        path,
        status: 404,
        error_slug: "bot_not_found",
        auth_type: "public",
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        { error: "bot_not_found", request_id: requestId },
        {
          status: 404,
          headers: { "X-Request-Id": requestId, ...rlHeaders },
        },
      );
    }

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      latency_ms: Date.now() - startedAt,
    });

    return Response.json(
      { ...botPublicDetailToJson(detail), request_id: requestId },
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
      dependency: "neon",
      error_class: err instanceof Error ? err.constructor.name : "unknown",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "internal_error", request_id: requestId },
      {
        status: 500,
        headers: { "X-Request-Id": requestId, ...rlHeaders },
      },
    );
  }
}
