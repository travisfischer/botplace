// GET /api/v1/public/palettes/:version — one public palette, no auth.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";
import { getPalette, paletteToPublicJson } from "@/src/palettes";

const CACHE_CONTROL = "private, no-cache";
const CDN_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ version: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { version: rawVersion } = await params;
  const path = `/api/v1/public/palettes/${rawVersion}`;

  const rl = await checkPublicReadRateLimit(clientIpFrom(request));
  if (!rl.ok) {
    return publicReadRateLimitResponse(rl, {
      requestId,
      path,
      startedAt,
    });
  }
  const rlHeaders = publicReadRateLimitHeaders(rl.publicRead);

  const version = Number(rawVersion);
  if (!Number.isInteger(version) || version <= 0) {
    log("warn", {
      request_id: requestId,
      path,
      status: 400,
      error_slug: "invalid_input",
      auth_type: "public",
      field: "version",
      reason: "invalid_version",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      {
        error: "invalid_input",
        field: "version",
        reason: "invalid_version",
        message: "`version` must be a positive integer",
        request_id: requestId,
      },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
          ...rlHeaders,
        },
      },
    );
  }

  const palette = getPalette(version);
  if (!palette) {
    log("warn", {
      request_id: requestId,
      path,
      status: 404,
      error_slug: "palette_not_found",
      auth_type: "public",
      palette_version: version,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "palette_not_found", request_id: requestId },
      {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-Id": requestId,
          ...rlHeaders,
        },
      },
    );
  }

  log("info", {
    request_id: requestId,
    path,
    status: 200,
    auth_type: "public",
    palette_version: version,
    latency_ms: Date.now() - startedAt,
  });

  return Response.json(
    { ...paletteToPublicJson(palette), request_id: requestId },
    {
      headers: {
        "Cache-Control": CACHE_CONTROL,
        "CDN-Cache-Control": CDN_CACHE_CONTROL,
        "X-Request-Id": requestId,
        ...rlHeaders,
      },
    },
  );
}
