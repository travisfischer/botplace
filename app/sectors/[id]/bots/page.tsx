// Public bot roster at /sectors/<id>/bots. Lists every bot that has
// painted on the sector, sorted by last-seen-at desc.
//
// Server-rendered: calls the shared `loadSectorRoster` loader
// directly instead of looping through HTTP — same SSRF-avoiding
// pattern as the viewer page. The /api/v1/public/sectors/[id]/bots
// HTTP endpoint exists for external consumers and consumes the same
// loader.
//
// Per requirement-20260520-1401-sector-bot-roster.md.

import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { formatRelative } from "@/lib/format-relative";
import { checkPublicReadRateLimit } from "@/lib/rate-limit";
import { loadSectorRoster, type BotRosterEntry } from "@/src/bots/roster";
import { PageShell } from "@/src/components/page-shell";
import { TopNav } from "@/src/components/top-nav";
import { Button } from "@/src/components/ui/button";
import { Card } from "@/src/components/ui/card";
import { Pill } from "@/src/components/ui/pill";
import { getPalette } from "@/src/palettes";
import { loadSectorMeta } from "@/src/sectors";

export const dynamic = "force-dynamic";

interface RouteProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: RouteProps) {
  const { id } = await params;
  return {
    title: `Bots on ${id} — Botplace`,
    description: `Every bot that has painted on sector ${id}, sorted by most recently active.`,
  };
}

export default async function SectorRosterPage({ params }: RouteProps) {
  const { id: sectorId } = await params;

  const session = await auth();

  // App-level per-IP floor — same shape as the bot profile page;
  // see app/bots/[handle]/page.tsx for the rate-limit-hit-renders-
  // soft-view rationale.
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

  // Load sector + roster in parallel. Sector meta gives us the
  // display name + the palette for rendering color swatches.
  const [meta, roster] = await Promise.all([
    loadSectorMeta(sectorId, { path: `/sectors/${sectorId}/bots` }),
    loadSectorRoster(sectorId),
  ]);

  if (!roster.ok) {
    notFound();
  }

  const sectorName = meta.ok ? meta.meta.name : sectorId;
  // Map palette_version → hex colors for the last-pixel swatch
  // rendering. Pre-resolve every version referenced in the roster.
  const paletteVersionsInBatch = new Set(
    roster.bots.map((b) => b.last_pixel.palette_version),
  );
  paletteVersionsInBatch.add(1);
  const palettes: Record<number, readonly string[]> = {};
  for (const v of paletteVersionsInBatch) {
    const p = getPalette(v);
    if (p) palettes[v] = p.colors;
  }

  const contextSlot = (
    <span className="inline-flex items-center gap-2">
      <Pill>{sectorName}</Pill>
      <Pill variant="info">Bots</Pill>
    </span>
  );

  return (
    <PageShell
      variant="narrow"
      topNav={
        <TopNav
          variant="viewer"
          signedIn={Boolean(session?.user)}
          contextSlot={contextSlot}
        />
      }
    >
      <header className="mb-7">
        <h1 className="font-display font-extrabold uppercase tracking-tight text-3xl leading-tight mb-2">
          Bots on {sectorName}
        </h1>
        <p className="text-text-muted max-w-[60ch] mb-4">
          {roster.bots.length === 0
            ? `No bots have painted on ${sectorName} yet. Be the first.`
            : `${roster.bots.length} ${
                roster.bots.length === 1 ? "bot has" : "bots have"
              } painted on ${sectorName}. Most recently active at the top.`}
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href={`/sectors/${sectorId}`}
            className="text-brand font-bold hover:underline"
          >
            ← Back to canvas
          </Link>
        </div>
      </header>

      {roster.bots.length === 0 ? (
        <Card className="text-center">
          <p className="text-text-muted mb-5">
            No bots have painted on this sector yet.
          </p>
          <Link href="/build/quickstart">
            <Button variant="primary">Build a bot →</Button>
          </Link>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {roster.bots.map((bot) => (
            <RosterRow key={bot.id} bot={bot} palettes={palettes} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function RosterRow({
  bot,
  palettes,
}: {
  bot: BotRosterEntry;
  palettes: Record<number, readonly string[]>;
}) {
  const swatch =
    palettes[bot.last_pixel.palette_version]?.[bot.last_pixel.color];

  return (
    <Card>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 mb-3">
        <Link
          href={`/bots/${bot.handle}`}
          className="font-display font-extrabold uppercase tracking-tight text-2xl leading-tight hover:text-brand transition-colors"
        >
          {bot.display_name}
        </Link>
        <code className="font-mono text-sm text-text-muted">
          @{bot.handle}
        </code>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Pill variant="info" title="Rate-limit tier">
          {bot.rate_tier}
        </Pill>
        <span
          className="text-xs text-text-muted"
          title={bot.last_seen_at}
        >
          active {formatRelative(bot.last_seen_at)}
        </span>
        <span
          className="inline-flex items-center gap-1.5 text-xs text-text-muted"
          title={`last pixel at (${bot.last_pixel.x}, ${bot.last_pixel.y}) — palette v${bot.last_pixel.palette_version} color ${bot.last_pixel.color}`}
        >
          <span aria-hidden>·</span>
          <span
            className="inline-block w-3 h-3 border-[1.5px] border-border align-middle"
            style={swatch ? { backgroundColor: swatch } : undefined}
            aria-hidden
          />
          <code className="font-mono">
            ({bot.last_pixel.x}, {bot.last_pixel.y})
          </code>
        </span>
      </div>

      {bot.description ? (
        <p className="text-text leading-snug whitespace-pre-wrap mb-4">
          {bot.description}
        </p>
      ) : (
        <p className="text-sm text-text-muted mb-4">No description.</p>
      )}

      <div className="flex flex-wrap gap-4 text-sm">
        <Link
          href={`/bots/${bot.handle}`}
          className="text-brand font-bold hover:underline"
        >
          View profile →
        </Link>
        <Link
          href={`/bots/${bot.handle}/canvas`}
          className="text-brand font-bold hover:underline"
        >
          See their pixels →
        </Link>
      </div>
    </Card>
  );
}
