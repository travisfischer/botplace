"use client";

// Activity feed for the bot profile page. Receives an SSR'd first
// batch via props; "Load more" pulls older events using
// `?before=<oldest-accepted-at>` against the public events API.
//
// Stops fetching when a response comes back with fewer rows than the
// batch size (signal that we've walked off the end of history).

import Link from "next/link";
import { useState } from "react";

import { formatRelative } from "@/lib/format-relative";

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
  const [events, setEvents] = useState<readonly FeedEvent[]>(props.initialEvents);
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
      <p style={{ fontSize: 14, color: "#999", margin: 0 }}>
        No pixel writes yet.
      </p>
    );
  }

  return (
    <>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        {events.map((e, idx) => (
          <EventRow
            key={`${e.accepted_at}-${e.x}-${e.y}-${idx}`}
            event={e}
            palette={palettes[e.palette_version]}
          />
        ))}
      </ul>

      <div style={{ marginTop: "1rem", textAlign: "center" }}>
        {hasMore ? (
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            style={{
              padding: "0.5rem 1rem",
              fontSize: 14,
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        ) : (
          <p style={{ fontSize: 12, color: "#999", margin: 0 }}>
            End of history.
          </p>
        )}
        {error ? (
          <p style={{ fontSize: 12, color: "crimson", marginTop: "0.5rem" }}>
            {error}
          </p>
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
  const hex = palette?.[e.color] ?? "#cccccc";
  const isRedacted = e.comment === "[redacted]";

  return (
    <li
      style={{
        display: "flex",
        gap: "0.5rem",
        alignItems: "flex-start",
        fontSize: 14,
        lineHeight: 1.4,
      }}
    >
      <span
        title={`color ${e.color} (palette v${e.palette_version})`}
        style={{
          display: "inline-block",
          width: 14,
          height: 14,
          marginTop: 3,
          backgroundColor: hex,
          border: "1px solid #999",
          flexShrink: 0,
        }}
        aria-hidden
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div>
          <code style={{ fontSize: 13 }}>
            ({e.x}, {e.y})
          </code>{" "}
          in{" "}
          <Link
            href={`/sectors/${e.sector_id}`}
            style={{ fontSize: 13 }}
          >
            {e.sector_id}
          </Link>
        </div>
        {e.comment !== null ? (
          <div
            style={{
              marginTop: 2,
              color: isRedacted ? "#999" : "#222",
              fontStyle: isRedacted ? "italic" : "normal",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {isRedacted ? "[redacted]" : `"${e.comment}"`}
          </div>
        ) : null}
        <div
          title={e.accepted_at}
          style={{ marginTop: 2, fontSize: 12, color: "#888" }}
        >
          {formatRelative(e.accepted_at)}
        </div>
      </div>
    </li>
  );
}

