// GET /api/v1/sectors/:id/manifest — chunk version manifest, authenticated.
//
// Same shape as the public manifest at `/api/v1/public/.../manifest`,
// gated behind the M1 read auth. Lets bots running mirroring/diff-poll
// patterns use the per-credential read bucket instead of the shared
// per-IP public bucket — agent-native parity (M2 review P2.10).

import { randomUUID } from "node:crypto";

import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import {
  checkReadRateLimit,
  readRateLimitHeaders,
} from "@/lib/rate-limit";
import { readAuth } from "@/src/auth/read-auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId } = await params;
  const path = `/api/v1/sectors/${sectorId}/manifest`;

  const auth = await readAuth(request);
  if (!auth.ok) {
    log("warn", {
      request_id: requestId,
      path,
      status: 401,
      error_slug: "unauthorized",
      auth_failure_reason: auth.reason,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const a = auth.data;

  const rl = await checkReadRateLimit(a.callerKey);
  if (!rl.ok) {
    if (rl.reason === "rate_limit_unavailable") {
      log("error", {
        request_id: requestId,
        path,
        status: 503,
        error_slug: "rate_limit_unavailable",
        auth_type: a.authType,
        owner_id: a.ownerId,
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
      auth_type: a.authType,
      owner_id: a.ownerId,
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
      auth_type: a.authType,
      owner_id: a.ownerId,
      sector_id: sectorId,
      latency_ms: Date.now() - startedAt,
    });
    return Response.json(
      { error: "sector_not_found", request_id: requestId },
      { status: 404 },
    );
  }

  // `data` Bytes column intentionally omitted — manifest is the cheap
  // "what changed?" probe; chunk bytes travel via the chunk endpoint.
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
    auth_type: a.authType,
    owner_id: a.ownerId,
    sector_id: sectorId,
    chunk_count: chunks.length,
    latency_ms: Date.now() - startedAt,
  });

  return Response.json(body, { headers: readHeaders });
}
