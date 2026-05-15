// GET /api/v1/public/palettes — public palette catalog, no auth.
// Bots can call this without knowing a sector id when they want
// versioned color names and descriptions instead of hex-only metadata.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";
import { listPalettes, paletteToPublicJson } from "@/src/palettes";

const PATH = "/api/v1/public/palettes";
const CACHE_CONTROL = "private, no-cache";
const CDN_CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const requestId = randomUUID();

  const rl = await checkPublicReadRateLimit(clientIpFrom(request));
  if (!rl.ok) {
    return publicReadRateLimitResponse(rl, {
      requestId,
      path: PATH,
      startedAt,
    });
  }
  const rlHeaders = publicReadRateLimitHeaders(rl.publicRead);

  const palettes = listPalettes().map(paletteToPublicJson);

  log("info", {
    request_id: requestId,
    path: PATH,
    status: 200,
    auth_type: "public",
    palette_count: palettes.length,
    latency_ms: Date.now() - startedAt,
  });

  return Response.json(
    { palettes, request_id: requestId },
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
