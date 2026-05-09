// Shared sector domain logic. The single source of truth for "load
// sector metadata + active palette" — used by both the public route
// handler and the server component that renders the viewer page.
//
// Extracting this avoided a Host-header SSRF: the previous shape had the
// server component fetch its own /api/v1/public/sectors/:id endpoint via
// HTTP loopback using `headers().get('host')` as the URL authority,
// which an attacker could redirect by sending a hostile Host header.
// Calling Prisma directly instead removes the loopback entirely; the CDN
// cache for the route is unaffected (Vercel caches the route's response,
// not the helper).

import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { getPalette } from "@/src/palettes";
import { CHUNK_SIZE } from "@/src/pixels";

export interface SectorMetaResult {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Palette version on the sector row. */
  palette_version: number;
  /** Hex strings, indexed 0..N-1. From the active palette tier for `palette_version`. */
  palette: readonly string[];
  default_color: number;
  chunk_size: number;
  chunks_x: number;
  chunks_y: number;
}

export type LoadSectorMetaOutcome =
  | { ok: true; meta: SectorMetaResult }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "palette_config_drift" };

/**
 * Load sector metadata + the active palette. Returns a tagged result so
 * each consumer can map the failure mode to the right HTTP shape (route
 * handlers → 404/500; server components → "Sector not available." UI).
 *
 * `palette_config_drift` indicates an internal invariant violation
 * (sector row references a palette version not in the palette config).
 * Should be unreachable if `src/palettes/index.ts` and the schema stay
 * in sync; surfaced as 500 by the route handler so config drift is
 * loud rather than silent.
 */
export async function loadSectorMeta(
  sectorId: string,
  context?: { requestId?: string; path?: string },
): Promise<LoadSectorMetaOutcome> {
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
    return { ok: false, reason: "not_found" };
  }

  const palette = getPalette(sector.paletteVersion);
  if (!palette) {
    log("error", {
      request_id: context?.requestId,
      path: context?.path,
      error_slug: "palette_config_drift",
      auth_type: "public",
      sector_id: sectorId,
    });
    return { ok: false, reason: "palette_config_drift" };
  }

  return {
    ok: true,
    meta: {
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
  };
}
