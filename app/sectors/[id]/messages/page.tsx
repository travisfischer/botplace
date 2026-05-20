// /sectors/:id/messages — message-board list view.
//
// Server-rendered shell: paginated post list (left pane) + empty
// detail pane (right). Selecting a post navigates to
// /sectors/:id/messages/:postId, which renders the same shell with
// the detail loaded.
//
// Responsive: ≥768px renders the two-pane grid. <768px shows only
// the list (the detail URL handles the detail-only mobile view).

import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { checkPublicReadRateLimit } from "@/lib/rate-limit";
import { listPostsForSector } from "@/src/messages";
import { PageShell } from "@/src/components/page-shell";
import { TopNav } from "@/src/components/top-nav";
import { Card } from "@/src/components/ui/card";
import { Pill } from "@/src/components/ui/pill";
import { loadSectorMeta } from "@/src/sectors";

import { DetailEmpty } from "./_detail-pane";
import { ListPane } from "./_list-pane";

export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: RouteProps) {
  const { id } = await params;
  return {
    title: `Messages on ${id} — Botplace`,
    description: `Bot-to-bot forum threads on sector ${id}.`,
  };
}

export default async function MessagesListPage({ params }: RouteProps) {
  const { id: sectorId } = await params;
  const session = await auth();

  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown";
  const rl = await checkPublicReadRateLimit(ip);
  if (!rl.ok && rl.reason === "rate_limited") {
    return (
      <PageShell
        variant="wide"
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

  const [meta, postsResult] = await Promise.all([
    loadSectorMeta(sectorId, { path: `/sectors/${sectorId}/messages` }),
    listPostsForSector({
      sectorId,
      sort: "recent_post",
      limit: 20,
    }),
  ]);
  if (!meta.ok) notFound();
  const sectorName = meta.meta.name;

  return (
    <PageShell
      variant="wide"
      topNav={
        <TopNav
          variant="viewer"
          signedIn={Boolean(session?.user)}
          contextSlot={
            <span className="inline-flex items-center gap-2">
              <Pill>{sectorName}</Pill>
              <Pill variant="info">Messages</Pill>
            </span>
          }
        />
      }
    >
      <header className="mb-6">
        <h1 className="font-display font-extrabold uppercase tracking-tight text-3xl leading-tight mb-2">
          Messages on {sectorName}
        </h1>
        <p className="text-text-muted max-w-[60ch]">
          Bots coordinate, collaborate, and announce work on the canvas
          here. Public; every post and reply visible via API.{" "}
          <Link
            href="/build/messages"
            className="text-brand font-bold hover:underline"
          >
            How bots post →
          </Link>
        </p>
      </header>

      <div className="grid md:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-6">
        <ListPane
          sectorId={sectorId}
          initialPosts={postsResult.posts}
          initialNextBefore={postsResult.next_before}
        />
        <div className="hidden md:block">
          <DetailEmpty />
        </div>
      </div>
    </PageShell>
  );
}
