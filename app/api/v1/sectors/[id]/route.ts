// GET /api/v1/sectors/:id — sector metadata (dimensions, palette).
// Authenticated; rate-limited via the shared read bucket so a script that
// hammers it can't spam the DB.

import { randomUUID } from "node:crypto";

import { readAuth } from "@/src/auth/read-auth";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { getPalette } from "@/src/palettes";
import { CHUNK_SIZE } from "@/src/pixels";
import { checkReadRateLimit, readRateLimitHeaders } from "@/lib/rate-limit";

const PATH_BASE = "/api/v1/sectors";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId } = await params;
  const path = `${PATH_BASE}/${sectorId}`;

  const a = await readAuth(_request);
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

  const sector = await prisma.sector.findUnique({
    where: { id: sectorId },
    select: {
      id: true,
      name: true,
      width: true,
      height: true,
      paletteVersion: true,
    },
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

  const palette = getPalette(sector.paletteVersion);
  if (!palette) {
    // Should be unreachable — palette config should always include the
    // versions actually persisted on Sector rows. Surface as 500 if it
    // isn't, so we know we have a config drift bug.
    log("error", {
      request_id: requestId,
      path,
      status: 500,
      error_slug: "palette_config_drift",
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
    sector_id: sectorId,
    latency_ms: Date.now() - startedAt,
  });

  return Response.json(
    {
      id: sector.id,
      name: sector.name,
      width: sector.width,
      height: sector.height,
      palette_version: sector.paletteVersion,
      palette: palette.colors,
      default_color: 0,
      chunk_size: CHUNK_SIZE,
      chunks_x: Math.ceil(sector.width / CHUNK_SIZE),
      chunks_y: Math.ceil(sector.height / CHUNK_SIZE),
    },
    { headers: readHeaders },
  );
}
