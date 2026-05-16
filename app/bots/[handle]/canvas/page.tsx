// Public bot-filtered canvas at /bots/<handle>/canvas. Renders the full
// sector with only the pixels where this bot is the current author
// visible — everything else falls through to the sector's default
// color via the absent-chunk convention in the BPSS snapshot binary.
//
// Server-rendered shell (header + back link); the interactive canvas
// is a client component (`SectorViewer`) configured in static mode
// (no polling, no heartbeat, click-to-inspect disabled). The viewer
// fetches `/api/v1/public/sectors/sector-1/bots/<handle>/snapshot`
// once on mount.
//
// Sector is hardcoded to `sector-1` for now — the only sector that
// exists in production. Adding multi-sector support later is a layout
// change (sector picker) rather than a re-architecture; the URL +
// API shape already carry the sector id.
//
// 404 on unknown handle. Matches the profile page's shape.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";

import { checkPublicReadRateLimit } from "@/lib/rate-limit";
import {
  botPublicDetailToJson,
  getBotPublicDetail,
} from "@/src/bots";
import { isValidHandle, validateHandle } from "@/src/bots/handle";
import { loadSectorMeta } from "@/src/sectors";
import { SectorViewer, type SectorMeta } from "@/src/viewer/sector-viewer";

export const dynamic = "force-dynamic";

const SECTOR_ID = "sector-1";

interface RouteProps {
  params: Promise<{ handle: string }>;
}

export default async function BotCanvasPage({ params }: RouteProps) {
  const { handle } = await params;

  // Per-IP floor — see app/bots/[handle]/page.tsx for the App-Router
  // rate-limit-hit-renders-soft-view rationale.
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown";
  const rl = await checkPublicReadRateLimit(ip);
  if (!rl.ok && rl.reason === "rate_limited") {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "1.5rem 1rem" }}>
        <h1>Slow down</h1>
        <p style={{ color: "#555" }}>
          Too many requests from this IP. Please retry in a few seconds.
        </p>
      </main>
    );
  }

  if (!isValidHandle(handle)) {
    const err = validateHandle(handle);
    if (err?.slug !== "handle_reserved") notFound();
  }

  const [detail, sector] = await Promise.all([
    getBotPublicDetail({ handle }),
    loadSectorMeta(SECTOR_ID, { path: `/bots/${handle}/canvas` }),
  ]);
  if (!detail) notFound();
  if (!sector.ok) {
    // Sector misconfiguration is operator territory, not a 404.
    return (
      <main style={shellStyle}>
        <section style={emptyStyle}>
          <p>Canvas not available.</p>
        </section>
      </main>
    );
  }

  const detailJson = botPublicDetailToJson(detail);
  const meta: SectorMeta = {
    ...sector.meta,
    palette: [...sector.meta.palette],
  };
  const snapshotUrl = `/api/v1/public/sectors/${SECTOR_ID}/bots/${encodeURIComponent(
    detailJson.handle,
  )}/snapshot`;

  return (
    <main style={shellStyle}>
      <header style={headerStyle}>
        <Link href={`/bots/${detailJson.handle}`} style={linkStyle}>
          ← @{detailJson.handle}
        </Link>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, opacity: 0.7 }}>
          {detailJson.display_name}&rsquo;s canvas
          {" · "}
          <span style={{ opacity: 0.6 }}>{meta.name}</span>
        </span>
      </header>
      <section style={canvasShellStyle}>
        <SectorViewer meta={meta} staticSnapshotUrl={snapshotUrl} />
      </section>
    </main>
  );
}

const shellStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100dvh",
  width: "100vw",
  overflow: "hidden",
  fontFamily: "system-ui, -apple-system, sans-serif",
  margin: 0,
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 16px",
  borderBottom: "1px solid #2a2a2a",
  background: "#0a0a0a",
  color: "#dcf5ff",
};

const linkStyle: React.CSSProperties = {
  color: "#dcf5ff",
  textDecoration: "none",
  fontSize: 13,
  padding: "4px 10px",
  borderRadius: 4,
  border: "1px solid #2a2a2a",
};

const canvasShellStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  position: "relative",
  background: "#000",
};

const emptyStyle: React.CSSProperties = {
  flex: 1,
  display: "grid",
  placeItems: "center",
  color: "#dcf5ff",
};
