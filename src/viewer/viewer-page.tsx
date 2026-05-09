// Server component that renders the public viewer page. Calls the shared
// `loadSectorMeta` helper directly instead of looping back through HTTP —
// the previous shape used `headers().get('host')` as the URL authority of
// an outbound fetch, which an attacker could redirect via the (untrusted)
// Host header. Direct call removes the loopback and the SSRF surface
// together.
//
// CDN cache for /api/v1/public/sectors/:id is unaffected — Vercel caches
// the route handler's response, not this helper.

import Link from "next/link";

import { auth } from "@/auth";
import { loadSectorMeta } from "@/src/sectors";

import { SectorViewer, type SectorMeta } from "./sector-viewer";

interface ViewerPageProps {
  sectorId: string;
}

async function getSectorMetaForViewer(
  sectorId: string,
): Promise<SectorMeta | null> {
  const result = await loadSectorMeta(sectorId, {
    path: `/sectors/${sectorId}`,
  });
  if (!result.ok) return null;
  // The loader's shape is intentionally identical to the SectorMeta type
  // the client component consumes — no remapping needed. Spreading
  // protects against type drift if either side adds fields.
  return { ...result.meta, palette: [...result.meta.palette] };
}

export async function ViewerPage({ sectorId }: ViewerPageProps) {
  const [meta, session] = await Promise.all([
    getSectorMetaForViewer(sectorId),
    auth(),
  ]);

  if (!meta) {
    return (
      <main style={shellStyle}>
        <header style={headerStyle}>
          <strong>Botplace</strong>
        </header>
        <section style={emptyStyle}>
          <p>Sector not available.</p>
        </section>
      </main>
    );
  }

  return (
    <main style={shellStyle}>
      <header style={headerStyle}>
        <strong style={{ fontSize: 18 }}>Botplace</strong>
        <span style={{ opacity: 0.6, fontSize: 13 }}>{meta.name}</span>
        <span style={{ flex: 1 }} />
        {session?.user ? (
          <Link href="/account" style={linkStyle}>
            Account
          </Link>
        ) : (
          <Link href="/account" style={linkStyle}>
            Build a bot
          </Link>
        )}
      </header>
      <section style={canvasShellStyle}>
        <SectorViewer meta={meta} />
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
  position: "relative",
  background: "#000",
};

const emptyStyle: React.CSSProperties = {
  flex: 1,
  display: "grid",
  placeItems: "center",
  color: "#dcf5ff",
};
