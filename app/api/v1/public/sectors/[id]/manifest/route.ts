// GET /api/v1/public/sectors/:id/manifest — chunk version manifest.
// Returns one entry per chunk that has ever been written (Option A per
// IM-1: omits unwritten chunks). Hot path — every viewer hits this once
// per second; CDN s-maxage=1 absorbs ~99% of viewer ticks.
//
// In-app PUBLIC_READ rate-limit (per-IP, 60/sec) is the floor below the
// Vercel Firewall edge rule (`docs/admin/v1.md`). Wraps Prisma calls in
// try/catch so connection storms surface as structured 500s instead of
// silent unhandled rejections.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";

// Browser: always revalidate. Sharing s-maxage + swr with the CDN value
// below caused the browser to do a background SWR revalidation on every
// poll (1Hz JS poll → 2 origin-bound HTTP requests/sec), doubling load
// on the per-IP rate-limit bucket. `no-cache` forces revalidation each
// poll; the request itself still costs nothing extra because the JS
// poll already issues it once per second.
const CACHE_CONTROL = "private, no-cache";
// Vercel's CDN respects CDN-Cache-Control on dynamic route handlers
// without downgrading. Without this, plain Cache-Control is stripped
// of s-maxage/swr and the edge never caches — every viewer poll would
// hit origin.
const CDN_CACHE_CONTROL = "public, s-maxage=1, stale-while-revalidate=5";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId } = await params;
  const path = `/api/v1/public/sectors/${sectorId}/manifest`;

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
        { status: 404 },
      );
    }

    // The `data` Bytes column is intentionally omitted from the select —
    // it can be tens of MB across a fully-painted sector and would dwarf
    // the manifest's purpose as a cheap "what changed?" probe. Chunk
    // bytes travel via the chunk endpoint.
    const chunks = await prisma.sectorChunk.findMany({
      where: { sectorId },
      select: {
        chunkX: true,
        chunkY: true,
        version: true,
        updatedAt: true,
      },
      orderBy: [{ chunkY: "asc" }, { chunkX: "asc" }],
    });

    const body = chunks.map((c) => ({
      chunk_x: c.chunkX,
      chunk_y: c.chunkY,
      version: c.version.toString(),
      updated_at: c.updatedAt.toISOString(),
    }));

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      sector_id: sectorId,
      chunk_count: chunks.length,
      latency_ms: Date.now() - startedAt,
    });

    return Response.json(body, {
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
