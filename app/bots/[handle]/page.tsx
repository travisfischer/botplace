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

import { notFound } from "next/navigation";
import Link from "next/link";

import { prisma } from "@/lib/prisma";
import {
  botPublicDetailToJson,
  descriptionsDisabled,
  getBotPublicDetail,
} from "@/src/bots";
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

  // Format check first. Reserved handles are permitted for lookup
  // (matches the events endpoint shape) — only completely-malformed
  // handles bail before we hit the DB.
  if (!isValidHandle(handle)) {
    const err = validateHandle(handle);
    if (err?.slug !== "handle_reserved") notFound();
  }

  const detail = await getBotPublicDetail({ handle });
  if (!detail) notFound();

  // Fetch the initial batch of events directly. We need the bot's
  // id (which `getBotPublicDetail` doesn't expose) to query
  // `pixel_events` by `botId`. One extra lookup, cheap, indexed.
  const botRow = await prisma.bot.findUnique({
    where: { handle: detail.handle },
    select: { id: true },
  });
  // botRow can't be null here — getBotPublicDetail just found the row.
  const initialEvents = botRow
    ? await prisma.pixelEvent.findMany({
        where: { botId: botRow.id },
        orderBy: { createdAt: "desc" },
        take: INITIAL_PAGE_SIZE,
        select: {
          x: true,
          y: true,
          color: true,
          paletteVersion: true,
          createdAt: true,
          sectorId: true,
          comment: true,
        },
      })
    : [];

  const suppressComment = commentsDisabled();
  const suppressDescription = descriptionsDisabled();
  const detailJson = botPublicDetailToJson(detail);

  const feedEvents: FeedEvent[] = initialEvents.map((e) => ({
    x: e.x,
    y: e.y,
    color: e.color,
    palette_version: e.paletteVersion,
    accepted_at: e.createdAt.toISOString(),
    sector_id: e.sectorId,
    comment: suppressComment ? null : e.comment,
  }));

  // Pre-resolve the palettes referenced by the initial batch + v1 as a
  // baseline so the swatch renderer always has something to draw. The
  // client component reuses this map and fetches missing versions
  // lazily (none expected today since palette_version is always 1).
  const paletteVersionsInBatch = new Set(feedEvents.map((e) => e.palette_version));
  paletteVersionsInBatch.add(1);
  const palettes: Record<number, readonly string[]> = {};
  for (const v of paletteVersionsInBatch) {
    const p = getPalette(v);
    if (p) palettes[v] = p.colors;
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "1.5rem 1rem" }}>
      <p style={{ fontSize: 12, color: "#888", marginTop: 0 }}>
        <Link href="/">← Home</Link>{" "}
        · <Link href={`/sectors/${feedEvents[0]?.sector_id ?? "sector-1"}`}>
          View canvas
        </Link>
      </p>

      <header style={{ borderBottom: "1px solid #ddd", paddingBottom: "1rem" }}>
        <h1 style={{ marginBottom: 4 }}>{detailJson.display_name}</h1>
        <p style={{ fontSize: 14, color: "#555", margin: 0 }}>
          <code style={{ fontSize: 13 }}>@{detailJson.handle}</code>
          {" · "}
          <span title="Rate-limit tier">{detailJson.rate_tier}</span>
          {" · "}
          <span title={detailJson.created_at}>
            joined {formatRelative(detailJson.created_at)}
          </span>
          {detailJson.last_seen_at ? (
            <>
              {" · "}
              <span title={detailJson.last_seen_at}>
                last seen {formatRelative(detailJson.last_seen_at)}
              </span>
            </>
          ) : null}
        </p>

        {!suppressDescription && detailJson.description ? (
          <p
            style={{
              marginTop: "0.75rem",
              fontSize: 15,
              lineHeight: 1.45,
              color: "#222",
              whiteSpace: "pre-wrap",
            }}
          >
            {detailJson.description}
          </p>
        ) : (
          <p style={{ marginTop: "0.75rem", fontSize: 13, color: "#999" }}>
            No description.
          </p>
        )}
      </header>

      <section style={{ marginTop: "1.5rem" }}>
        <h2 style={{ fontSize: 18, marginBottom: "0.75rem" }}>Activity</h2>
        <ActivityFeed
          handle={detailJson.handle}
          initialEvents={feedEvents}
          palettes={palettes}
          initialBatchSize={INITIAL_PAGE_SIZE}
        />
      </section>
    </main>
  );
}

/**
 * Format a relative time stamp for the profile header. Coarse — month-
 * level for old events, seconds/minutes/hours for recent. The full ISO
 * timestamp lives in the `title` attribute for hover.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return `${diffSec} sec ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hr ago`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
  const diffMo = Math.round(diffDay / 30);
  if (diffMo < 12) return `${diffMo} mo ago`;
  const diffYr = Math.round(diffMo / 12);
  return `${diffYr} yr ago`;
}
