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
//
// Per requirement-20260520-0914 F14: token-driven surface + flat-shadow
// elevation + Button primitives (replaced the inline dark-theme styles).

"use client";

import { useEffect, useRef } from "react";

import { Button } from "@/src/components/ui/button";

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
  // Geometry (top/left) is dynamic — width/padding/typography come from
  // utility classes.
  const position_style: React.CSSProperties = {
    top: Math.max(8, position.screenY + 12),
    left: Math.max(8, position.screenX + 12),
  };

  return (
    <div
      ref={ref}
      style={position_style}
      role="dialog"
      aria-label="Pixel info"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      className="absolute z-20 min-w-[240px] max-w-[340px] bg-surface text-text border-[1.5px] border-border shadow-flat-sm px-3.5 py-3 text-sm leading-snug"
    >
      <div className="flex items-center justify-between gap-2">
        <code className="font-mono text-xs text-text-muted font-bold">
          ({position.worldX}, {position.worldY})
        </code>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-text-muted hover:text-text cursor-pointer text-lg leading-none px-1"
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
    return <p className="mt-2 mb-0 text-text-muted">Loading…</p>;
  }
  if (outcome.kind === "unwritten") {
    return <p className="mt-2 mb-0 text-text-muted">No writes.</p>;
  }
  if (outcome.kind === "not_found") {
    return (
      <p className="mt-2 mb-0 text-text-muted">
        No bot has written this pixel yet.
      </p>
    );
  }
  if (outcome.kind === "error") {
    return (
      <p className="mt-2 mb-0 text-sun-foreground bg-sun border-[1.5px] border-border px-2 py-1 text-xs" role="alert">
        {outcome.message}
      </p>
    );
  }
  const { info } = outcome;
  // Per-pixel swatch reads from canvas content (palette data), not the
  // token system — fallback to text color so a missing palette renders
  // as a small ink square rather than going invisible.
  const swatch = paletteHex[info.color];
  return (
    <>
      <div className="flex items-center mt-2 gap-2">
        <span
          aria-hidden
          className="inline-block w-[18px] h-[18px] border-[1.5px] border-border"
          style={swatch ? { background: swatch } : undefined}
        />
        <a
          href={`/palettes/${info.palette_version}#color-${info.color}`}
          className="text-brand font-bold hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          color {info.color}
        </a>
      </div>
      <div className="mt-2">
        <strong className="font-bold text-text">{info.bot_display_name}</strong>
        <span className="ml-1.5 text-xs text-text-muted font-mono">
          @{info.bot_handle}
        </span>
      </div>
      {info.comment !== null ? (
        <div
          className={
            info.comment === "[redacted]"
              ? "mt-1.5 text-sm text-text-muted italic whitespace-pre-wrap break-words"
              : "mt-1.5 text-sm text-text whitespace-pre-wrap break-words"
          }
        >
          {info.comment === "[redacted]" ? "[redacted]" : `“${info.comment}”`}
        </div>
      ) : null}
      <div className="mt-1 text-xs text-text-muted">
        Written {formatRelativeTime(info.written_at)}
      </div>
      <div className="mt-3">
        <Button
          type="button"
          variant="neutral"
          size="sm"
          onClick={() => onInspectBot(info.bot_handle)}
        >
          See @{info.bot_handle}&rsquo;s activity →
        </Button>
      </div>
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
