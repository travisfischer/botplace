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

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";

import { formatRelative } from "@/lib/format-relative";
import { checkPublicReadRateLimit } from "@/lib/rate-limit";
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
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "1.5rem 1rem" }}>
        <h1>Slow down</h1>
        <p style={{ color: "#555" }}>
          Too many requests from this IP. Please retry in a few seconds.
        </p>
      </main>
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
        <Link href="/">← Home</Link>
        {feedEvents[0] ? (
          <>
            {" "}
            ·{" "}
            <Link href={`/sectors/${feedEvents[0].sector_id}`}>
              View canvas
            </Link>
          </>
        ) : null}
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

