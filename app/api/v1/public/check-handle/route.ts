// GET /api/v1/public/check-handle?handle=foo — answer "could the
// owner-create path accept this handle right now?". Public, no auth.
// Lives outside `/public/bots/` so it can't shadow `[handle]` lookups.
// Drives the live availability hint in the create-bot form, and is also
// useful as an agent-native pre-flight before POST /api/v1/bots.
//
// Returns 200 in all cases the request is well-formed; the body
// distinguishes available vs. unavailable via `available: boolean`.
// Unavailable responses include a `reason` slug and a human `message`
// suitable for direct UI display. The 400 case is reserved for "handle
// query param missing entirely" — a structurally broken request, not a
// rejected handle.
//
// No cache: an availability answer goes stale the moment someone takes
// the handle, and the CDN edge isn't smart enough to invalidate per-row.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";
import { validateHandle } from "@/src/bots/handle";

const PATH = "/api/v1/public/check-handle";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = randomUUID();

  const rl = await checkPublicReadRateLimit(clientIpFrom(request));
  if (!rl.ok) {
    return publicReadRateLimitResponse(rl, {
      requestId,
      path: PATH,
      sectorId: "n/a",
      startedAt,
    });
  }
  const rlHeaders = publicReadRateLimitHeaders(rl.publicRead);

  const url = new URL(request.url);
  const raw = url.searchParams.get("handle");
  if (raw === null) {
    log("warn", {
      request_id: requestId,
      path: PATH,
      status: 400,
      error_slug: "invalid_input",
      auth_type: "public",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      {
        error: "invalid_input",
        field: "handle",
        reason: "handle_required",
        message: "`handle` query parameter is required",
        request_id: requestId,
      },
      { status: 400, headers: { "X-Request-Id": requestId, ...rlHeaders } },
    );
  }

  const handleErr = validateHandle(raw);
  if (handleErr) {
    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      auth_type: "public",
      bot_handle: raw,
      check_result: "invalid",
      check_reason: handleErr.slug,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      {
        handle: raw,
        available: false,
        reason: handleErr.slug,
        message: handleErr.message,
        request_id: requestId,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
          ...rlHeaders,
        },
      },
    );
  }

  try {
    const existing = await prisma.bot.findUnique({
      where: { handle: raw },
      select: { id: true },
    });
    const available = existing === null;
    log("info", {
      request_id: requestId,
      path: PATH,
      status: 200,
      auth_type: "public",
      bot_handle: raw,
      check_result: available ? "available" : "taken",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      available
        ? { handle: raw, available: true, request_id: requestId }
        : {
            handle: raw,
            available: false,
            reason: "handle_taken",
            message: "That handle is already in use. Pick a different one.",
            request_id: requestId,
          },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
          ...rlHeaders,
        },
      },
    );
  } catch (err) {
    log("error", {
      request_id: requestId,
      path: PATH,
      status: 500,
      error_slug: "internal_error",
      auth_type: "public",
      bot_handle: raw,
      dependency: "neon",
      message: err instanceof Error ? err.message : "Unknown error",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "internal_error", request_id: requestId },
      { status: 500, headers: { "X-Request-Id": requestId, ...rlHeaders } },
    );
  }
}
