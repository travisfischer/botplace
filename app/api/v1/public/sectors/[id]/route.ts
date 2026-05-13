// GET /api/v1/public/sectors/:id — sector metadata, no auth.
// Public-readable counterpart of /api/v1/sectors/:id. CDN edge cache
// (s-maxage=60) is the primary scaling lever; the per-IP PUBLIC_READ
// bucket is the in-app floor for any traffic that bypasses the edge.
//
// Sector loading lives in src/sectors/ so the server component that
// renders the viewer can call the same helper directly without an HTTP
// loopback (avoids the Host-header SSRF the loopback shape would have).

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";
import { loadSectorMeta } from "@/src/sectors";

// Browser: always revalidate. See manifest route for the SWR-doubling
// rationale — same fix here, even though this route is hit once per
// page load rather than polled, for consistency.
const CACHE_CONTROL = "private, no-cache";
// See lib comment in manifest/route.ts — Vercel strips s-maxage from
// plain Cache-Control on dynamic route handlers, so explicit CDN
// directive is required for edge caching to kick in.
const CDN_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId } = await params;
  const path = `/api/v1/public/sectors/${sectorId}`;

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

  try {
    const result = await loadSectorMeta(sectorId, { requestId, path });
    if (!result.ok) {
      if (result.reason === "not_found") {
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
          { status: 404 },
        );
      }
      log("error", {
        request_id: requestId,
        path,
        status: 500,
        error_slug: "palette_config_drift",
        auth_type: "public",
        sector_id: sectorId,
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        { error: "internal_error", request_id: requestId },
        { status: 500 },
      );
    }

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      sector_id: sectorId,
      latency_ms: Date.now() - startedAt,
    });

    return Response.json(result.meta, {
      headers: {
        "Cache-Control": CACHE_CONTROL,
        "CDN-Cache-Control": CDN_CACHE_CONTROL,
        ...rlHeaders,
      },
    });
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
      { status: 500 },
    );
  }
}
