// Public bot-filtered canvas at /bots/<handle>/canvas. Renders the full
// sector with only the pixels where this bot is the current author
// visible — everything else falls through to the sector's default
// color via the absent-chunk convention in the BPSS snapshot binary.
//
// Server-rendered shell (PageShell bleed + viewer TopNav); the
// interactive canvas is a client component (`SectorViewer`) configured
// in static mode (no polling, no heartbeat, click-to-inspect disabled).
// The viewer fetches `/api/v1/public/sectors/sector-1/bots/<handle>/snapshot`
// once on mount.
//
// Sector is hardcoded to `sector-1` for now — the only sector that
// exists in production. Adding multi-sector support later is a layout
// change (sector picker) rather than a re-architecture; the URL +
// API shape already carry the sector id.
//
// 404 on unknown handle. Matches the profile page's shape.
//
// Per requirement-20260520-0914 F7: shared TopNav + an accent pill
// in the context slot signaling "filtered canvas," so visitors can tell
// at a glance they're not looking at the unfiltered sector.

import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { checkPublicReadRateLimit } from "@/lib/rate-limit";
import { PageShell } from "@/src/components/page-shell";
import { TopNav } from "@/src/components/top-nav";
import { Card } from "@/src/components/ui/card";
import { Pill } from "@/src/components/ui/pill";
import { botPublicDetailToJson, getBotPublicDetail } from "@/src/bots";
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
  const session = await auth();

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
      <PageShell
        variant="narrow"
        topNav={
          <TopNav variant="viewer" signedIn={Boolean(session?.user)} />
        }
      >
        <Card className="text-center">
          <h1 className="font-display font-extrabold uppercase tracking-tight text-2xl mb-2">
            Slow down
          </h1>
          <p className="text-text-muted">
            Too many requests from this IP. Please retry in a few seconds.
          </p>
        </Card>
      </PageShell>
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

  const detailJson = botPublicDetailToJson(detail);

  const contextSlot = (
    <span className="inline-flex items-center gap-2">
      <Link
        href={`/bots/${detailJson.handle}`}
        className="text-sm font-bold text-text-muted hover:text-brand transition-colors"
      >
        ← @{detailJson.handle}
      </Link>
      <Pill variant="live">filtered canvas</Pill>
    </span>
  );

  if (!sector.ok) {
    // Sector misconfiguration is operator territory, not a 404.
    return (
      <PageShell
        variant="bleed"
        topNav={
          <TopNav
            variant="viewer"
            signedIn={Boolean(session?.user)}
            contextSlot={contextSlot}
          />
        }
      >
        <div className="flex-1 grid place-items-center">
          <p className="text-text-muted">Canvas not available.</p>
        </div>
      </PageShell>
    );
  }

  const meta: SectorMeta = {
    ...sector.meta,
    palette: [...sector.meta.palette],
  };
  const snapshotUrl = `/api/v1/public/sectors/${SECTOR_ID}/bots/${encodeURIComponent(
    detailJson.handle,
  )}/snapshot`;

  return (
    <PageShell
      variant="bleed"
      topNav={
        <TopNav
          variant="viewer"
          signedIn={Boolean(session?.user)}
          contextSlot={contextSlot}
        />
      }
    >
      <div className="flex-1 min-h-0 relative bg-bg">
        <SectorViewer meta={meta} staticSnapshotUrl={snapshotUrl} />
      </div>
    </PageShell>
  );
}
