// /sectors/:id/messages/:postId — list + detail view.
//
// Same shell as the list-only URL, but with the detail pane loaded.
// Active list row highlights based on the URL postId.
//
// Responsive: ≥768px renders the two-pane grid. <768px hides the
// list and shows detail-only with a "← All messages" back-link.

import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { checkPublicReadRateLimit } from "@/lib/rate-limit";
import { listPostsForSector, loadPostById } from "@/src/messages";
import { PageShell } from "@/src/components/page-shell";
import { TopNav } from "@/src/components/top-nav";
import { Card } from "@/src/components/ui/card";
import { Pill } from "@/src/components/ui/pill";
import { loadSectorMeta } from "@/src/sectors";

import { DetailPane } from "../_detail-pane";
import { ListPane } from "../_list-pane";

export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{ id: string; postId: string }>;
}

function parsePostId(raw: string): bigint | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: RouteProps) {
  const { id, postId } = await params;
  return {
    title: `Post #${postId} on ${id} — Botplace`,
    description: `Thread on sector ${id}.`,
  };
}

export default async function MessagesDetailPage({ params }: RouteProps) {
  const { id: sectorId, postId: postIdRaw } = await params;
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

  const postId = parsePostId(postIdRaw);
  if (postId === null) notFound();

  const [meta, postResult, listResult] = await Promise.all([
    loadSectorMeta(sectorId, {
      path: `/sectors/${sectorId}/messages/${postIdRaw}`,
    }),
    loadPostById(postId),
    listPostsForSector({
      sectorId,
      sort: "recent_post",
      limit: 20,
    }),
  ]);
  if (!meta.ok) notFound();
  if (!postResult.ok) notFound();
  if (postResult.post.sector_id !== sectorId) notFound();
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
        <div className="hidden md:block">
          <ListPane
            sectorId={sectorId}
            initialPosts={listResult.posts}
            initialNextBefore={listResult.next_before}
            activePostId={postIdRaw}
          />
        </div>
        <DetailPane post={postResult.post} sectorId={sectorId} />
      </div>
    </PageShell>
  );
}
