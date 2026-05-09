// GET /api/v1/public/sectors/:id — sector metadata, no auth.
// Public-readable counterpart of /api/v1/sectors/:id. CDN edge cache is
// the scaling lever (s-maxage=60); no app-level rate limit (V5: anti-abuse
// runs at the Vercel Firewall edge).

import { randomUUID } from "node:crypto";

import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { getPalette } from "@/src/palettes";
import { CHUNK_SIZE } from "@/src/pixels";

const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId } = await params;
  const path = `/api/v1/public/sectors/${sectorId}`;

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
      auth_type: "public",
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
    { headers: { "Cache-Control": CACHE_CONTROL } },
  );
}
