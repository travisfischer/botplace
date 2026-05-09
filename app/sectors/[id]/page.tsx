// Canonical per-sector viewer URL: /sectors/:id. M2 ships sector-1 only;
// the URL shape supports more from day one.
//
// The "M2-only" guard accepts an env-var allow-list for probe sectors
// so docs/dev/probes/m2-viewer.md § Probe 8 can validate empty-canvas
// first paint without a transient code edit. Format: comma-separated
// slugs, e.g. `M2_SECTOR_ALLOWLIST=probe-empty,probe-other`.

import { notFound } from "next/navigation";

import { ViewerPage } from "@/src/viewer/viewer-page";

export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{ id: string }>;
}

function isAllowedSector(id: string): boolean {
  if (id === "sector-1") return true;
  const allow = process.env.M2_SECTOR_ALLOWLIST?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow?.includes(id) ?? false;
}

export default async function SectorRoute({ params }: RouteProps) {
  const { id } = await params;
  if (!isAllowedSector(id)) notFound();
  return <ViewerPage sectorId={id} />;
}
