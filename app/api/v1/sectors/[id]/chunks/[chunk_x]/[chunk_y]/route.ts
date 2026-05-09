// GET /api/v1/sectors/:id/chunks/:chunk_x/:chunk_y — chunk read primitive.
// Returns the packed binary blob (CHUNK_SIZE * CHUNK_SIZE = 10000 bytes
// for the M1 chunk size). Custom headers carry version + updated_at so
// clients don't have to parse JSON for hot-path read.
//
// Synthetic zero blob for never-written chunks; the X-Chunk-Updated-At
// header is omitted in that case (rather than empty/null) so clients can
// detect "never written" without a sentinel value.

import { randomUUID } from "node:crypto";

import { readAuth } from "@/src/auth/read-auth";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { CHUNK_BYTES, CHUNK_SIZE } from "@/src/pixels";
import { checkReadRateLimit, readRateLimitHeaders } from "@/lib/rate-limit";

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
  const path = `/api/v1/sectors/${sectorId}/chunks/${cxStr}/${cyStr}`;

  const a = await readAuth(request);
  if (!a) {
    log("warn", {
      request_id: requestId,
      path,
      status: 401,
      error_slug: "unauthorized",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const rl = await checkReadRateLimit(a.callerKey);
  if (!rl.ok) {
    if (rl.reason === "rate_limit_unavailable") {
      log("error", {
        request_id: requestId,
        path,
        status: 503,
        error_slug: "rate_limit_unavailable",
        dependency: "upstash",
        latency_ms: Date.now() - startedAt,
      });
      return Response.json(
        { error: "rate_limit_unavailable", request_id: requestId },
        { status: 503 },
      );
    }
    log("warn", {
      request_id: requestId,
      path,
      status: 429,
      error_slug: "rate_limited",
      rate_limit_scope: "read",
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "rate_limited", scope: rl.scope, request_id: requestId },
      {
        status: 429,
        headers: readRateLimitHeaders(rl.read, rl.retryAfterSeconds),
      },
    );
  }
  const readHeaders = readRateLimitHeaders(rl.read);

  const chunkX = Number(cxStr);
  const chunkY = Number(cyStr);
  if (!Number.isInteger(chunkX) || !Number.isInteger(chunkY)) {
    log("warn", {
      request_id: requestId,
      path,
      status: 400,
      error_slug: "invalid_input",
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
      sector_id: sectorId,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "sector_not_found", request_id: requestId },
      { status: 404 },
    );
  }

  // Chunk bounds: ceil(width / CHUNK_SIZE) chunks across, etc. Chunks are
  // 0-indexed, so the max valid chunk_x is `ceil(width / CHUNK_SIZE) - 1`.
  const maxChunkX = Math.ceil(sector.width / CHUNK_SIZE) - 1;
  const maxChunkY = Math.ceil(sector.height / CHUNK_SIZE) - 1;
  if (chunkX < 0 || chunkX > maxChunkX || chunkY < 0 || chunkY > maxChunkY) {
    log("warn", {
      request_id: requestId,
      path,
      status: 400,
      error_slug: "out_of_bounds",
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

  if (!chunk) {
    log("info", {
      request_id: requestId,
      path,
      status: 200,
      sector_id: sectorId,
      chunk_version_after: "0",
      latency_ms: Date.now() - startedAt,
    });
    return new Response(new Uint8Array(CHUNK_BYTES), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Chunk-Version": "0",
        ...readHeaders,
      },
    });
  }

  log("info", {
    request_id: requestId,
    path,
    status: 200,
    sector_id: sectorId,
    chunk_version_after: chunk.version.toString(),
    latency_ms: Date.now() - startedAt,
  });
  return new Response(chunk.data, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Chunk-Version": chunk.version.toString(),
      "X-Chunk-Updated-At": chunk.updatedAt.toISOString(),
      ...readHeaders,
    },
  });
}
