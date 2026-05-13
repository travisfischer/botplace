// GET /api/v1/public/sectors/:id/chunks/:chunk_x/:chunk_y — packed chunk
// binary, no auth. The hot per-chunk path: viewer fetches this only when
// the manifest tells it the chunk version moved.
//
// ETag = `"<chunk_version>"` per RFC 7232. On `If-None-Match` match,
// return 304 with no body. The Vercel CDN edge honors If-None-Match
// round-trips on app-router responses.
//
// Synthetic zero blob for never-written chunks; ETag = `"0"`. Clients can
// short-circuit unwritten chunks across ticks via the same 304 path.
//
// In-app PUBLIC_READ rate-limit (per-IP, 60/sec) sits below the Vercel
// Firewall edge rule. The strict `^(0|[1-9][0-9]{0,3})$` regex on
// chunk-coord path segments rejects non-canonical forms (`"01"`, `"+0"`,
// `"0e0"`, etc.) so an attacker can't mint distinct CDN cache keys for
// the same chunk via Number()-permissive coercion (M2 review P2.5).

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";
import { CHUNK_BYTES, CHUNK_SIZE } from "@/src/pixels";

// Browser: always revalidate. See manifest route for the SWR-doubling
// rationale. The viewer's chunk fetch sends If-None-Match, so the
// "always revalidate" cost is a cheap 304 when nothing changed.
const CACHE_CONTROL = "private, no-cache";
// See lib comment in manifest/route.ts — Vercel strips s-maxage from
// plain Cache-Control on dynamic route handlers, so explicit CDN
// directive is required for edge caching to kick in.
const CDN_CACHE_CONTROL = "public, s-maxage=1, stale-while-revalidate=30";

// Strict canonical form: zero, or a 1-4 digit positive integer. No
// leading zeros, no signs, no scientific/hex/binary, no decimals.
// `[0-9]{0,3}` is fine for M2 (sector-1 = 10 chunks per axis); future
// larger sectors should bump the digit cap.
const CANONICAL_COORD = /^(0|[1-9][0-9]{0,3})$/;

function etagFor(version: bigint | string): string {
  const v = typeof version === "bigint" ? version.toString() : version;
  return `"${v}"`;
}

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; chunk_x: string; chunk_y: string }>;
  },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId, chunk_x: cxStr, chunk_y: cyStr } = await params;
  const path = `/api/v1/public/sectors/${sectorId}/chunks/${cxStr}/${cyStr}`;
  const ifNoneMatch = request.headers.get("if-none-match");

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

  if (!CANONICAL_COORD.test(cxStr) || !CANONICAL_COORD.test(cyStr)) {
    log("warn", {
      request_id: requestId,
      path,
      status: 400,
      error_slug: "invalid_input",
      auth_type: "public",
      sector_id: sectorId,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "invalid_input", request_id: requestId },
      { status: 400 },
    );
  }
  const chunkX = Number(cxStr);
  const chunkY = Number(cyStr);

  try {
    const sector = await prisma.sector.findUnique({
      where: { id: sectorId },
      select: { width: true, height: true },
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

    const maxChunkX = Math.ceil(sector.width / CHUNK_SIZE) - 1;
    const maxChunkY = Math.ceil(sector.height / CHUNK_SIZE) - 1;
    if (chunkX < 0 || chunkX > maxChunkX || chunkY < 0 || chunkY > maxChunkY) {
      log("warn", {
        request_id: requestId,
        path,
        status: 400,
        error_slug: "out_of_bounds",
        auth_type: "public",
        sector_id: sectorId,
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        { error: "out_of_bounds", request_id: requestId },
        { status: 400 },
      );
    }

    const chunk = await prisma.sectorChunk.findUnique({
      where: { sectorId_chunkX_chunkY: { sectorId, chunkX, chunkY } },
      select: { data: true, version: true, updatedAt: true },
    });

    const versionStr = chunk ? chunk.version.toString() : "0";
    const etag = etagFor(versionStr);

    if (ifNoneMatch && ifNoneMatch === etag) {
      log("info", {
        request_id: requestId,
        path,
        status: 304,
        auth_type: "public",
        sector_id: sectorId,
        chunk_version_after: versionStr,
        latency_ms: Date.now() - startedAt,
      });
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": CACHE_CONTROL,
          "CDN-Cache-Control": CDN_CACHE_CONTROL,
          ...rlHeaders,
        },
      });
    }

    if (!chunk) {
      log("info", {
        request_id: requestId,
        path,
        status: 200,
        auth_type: "public",
        sector_id: sectorId,
        chunk_version_after: "0",
        latency_ms: Date.now() - startedAt,
      });
      return new Response(new Uint8Array(CHUNK_BYTES), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          ETag: etag,
          "X-Chunk-Version": "0",
          "Cache-Control": CACHE_CONTROL,
          "CDN-Cache-Control": CDN_CACHE_CONTROL,
          ...rlHeaders,
        },
      });
    }

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      sector_id: sectorId,
      chunk_version_after: versionStr,
      latency_ms: Date.now() - startedAt,
    });
    return new Response(chunk.data, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        ETag: etag,
        "X-Chunk-Version": versionStr,
        "X-Chunk-Updated-At": chunk.updatedAt.toISOString(),
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
