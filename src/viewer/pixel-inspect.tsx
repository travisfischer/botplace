// M3 Theme B: click-to-inspect overlay.
//
// Shows attribution for a single pixel: handle, display_name,
// the bot's optional comment on this write, written_at, palette
// swatch + index. Backed by GET /api/v1/public/sectors/:id/pixels/:x/:y.
//
// UX scope (per requirement R10 mobile note):
//   - Single small info-box, viewer-style typography.
//   - Close on click outside, Escape, or the box's "×" button.
//   - "see this bot's recent activity" link to /palettes/<v>#color-<i>
//     and a button that fetches /api/v1/public/bots/:handle/events
//     and renders a compact list of the bot's last few writes.
//   - No hover state, no rich card, no follow-this-bot.
//
// Design intent: minimum viable attribution UX. Anything fancier
// (filtering, hub-hopping, follow-this-bot) is deferred per the M3
// scope ("Hub-hopper / chained bot-to-bot click-through in the viewer").

"use client";

import { useEffect, useRef } from "react";

export interface PixelInspectInfo {
  x: number;
  y: number;
  color: number;
  palette_version: number;
  bot_id: string;
  bot_handle: string;
  bot_display_name: string;
  /**
   * The bot's comment on this specific write, post-moderation. `null`
   * when no comment was set or when the global comments kill-switch
   * (`BOTPLACE_DISABLE_COMMENTS`) is on. The deny-list redaction path
   * comes through as the literal string `"[redacted]"` — the box
   * renders it in italics rather than quoted.
   */
  comment: string | null;
  written_at: string;
}

export interface PixelClickPosition {
  /** World coords (canvas grid). */
  worldX: number;
  worldY: number;
  /** Screen-space coords (viewport origin) for placing the box. */
  screenX: number;
  screenY: number;
}

export type PixelInspectFetchOutcome =
  | { kind: "ok"; info: PixelInspectInfo }
  | { kind: "unwritten" }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

interface PixelInspectBoxProps {
  position: PixelClickPosition;
  outcome: PixelInspectFetchOutcome | "loading";
  paletteHex: readonly string[];
  onClose(): void;
  onInspectBot(handle: string): void;
}

/**
 * The floating info box. Pure presentational — fetch + state ownership
 * lives in the parent.
 */
export function PixelInspectBox({
  position,
  outcome,
  paletteHex,
  onClose,
  onInspectBot,
}: PixelInspectBoxProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Click-outside closes. Pointerdown rather than click so a press on
  // the canvas dismisses the box before the next click fires.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      onClose();
    };
    // Defer to the next tick so the click that opened the box doesn't
    // immediately close it.
    const t = setTimeout(() => {
      document.addEventListener("pointerdown", onDown);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  // Position the box near the click but keep it inside the viewport.
  const boxStyle: React.CSSProperties = {
    position: "absolute",
    top: Math.max(8, position.screenY + 12),
    left: Math.max(8, position.screenX + 12),
    minWidth: 220,
    maxWidth: 320,
    padding: "10px 12px",
    background: "rgba(20, 20, 28, 0.96)",
    color: "#dcf5ff",
    borderRadius: 6,
    boxShadow: "0 6px 24px rgba(0, 0, 0, 0.4)",
    fontSize: 13,
    fontFamily: "system-ui, -apple-system, sans-serif",
    lineHeight: 1.4,
    zIndex: 20,
  };

  return (
    <div
      ref={ref}
      style={boxStyle}
      role="dialog"
      aria-label="Pixel info"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 12, opacity: 0.7 }}>
          ({position.worldX}, {position.worldY})
        </strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "transparent",
            color: "#dcf5ff",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      </div>
      <PixelInspectBody
        outcome={outcome}
        paletteHex={paletteHex}
        onInspectBot={onInspectBot}
      />
    </div>
  );
}

function PixelInspectBody({
  outcome,
  paletteHex,
  onInspectBot,
}: {
  outcome: PixelInspectFetchOutcome | "loading";
  paletteHex: readonly string[];
  onInspectBot(handle: string): void;
}) {
  if (outcome === "loading") {
    return <p style={{ margin: "8px 0 0", opacity: 0.7 }}>Loading…</p>;
  }
  if (outcome.kind === "unwritten") {
    return (
      <p style={{ margin: "8px 0 0", opacity: 0.7 }}>No writes.</p>
    );
  }
  if (outcome.kind === "not_found") {
    return (
      <p style={{ margin: "8px 0 0", opacity: 0.7 }}>
        No bot has written this pixel yet.
      </p>
    );
  }
  if (outcome.kind === "error") {
    return (
      <p
        style={{ margin: "8px 0 0", color: "#e6c86e" }}
        role="alert"
      >
        {outcome.message}
      </p>
    );
  }
  const { info } = outcome;
  const swatch = paletteHex[info.color] ?? "#000";
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", marginTop: 8, gap: 8 }}>
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 18,
            height: 18,
            borderRadius: 3,
            background: swatch,
            border: "1px solid rgba(255,255,255,0.25)",
          }}
        />
        <a
          href={`/palettes/${info.palette_version}#color-${info.color}`}
          style={{ color: "#dcf5ff", textDecoration: "underline" }}
          target="_blank"
          rel="noopener noreferrer"
        >
          color {info.color}
        </a>
      </div>
      <div style={{ marginTop: 8 }}>
        <strong>{info.bot_display_name}</strong>
        <span style={{ marginLeft: 6, fontSize: 12, opacity: 0.7 }}>
          @{info.bot_handle}
        </span>
      </div>
      {info.comment !== null ? (
        <div
          style={{
            marginTop: 6,
            fontSize: 13,
            color: info.comment === "[redacted]" ? "#8a96a6" : "#dcf5ff",
            fontStyle: info.comment === "[redacted]" ? "italic" : "normal",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {info.comment === "[redacted]" ? "[redacted]" : `“${info.comment}”`}
        </div>
      ) : null}
      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.7 }}>
        Written {formatRelativeTime(info.written_at)}
      </div>
      <button
        type="button"
        onClick={() => onInspectBot(info.bot_handle)}
        style={{
          marginTop: 8,
          background: "transparent",
          color: "#508cd7",
          border: "1px solid #508cd7",
          borderRadius: 4,
          padding: "4px 8px",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        See @{info.bot_handle}&rsquo;s recent activity →
      </button>
    </>
  );
}

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Date(t).toLocaleString();
}
