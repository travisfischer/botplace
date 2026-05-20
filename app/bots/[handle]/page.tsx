// Public bot profile page at /bots/<handle>. Server-rendered: the
// bot's public metadata + the first 20 events; the activity feed
// becomes interactive once the client component hydrates ("Load more"
// pulls older batches via the existing events API).
//
// Lookup is by handle only. The bot-detail API supports both handle
// and cuid id; the page URL deliberately doesn't — handle is the
// canonical public identifier, and a cuid in the URL would be ugly.
//
// Reserved handles are queryable (the M2.5 launch bots got there
// first under conventional names); the page resolves them the same
// as any other handle. The reserved-handle protection only applies
// at owner-create time.
//
// 404 on unknown handle. Matches the bot-detail API endpoint's shape
// at /api/v1/public/bots/<handle_or_id>.
//
// Per requirement-20260520-0914 F11: PageShell narrow + viewer TopNav
// + Card-wrapped profile header + token-driven activity feed.

import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { formatRelative } from "@/lib/format-relative";
import { checkPublicReadRateLimit } from "@/lib/rate-limit";
import { PageShell } from "@/src/components/page-shell";
import { TopNav } from "@/src/components/top-nav";
import { Card } from "@/src/components/ui/card";
import { Pill } from "@/src/components/ui/pill";
import {
  botPublicDetailToJson,
  descriptionsDisabled,
  getBotPublicDetail,
} from "@/src/bots";
import { loadBotEventsByHandle } from "@/src/bots/events";
import { isValidHandle, validateHandle } from "@/src/bots/handle";
import { getPalette } from "@/src/palettes";
import { commentsDisabled } from "@/src/pixels";

import { ActivityFeed, type FeedEvent } from "./_activity-feed";

export const dynamic = "force-dynamic";

const INITIAL_PAGE_SIZE = 20;

interface RouteProps {
  params: Promise<{ handle: string }>;
}

export default async function BotProfilePage({ params }: RouteProps) {
  const { handle } = await params;

  const session = await auth();

  // App-level per-IP floor on the page itself, mirroring the public
  // events API. Vercel Firewall is the first line at the edge; this
  // catches anything that bypasses it. App Router pages can't return a
  // 429 cleanly, so a rate-limit hit renders a soft "Slow down" view
  // (the underlying limit-unavailable path renders the same — failing
  // closed on the upstream limiter would lock everyone out).
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

  // Format check first. Reserved handles are permitted for lookup
  // (matches the events endpoint shape) — only completely-malformed
  // handles bail before we hit the DB.
  if (!isValidHandle(handle)) {
    const err = validateHandle(handle);
    if (err?.slug !== "handle_reserved") notFound();
  }

  const detail = await getBotPublicDetail({ handle });
  if (!detail) notFound();

  const { events: initialEvents } = await loadBotEventsByHandle({
    handle: detail.handle,
    limit: INITIAL_PAGE_SIZE,
    suppressComment: commentsDisabled(),
  });

  const suppressDescription = descriptionsDisabled();
  const detailJson = botPublicDetailToJson(detail);

  const feedEvents: FeedEvent[] = initialEvents.map((e) => ({
    x: e.x,
    y: e.y,
    color: e.color,
    palette_version: e.paletteVersion,
    accepted_at: e.createdAt.toISOString(),
    sector_id: e.sectorId,
    comment: e.comment,
  }));

  // Pre-resolve the palettes referenced by the initial batch + v1 as a
  // baseline so the swatch renderer always has something to draw. The
  // client component reuses this map and fetches missing versions
  // lazily (none expected today since palette_version is always 1).
  const paletteVersionsInBatch = new Set(
    feedEvents.map((e) => e.palette_version),
  );
  paletteVersionsInBatch.add(1);
  const palettes: Record<number, readonly string[]> = {};
  for (const v of paletteVersionsInBatch) {
    const p = getPalette(v);
    if (p) palettes[v] = p.colors;
  }

  return (
    <PageShell
      variant="narrow"
      topNav={<TopNav variant="viewer" signedIn={Boolean(session?.user)} />}
    >
      <Card className="mb-6">
        <h1 className="font-display font-extrabold uppercase tracking-tight text-3xl leading-tight mb-2">
          {detailJson.display_name}
        </h1>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Pill>
            <code className="font-mono">@{detailJson.handle}</code>
          </Pill>
          <Pill variant="info" title="Rate-limit tier">
            {detailJson.rate_tier}
          </Pill>
          <span
            className="text-xs text-text-muted"
            title={detailJson.created_at}
          >
            joined {formatRelative(detailJson.created_at)}
          </span>
          {detailJson.last_seen_at ? (
            <span
              className="text-xs text-text-muted"
              title={detailJson.last_seen_at}
            >
              · last seen {formatRelative(detailJson.last_seen_at)}
            </span>
          ) : null}
        </div>

        {!suppressDescription && detailJson.description ? (
          <p className="text-base text-text leading-snug whitespace-pre-wrap">
            {detailJson.description}
          </p>
        ) : (
          <p className="text-sm text-text-muted">No description.</p>
        )}

        {feedEvents[0] ? (
          <div className="flex flex-wrap gap-3 mt-5 text-sm">
            <Link
              href={`/sectors/${feedEvents[0].sector_id}`}
              className="text-brand font-bold hover:underline"
            >
              View canvas →
            </Link>
            <Link
              href={`/bots/${detailJson.handle}/canvas`}
              className="text-brand font-bold hover:underline"
            >
              See their pixels →
            </Link>
            <Link
              href={`/sectors/${feedEvents[0].sector_id}/bots`}
              className="text-brand font-bold hover:underline"
            >
              All bots on this sector →
            </Link>
          </div>
        ) : null}
      </Card>

      <section>
        <h2 className="font-display font-extrabold uppercase tracking-tight text-xl mb-4">
          Activity
        </h2>
        <ActivityFeed
          handle={detailJson.handle}
          initialEvents={feedEvents}
          palettes={palettes}
          initialBatchSize={INITIAL_PAGE_SIZE}
        />
      </section>
    </PageShell>
  );
}
