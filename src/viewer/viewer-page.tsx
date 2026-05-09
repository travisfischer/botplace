// Server component that renders the public viewer page. Fetches sector
// metadata via the public HTTP endpoint (per IM-4) so SSR rides the same
// CDN cache as client refreshes — no extra Prisma cold-start hit per
// fresh visit.

import { headers } from "next/headers";
import Link from "next/link";

import { auth } from "@/auth";

import { SectorViewer, type SectorMeta } from "./sector-viewer";

interface ViewerPageProps {
  sectorId: string;
}

async function getSectorMeta(sectorId: string): Promise<SectorMeta | null> {
  const h = await headers();
  const host = h.get("host");
  if (!host) return null;
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const url = `${proto}://${host}/api/v1/public/sectors/${sectorId}`;
  // 60s revalidate matches the endpoint's s-maxage; SSR shares the cache.
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) return null;
  return (await res.json()) as SectorMeta;
}

export async function ViewerPage({ sectorId }: ViewerPageProps) {
  const [meta, session] = await Promise.all([
    getSectorMeta(sectorId),
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
        <Link href="/api/v1/public/sectors/sector-1" style={linkStyle}>
          API
        </Link>
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
