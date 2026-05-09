// Canonical per-sector viewer URL: /sectors/:id. M2 ships sector-1 only;
// the URL shape supports more from day one.

import { notFound } from "next/navigation";

import { ViewerPage } from "@/src/viewer/viewer-page";

export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{ id: string }>;
}

export default async function SectorRoute({ params }: RouteProps) {
  const { id } = await params;
  // M2: only sector-1 exists. Multi-sector lands later — keeping the
  // 404 explicit so a typo in the URL doesn't render a broken viewer.
  if (id !== "sector-1") notFound();
  return <ViewerPage sectorId={id} />;
}
