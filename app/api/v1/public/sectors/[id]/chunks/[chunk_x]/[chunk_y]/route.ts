// GET /api/v1/public/sectors/:id/chunks/:chunk_x/:chunk_y — packed chunk
// binary, no auth. The hot per-chunk path: viewer fetches this only when
// the manifest tells it the chunk version moved.
//
// ETag = `"<chunk_version>"` per RFC 7232 (must be quoted). On
// `If-None-Match` match, return 304 with no body. The Vercel CDN edge
// honors If-None-Match round-trips on app-router responses.
//
// Synthetic zero blob for never-written chunks; ETag = `"0"`. Clients can
// short-circuit unwritten chunks across ticks via the same 304 path.

import { randomUUID } from "node:crypto";

import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { CHUNK_BYTES, CHUNK_SIZE } from "@/src/pixels";

const CACHE_CONTROL = "public, s-maxage=1, stale-while-revalidate=30";

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

  const chunkX = Number(cxStr);
  const chunkY = Number(cyStr);
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY)) {
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

  // Build the canonical ETag for the version we're about to return so the
  // 304 short-circuit and the 200 response agree. For never-written chunks,
  // the version is "0" and the synthetic zero blob is the body.
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
    },
  });
}
