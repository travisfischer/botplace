"use client";

// Activity feed for the bot profile page. Receives an SSR'd first
// batch via props; "Load more" pulls older events using
// `?before=<oldest-accepted-at>` against the public events API.
//
// Stops fetching when a response comes back with fewer rows than the
// batch size (signal that we've walked off the end of history).
//
// Per requirement-20260520-0914 F11: token-driven row styling; the
// per-event color swatch reads against --border instead of a literal
// grey.

import Link from "next/link";
import { useState } from "react";

import { formatRelative } from "@/lib/format-relative";
import { Button } from "@/src/components/ui/button";

export interface FeedEvent {
  x: number;
  y: number;
  color: number;
  palette_version: number;
  accepted_at: string;
  sector_id: string;
  comment: string | null;
}

interface FeedProps {
  handle: string;
  initialEvents: readonly FeedEvent[];
  /** palette_version → hex colors (indexed by color number). */
  palettes: Record<number, readonly string[]>;
  initialBatchSize: number;
}

export function ActivityFeed(props: FeedProps) {
  const [events, setEvents] = useState<readonly FeedEvent[]>(
    props.initialEvents,
  );
  const [palettes, setPalettes] = useState<Record<number, readonly string[]>>(
    props.palettes,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `hasMore` starts true unless the initial batch was already short
  // (meaning the bot's whole history fits in one page).
  const [hasMore, setHasMore] = useState(
    props.initialEvents.length >= props.initialBatchSize,
  );

  async function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const oldest = events[events.length - 1];
      if (!oldest) {
        setHasMore(false);
        return;
      }
      const url = `/api/v1/public/bots/${encodeURIComponent(
        props.handle,
      )}/events?before=${encodeURIComponent(oldest.accepted_at)}&limit=${
        props.initialBatchSize
      }`;
      const res = await fetch(url);
      if (!res.ok) {
        setError(`Failed to load more (HTTP ${res.status})`);
        return;
      }
      const batch = (await res.json()) as FeedEvent[];
      setEvents((prev) => [...prev, ...batch]);
      if (batch.length < props.initialBatchSize) setHasMore(false);
      // No palette_version in production hits anything but 1 today, but
      // if a future deploy ships a new palette mid-history this picks
      // it up. Each fetch is independently try/caught — a single failed
      // palette must not break the whole batch, since one bad palette
      // would just fall back to the default swatch color via the
      // `palette?.[color] ?? "#cccccc"` in `EventRow`.
      const missing = new Set(
        batch
          .map((e) => e.palette_version)
          .filter((v) => !(v in palettes)),
      );
      if (missing.size > 0) {
        const fetched: Record<number, readonly string[]> = {};
        await Promise.all(
          Array.from(missing).map(async (v) => {
            try {
              const paletteRes = await fetch(`/api/v1/public/palettes/${v}`);
              if (!paletteRes.ok) return;
              const data = (await paletteRes.json()) as {
                colors: Array<{ hex: string }>;
              };
              fetched[v] = data.colors.map((c) => c.hex);
            } catch {
              // Swallow — fallback color renders.
            }
          }),
        );
        if (Object.keys(fetched).length > 0) {
          setPalettes((prev) => ({ ...prev, ...fetched }));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoading(false);
    }
  }

  if (events.length === 0) {
    return (
      <p className="text-sm text-text-muted m-0">No pixel writes yet.</p>
    );
  }

  return (
    <>
      <ul className="list-none p-0 m-0 flex flex-col gap-3">
        {events.map((e, idx) => (
          <EventRow
            key={`${e.accepted_at}-${e.x}-${e.y}-${idx}`}
            event={e}
            palette={palettes[e.palette_version]}
          />
        ))}
      </ul>

      <div className="mt-5 text-center">
        {hasMore ? (
          <Button
            type="button"
            variant="neutral"
            size="sm"
            onClick={loadMore}
            disabled={loading}
          >
            {loading ? "Loading…" : "Load more"}
          </Button>
        ) : (
          <p className="text-xs text-text-muted m-0">End of history.</p>
        )}
        {error ? (
          <p className="text-xs text-accent mt-2 font-bold">{error}</p>
        ) : null}
      </div>
    </>
  );
}

function EventRow(props: {
  event: FeedEvent;
  palette: readonly string[] | undefined;
}) {
  const { event: e, palette } = props;
  // Per-pixel color is canvas content (palette data), not chrome — the
  // hex here paints the swatch from the bot's actual pixel write, so it
  // bypasses the token system the way the canvas renderer does.
  const hex = palette?.[e.color];
  const isRedacted = e.comment === "[redacted]";

  return (
    <li className="flex gap-2.5 items-start text-sm leading-snug">
      <span
        title={`color ${e.color} (palette v${e.palette_version})`}
        className="inline-block w-3.5 h-3.5 mt-1 border-[1.5px] border-border shrink-0"
        style={hex ? { backgroundColor: hex } : undefined}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div>
          <code className="font-mono text-sm">
            ({e.x}, {e.y})
          </code>{" "}
          <span className="text-text-muted">in</span>{" "}
          <Link
            href={`/sectors/${e.sector_id}`}
            className="text-brand font-bold hover:underline text-sm"
          >
            {e.sector_id}
          </Link>
        </div>
        {e.comment !== null ? (
          <div
            className={
              isRedacted
                ? "mt-0.5 text-text-muted italic whitespace-pre-wrap break-words"
                : "mt-0.5 text-text whitespace-pre-wrap break-words"
            }
          >
            {isRedacted ? "[redacted]" : `“${e.comment}”`}
          </div>
        ) : null}
        <div
          title={e.accepted_at}
          className="mt-0.5 text-xs text-text-muted"
        >
          {formatRelative(e.accepted_at)}
        </div>
      </div>
    </li>
  );
}
