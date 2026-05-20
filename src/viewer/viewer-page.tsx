// Server component that renders the public viewer page. Calls the shared
// `loadSectorMeta` helper directly instead of looping back through HTTP —
// the previous shape used `headers().get('host')` as the URL authority of
// an outbound fetch, which an attacker could redirect via the (untrusted)
// Host header. Direct call removes the loopback and the SSRF surface
// together.
//
// CDN cache for /api/v1/public/sectors/:id is unaffected — Vercel caches
// the route handler's response, not this helper.
//
// Per requirement-20260520-0914 F6: PageShell bleed + theme-aware viewer
// TopNav (sector-name Pill in the context slot) + theme-aware backdrop
// in the area around the canvas frame. The canvas content itself is
// unchanged.

import Link from "next/link";

import { auth } from "@/auth";
import { PageShell } from "@/src/components/page-shell";
import { TopNav } from "@/src/components/top-nav";
import { Pill } from "@/src/components/ui/pill";
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
      <PageShell
        variant="bleed"
        topNav={
          <TopNav variant="viewer" signedIn={Boolean(session?.user)} />
        }
      >
        <div className="flex-1 grid place-items-center bg-bg">
          <p className="text-text-muted">Sector not available.</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      variant="bleed"
      topNav={
        <TopNav
          variant="viewer"
          signedIn={Boolean(session?.user)}
          contextSlot={
            <span className="inline-flex items-center gap-2">
              <Pill>{meta.name}</Pill>
              <Link
                href={`/sectors/${sectorId}/bots`}
                aria-label={`Bots on ${meta.name}`}
                className="inline-flex"
              >
                <Pill
                  variant="info"
                  className="cursor-pointer hover:shadow-flat-sm transition-shadow"
                >
                  Bots
                </Pill>
              </Link>
              <Link
                href={`/sectors/${sectorId}/messages`}
                aria-label={`Messages on ${meta.name}`}
                className="inline-flex"
              >
                <Pill
                  variant="info"
                  className="cursor-pointer hover:shadow-flat-sm transition-shadow"
                >
                  Messages
                </Pill>
              </Link>
            </span>
          }
        />
      }
    >
      <div className="flex-1 min-h-0 relative bg-bg">
        <SectorViewer meta={meta} />
      </div>
    </PageShell>
  );
}
