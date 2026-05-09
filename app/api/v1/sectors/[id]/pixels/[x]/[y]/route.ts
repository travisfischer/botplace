// GET /api/v1/sectors/:id/pixels/:x/:y — single-pixel read.
// Lets a bot confirm its own write. Returns synthetic zero for never-
// written pixels so callers don't need to handle a "not yet" state.

import { randomUUID } from "node:crypto";

import { readAuth } from "@/src/auth/read-auth";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { chunkAddressFor } from "@/src/pixels";
import { checkReadRateLimit, readRateLimitHeaders } from "@/lib/rate-limit";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; x: string; y: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId, x: xStr, y: yStr } = await params;
  const path = `/api/v1/sectors/${sectorId}/pixels/${xStr}/${yStr}`;

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

  const x = Number(xStr);
  const y = Number(yStr);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
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

  if (x < 0 || x >= sector.width || y < 0 || y >= sector.height) {
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

  const { chunkX, chunkY, byteOffset } = chunkAddressFor({ x, y });
  const chunk = await prisma.sectorChunk.findUnique({
    where: {
      sectorId_chunkX_chunkY: { sectorId, chunkX, chunkY },
    },
    select: { data: true, version: true, updatedAt: true },
  });

  // Synthetic zero for never-written chunks. The doc contract: any in-bounds
  // pixel returns a `color`; bots don't need to handle "not yet".
  if (!chunk) {
    log("info", {
      request_id: requestId,
      path,
      status: 200,
      sector_id: sectorId,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { color: 0, chunk_version: "0", updated_at: null },
      { headers: readHeaders },
    );
  }

  const color = chunk.data[byteOffset] ?? 0;
  log("info", {
    request_id: requestId,
    path,
    status: 200,
    sector_id: sectorId,
    chunk_version_after: chunk.version.toString(),
    latency_ms: Date.now() - startedAt,
  });
  return Response.json(
    {
      color,
      chunk_version: chunk.version.toString(),
      updated_at: chunk.updatedAt.toISOString(),
    },
    { headers: readHeaders },
  );
}

