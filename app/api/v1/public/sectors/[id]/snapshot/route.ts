// GET /api/v1/public/sectors/:id/snapshot — full-canvas binary snapshot.
// Returns every written chunk concatenated in one response so the public
// viewer can paint immediately on first load instead of walking the
// manifest + N sequential chunk fetches. After the snapshot the viewer
// drops into the existing manifest/diff polling loop for live updates.
//
// Like the manifest endpoint, never-written chunks are omitted (they
// render as default_color on the client). The synthetic-zero behavior
// from the per-chunk endpoint is unnecessary here — the snapshot's
// purpose is the initial paint, and an absent chunk is already the
// "default fill" signal.
//
// ETag is `"snap-<max-version>"` where max-version is the largest
// chunkVersion across all written chunks for this sector. Pixel writes
// only ever increment chunkVersion, so max strictly monotonically
// increases — a stable, cheap cache key that lets browsers (and the
// Vercel CDN) 304 unchanged snapshots.
//
// Caching mirrors the manifest: s-maxage=1, stale-while-revalidate=5.
// In steady state ~99% of viewers see an edge-cached response.

import { randomUUID } from "node:crypto";

import { clientIpFrom } from "@/lib/http";
import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import {
  checkPublicReadRateLimit,
  publicReadRateLimitHeaders,
  publicReadRateLimitResponse,
} from "@/lib/rate-limit";
import { CHUNK_SIZE } from "@/src/pixels";
import { encodeSnapshot, type SnapshotChunk } from "@/src/viewer/snapshot";

// Browser: always revalidate. See manifest route for the SWR-doubling
// rationale — same fix here.
const CACHE_CONTROL = "private, no-cache";
// Vercel strips s-maxage/swr from plain Cache-Control on dynamic route
// handlers; the CDN directive is what actually enables edge caching.
const CDN_CACHE_CONTROL = "public, s-maxage=1, stale-while-revalidate=5";

function etagFor(maxVersion: bigint | string): string {
  const v = typeof maxVersion === "bigint" ? maxVersion.toString() : maxVersion;
  return `"snap-${v}"`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const { id: sectorId } = await params;
  const path = `/api/v1/public/sectors/${sectorId}/snapshot`;
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

    const rows = await prisma.sectorChunk.findMany({
      where: { sectorId },
      select: { chunkX: true, chunkY: true, version: true, data: true },
      orderBy: [{ chunkY: "asc" }, { chunkX: "asc" }],
    });

    let maxVersion = 0n;
    for (const r of rows) {
      if (r.version > maxVersion) maxVersion = r.version;
    }
    const etag = etagFor(maxVersion);

    if (ifNoneMatch && ifNoneMatch === etag) {
      log("info", {
        request_id: requestId,
        path,
        status: 304,
        auth_type: "public",
        sector_id: sectorId,
        chunk_count: rows.length,
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

    const chunks: SnapshotChunk[] = rows.map((r) => ({
      chunk_x: r.chunkX,
      chunk_y: r.chunkY,
      version: r.version.toString(),
      bytes: new Uint8Array(r.data),
    }));
    const body = encodeSnapshot(chunks, { chunk_size: CHUNK_SIZE });

    log("info", {
      request_id: requestId,
      path,
      status: 200,
      auth_type: "public",
      sector_id: sectorId,
      chunk_count: chunks.length,
      bytes: body.byteLength,
      max_version: maxVersion.toString(),
      latency_ms: Date.now() - startedAt,
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        ETag: etag,
        "X-Snapshot-Chunk-Count": String(chunks.length),
        "X-Snapshot-Max-Version": maxVersion.toString(),
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
