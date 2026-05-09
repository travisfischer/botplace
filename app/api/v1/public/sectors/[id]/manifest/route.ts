// GET /api/v1/public/sectors/:id/manifest — chunk version manifest.
// Returns one entry per chunk that has ever been written (Option A per IM-1
// of the M2 requirement: omits unwritten chunks). Hot path — every viewer
// hits this once per second, so the CDN s-maxage=1 absorbs ~99% of requests.
//
// Output shape:
//   [{ chunk_x, chunk_y, version, updated_at }, ...]
//
// `version` is a stringified BigInt (Prisma's bigint column). Sorted by
// (chunk_y, chunk_x) so client-side diffs have stable ordering.

import { randomUUID } from "node:crypto";

import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";

const CACHE_CONTROL = "public, s-maxage=1, stale-while-revalidate=5";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId } = await params;
  const path = `/api/v1/public/sectors/${sectorId}/manifest`;

  // Cheap existence check before the (potentially) larger chunk query.
  // findUnique by primary key is sub-ms even on Neon cold paths.
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
    headers: { "Cache-Control": CACHE_CONTROL },
  });
}
