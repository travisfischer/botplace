// Top-level viewer component. Wires together:
// - ChunkCache (per-tab in-memory)
// - PollLoop (1s manifest poll)
// - viewer-fetch (manifest + chunk GETs with If-None-Match)
// - SectorCanvas (Canvas-2D paint surface)
// - Pan/zoom event handling (mouse + touch + wheel + keyboard)
//
// Mobile-first: pointer events unify mouse/touch/pen, two-pointer pinch
// is handled in-component, `touch-action: none` on the wrapper kills the
// browser's default pan/zoom behavior so the canvas owns the gesture.

"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { SectorCanvas, type CanvasHandle } from "./canvas";
import { ChunkCache, compareVersion } from "./chunk-cache";
import { createHeartbeat } from "./heartbeat";
import {
  MAX_SCALE,
  MIN_SCALE,
  defaultTransform,
  normalize,
  screenToWorld,
  translateBy,
  zoomAround,
  type Transform,
} from "./pan-zoom";
import {
  PixelInspectBox,
  type PixelClickPosition,
  type PixelInspectFetchOutcome,
} from "./pixel-inspect";
import { PollLoop, type PollLoopStatus } from "./poll-loop";
import { fetchChunkIfChanged, fetchManifest, fetchSnapshot } from "./viewer-fetch";

export interface SectorMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  palette_version: number;
  palette: string[];
  default_color: number;
  chunk_size: number;
  chunks_x: number;
  chunks_y: number;
}

interface SectorViewerProps {
  meta: SectorMeta;
  /**
   * Static-mode override. When set, the viewer:
   *   - fetches the snapshot from this URL instead of the unfiltered
   *     `/api/v1/public/sectors/<id>/snapshot`
   *   - skips the manifest poll loop and the heartbeat (no live updates,
   *     no viewer-count contribution)
   *   - disables click-to-inspect (the filtered view hides other bots'
   *     pixels visually, so surfacing their attribution on click would
   *     contradict the view)
   * Pan, zoom, and the debug grid remain enabled.
   *
   * Used by the bot-filtered canvas at /bots/<handle>/canvas.
   */
  staticSnapshotUrl?: string;
}

export function SectorViewer({ meta, staticSnapshotUrl }: SectorViewerProps) {
  const staticMode = staticSnapshotUrl !== undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHandleRef = useRef<CanvasHandle>(null);
  const cacheRef = useRef<ChunkCache>(new ChunkCache());
  // Opt-in debug visuals via `?debug` (or `?debug=grid`). Renders an
  // outline around the world bounds + per-chunk grid lines so it's
  // obvious where the canvas lives at any zoom level. Off by default
  // so production looks clean.
  const searchParams = useSearchParams();
  const debugGrid = searchParams?.has("debug") ?? false;
  const [transform, setTransform] = useState<Transform>({
    tx: 0,
    ty: 0,
    scale: 1,
  });
  const transformRef = useRef(transform);
  // Keep the ref in sync without violating react-hooks/refs (no writes
  // during render). Event handlers always read .current, so they get the
  // latest value via this effect.
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);
  const [healthy, setHealthy] = useState(true);

  // M3 click-to-inspect state. Single info-box at a time; opening
  // another click replaces the previous one.
  const [inspect, setInspect] = useState<{
    position: PixelClickPosition;
    outcome: PixelInspectFetchOutcome | "loading";
  } | null>(null);
  const inspectAbortRef = useRef<AbortController | null>(null);
  // Track pointer-down position so onPointerUp can decide whether the
  // gesture was a click vs. a drag.
  const pointerDownRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    startedAt: number;
    // True when the inspect box was already open at gesture start.
    // A click in this state should dismiss the box, not open a new one.
    // (Inspect-box stopPropagation means onPointerDown only fires for
    // clicks OUTSIDE the box, so this flag really does mean "dismiss".)
    dismissOnly: boolean;
  } | null>(null);
  // CSS-pixel threshold below which a pointer up counts as a click.
  // Existing pan code already operates in CSS px; 5px is roughly the
  // conservative drag threshold the platform's own click event uses.
  const CLICK_DRAG_THRESHOLD_PX = 5;
  const CLICK_MAX_DURATION_MS = 500;
  // Defer single-click inspect by ~one dblclick window so a fast
  // double-click (which zooms) doesn't briefly flash the inspect box
  // before the zoom happens. Cancelled if dblclick fires within window.
  const CLICK_INSPECT_DEFER_MS = 250;
  const pendingInspectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hover highlight: only show when each world pixel is at least this
  // many screen px (otherwise a 1×1 highlight looks like noise).
  const HOVER_HIGHLIGHT_MIN_SCALE = 4;
  const [hoverPx, setHoverPx] = useState<{ wx: number; wy: number } | null>(
    null,
  );

  // ---- Initial fit + window resize ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const fit = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setTransform(
        defaultTransform(meta, { width: rect.width, height: rect.height }),
      );
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => ro.disconnect();
  }, [meta]);

  // ---- Snapshot preload + poll loop ----
  useEffect(() => {
    const cache = cacheRef.current;
    const preloadAborter = new AbortController();
    let cancelled = false;

    // On (re)mount, repaint any chunks already in the cache. The cache is
    // held in a useRef and survives StrictMode's mount→cleanup→remount
    // cycle (and HMR), but the canvas's bitmap is freshly initialized on
    // every remount. Without this step, the cache's "I already have
    // version N for this chunk" check causes the next poll to short-
    // circuit and the canvas stays at the default fill color forever.
    for (const [cx, cy, cached] of cache.entries()) {
      canvasHandleRef.current?.repaintChunk(cx, cy, cached.bytes);
    }

    const tick = async (signal: AbortSignal) => {
      const manifest = await fetchManifest(meta.id, signal);
      if (signal.aborted) return;
      const stale = cache.diff(manifest);
      for (const entry of stale) {
        if (signal.aborted) return;
        const result = await fetchChunkIfChanged(meta.id, entry, cache, signal);
        if (signal.aborted) return;
        if (result.outcome === "updated") {
          const cached = cache.get(entry.chunk_x, entry.chunk_y);
          if (cached) {
            canvasHandleRef.current?.repaintChunk(
              entry.chunk_x,
              entry.chunk_y,
              cached.bytes,
            );
          }
        }
      }
    };

    const loop = new PollLoop({
      tick,
      intervalMs: 1000,
      onStatusChange: (status: PollLoopStatus) => setHealthy(status.healthy),
    });

    // Periodic "I'm watching" beacon. Replaces the M2.5 edge-middleware
    // viewer-tracking — the middleware fired 2 Upstash commands on every
    // public-API request (incl. scrapers/crawlers/uptime pings), which
    // burned through the Upstash monthly quota in days. The beacon caps
    // the cost at 2 cmds/min per real viewer.
    //
    // Static mode: skip the heartbeat. A filtered-canvas viewer isn't
    // "watching the canvas" in the live sense, and shouldn't inflate
    // the viewer count for the underlying sector.
    const heartbeat = staticMode ? null : createHeartbeat(meta.id);
    if (heartbeat && !document.hidden) heartbeat.start();

    const onVisibility = () => {
      if (document.hidden) {
        if (!staticMode) loop.pause();
        heartbeat?.stop();
      } else {
        if (!staticMode) loop.resume();
        heartbeat?.start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Snapshot preload: one fetch paints the whole canvas before the
    // per-chunk polling loop takes over. On failure (network, format
    // mismatch, abort) we fall through silently — the poll loop will
    // hydrate the cache the old way (manifest + per-chunk fetches), so
    // a broken snapshot only costs us the speedup, not correctness.
    //
    // Static mode (filtered viewer): uses the override URL and is the
    // ONLY paint path — the poll loop is gated off below.
    const preload = async () => {
      try {
        const snap = await fetchSnapshot(meta.id, preloadAborter.signal, {
          url: staticSnapshotUrl,
        });
        if (cancelled) return;
        if (snap.chunk_size !== meta.chunk_size) {
          console.warn(
            `snapshot chunk_size ${snap.chunk_size} != meta.chunk_size ${meta.chunk_size}; skipping preload`,
          );
          return;
        }
        for (const c of snap.chunks) {
          // Only seed if the cache doesn't already have a newer version
          // — a long-lived tab may have polled past this snapshot.
          const have = cache.version(c.chunk_x, c.chunk_y);
          if (have !== undefined && compareVersion(have, c.version) >= 0) continue;
          cache.set(c.chunk_x, c.chunk_y, c.version, c.bytes);
          canvasHandleRef.current?.repaintChunk(c.chunk_x, c.chunk_y, c.bytes);
        }
      } catch (err) {
        if (preloadAborter.signal.aborted) return;
        console.warn("snapshot preload failed", err);
      }
    };

    void preload().then(() => {
      if (cancelled) return;
      if (!staticMode && !document.hidden) loop.start();
    });

    return () => {
      cancelled = true;
      preloadAborter.abort();
      document.removeEventListener("visibilitychange", onVisibility);
      loop.stop();
      heartbeat?.stop();
    };
  }, [meta.id, meta.chunk_size, staticMode, staticSnapshotUrl]);

  // ---- Pan / zoom ----
  // Pointer state: id → screen coords. Multi-touch is two entries.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  // Pinch baseline distance + midpoint, captured when count transitions to 2.
  const pinchRef = useRef<{
    distance: number;
    midpoint: { x: number; y: number };
  } | null>(null);
  // Last known viewport rect for screen-coord math.
  const containerRectRef = useRef<DOMRect | null>(null);

  const updateRect = useCallback(() => {
    const container = containerRef.current;
    if (container) containerRectRef.current = container.getBoundingClientRect();
  }, []);

  useEffect(() => {
    updateRect();
    const onResize = () => updateRect();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateRect]);

  useEffect(() => {
    return () => {
      if (pendingInspectRef.current !== null) {
        clearTimeout(pendingInspectRef.current);
        pendingInspectRef.current = null;
      }
    };
  }, []);

  const applyTransform = useCallback(
    (next: Transform) => {
      const rect = containerRectRef.current;
      const viewport = rect ? { width: rect.width, height: rect.height } : null;
      if (!viewport) {
        setTransform(next);
        return;
      }
      setTransform(normalize(next, meta, viewport));
    },
    [meta],
  );

  const screenPoint = (e: React.PointerEvent | PointerEvent) => {
    const rect = containerRectRef.current;
    if (!rect) return { x: e.clientX, y: e.clientY };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    updateRect();
    const sp = screenPoint(e);
    pointersRef.current.set(e.pointerId, sp);
    // Record the down for the click-vs-drag decision in onPointerUp.
    // Only the first finger counts — multi-finger gestures are pinch.
    if (pointersRef.current.size === 1) {
      pointerDownRef.current = {
        id: e.pointerId,
        startX: sp.x,
        startY: sp.y,
        startedAt: Date.now(),
        dismissOnly: inspect !== null,
      };
    } else {
      pointerDownRef.current = null;
    }
    if (pointersRef.current.size === 2) {
      const pts = [...pointersRef.current.values()];
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinchRef.current = {
        distance: Math.hypot(dx, dy),
        midpoint: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointersRef.current.get(e.pointerId);
    // Hover highlight: track the world pixel under the cursor whenever
    // no pointer is captured (i.e. the user is hovering, not dragging).
    if (pointersRef.current.size === 0) {
      const sp = screenPoint(e);
      const world = screenToWorld(transformRef.current, sp, meta);
      setHoverPx(world ? { wx: world.x, wy: world.y } : null);
    }
    if (!prev) return;
    const next = screenPoint(e);
    pointersRef.current.set(e.pointerId, next);

    const count = pointersRef.current.size;
    if (count === 1) {
      // Single-pointer pan.
      applyTransform(translateBy(transformRef.current, next.x - prev.x, next.y - prev.y));
    } else if (count === 2 && pinchRef.current) {
      const pts = [...pointersRef.current.values()];
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      // Pan delta: midpoint movement.
      const panned = translateBy(
        transformRef.current,
        mid.x - pinchRef.current.midpoint.x,
        mid.y - pinchRef.current.midpoint.y,
      );
      // Zoom by ratio of new/old distance, anchored on midpoint.
      const zoomed = zoomAround(panned, mid, dist / pinchRef.current.distance);
      applyTransform(zoomed);
      pinchRef.current = { distance: dist, midpoint: mid };
    }
  };

  const inspectPixel = useCallback(
    async (worldX: number, worldY: number, screenX: number, screenY: number) => {
      // Cancel any in-flight inspect fetch — only one at a time.
      inspectAbortRef.current?.abort();
      const ac = new AbortController();
      inspectAbortRef.current = ac;
      const position: PixelClickPosition = {
        worldX,
        worldY,
        screenX,
        screenY,
      };
      setInspect({ position, outcome: "loading" });
      try {
        const res = await fetch(
          `/api/v1/public/sectors/${encodeURIComponent(meta.id)}/pixels/${worldX}/${worldY}`,
          { signal: ac.signal },
        );
        if (ac.signal.aborted) return;
        if (res.status === 404) {
          setInspect({ position, outcome: { kind: "not_found" } });
          return;
        }
        if (!res.ok) {
          setInspect({
            position,
            outcome: {
              kind: "error",
              message: `Couldn't load pixel info (${res.status}).`,
            },
          });
          return;
        }
        const body = (await res.json()) as {
          x: number;
          y: number;
          color: number;
          palette_version: number;
          bot_handle: string | null;
          bot_display_name: string | null;
          comment: string | null;
          written_at: string | null;
        };
        if (ac.signal.aborted) return;
        // The single-pixel endpoint returns 200 with null attribution
        // for in-bounds-but-unwritten coords. Discriminate on
        // `written_at` per the API contract; the other two move together.
        if (
          body.written_at === null ||
          body.bot_handle === null ||
          body.bot_display_name === null
        ) {
          setInspect({ position, outcome: { kind: "unwritten" } });
          return;
        }
        setInspect({
          position,
          outcome: {
            kind: "ok",
            info: {
              x: body.x,
              y: body.y,
              color: body.color,
              palette_version: body.palette_version,
              bot_handle: body.bot_handle,
              bot_display_name: body.bot_display_name,
              comment: body.comment,
              written_at: body.written_at,
            },
          },
        });
      } catch (err) {
        if (ac.signal.aborted) return;
        setInspect({
          position,
          outcome: {
            kind: "error",
            message: err instanceof Error ? err.message : "Network error",
          },
        });
      }
    },
    [meta.id],
  );

  const onPointerUp = (e: React.PointerEvent) => {
    const down = pointerDownRef.current;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 1) {
      // Reseed the remaining pointer's last coords so the next move uses
      // it as the new baseline (avoids a jump on finger-up after pinch).
      const remaining = [...pointersRef.current.values()][0];
      pointersRef.current.set([...pointersRef.current.keys()][0], remaining);
    }
    // Click-to-inspect: only fire if this was a single-pointer gesture
    // that didn't drift past the drag threshold and didn't take too long.
    if (
      down !== null &&
      down.id === e.pointerId &&
      pointersRef.current.size === 0
    ) {
      const now = screenPoint(e);
      const dx = now.x - down.startX;
      const dy = now.y - down.startY;
      const distance = Math.hypot(dx, dy);
      const elapsed = Date.now() - down.startedAt;
      pointerDownRef.current = null;
      if (
        !staticMode &&
        distance <= CLICK_DRAG_THRESHOLD_PX &&
        elapsed <= CLICK_MAX_DURATION_MS &&
        !down.dismissOnly
      ) {
        const world = screenToWorld(transformRef.current, now, meta);
        if (world) {
          if (pendingInspectRef.current !== null) {
            clearTimeout(pendingInspectRef.current);
          }
          const wx = world.x;
          const wy = world.y;
          const sx = now.x;
          const sy = now.y;
          pendingInspectRef.current = setTimeout(() => {
            pendingInspectRef.current = null;
            void inspectPixel(wx, wy, sx, sy);
          }, CLICK_INSPECT_DEFER_MS);
        }
      }
    } else {
      pointerDownRef.current = null;
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    // Trackpad pinch fires wheel events with ctrlKey set; treat both the
    // same (zoom anchored on cursor). Plain wheel-without-ctrl still zooms
    // — there is no scroll-the-page behavior for this canvas to inherit.
    e.preventDefault();
    updateRect();
    const factor = Math.exp(-e.deltaY * 0.002);
    const anchor = screenPoint(e as unknown as React.PointerEvent);
    applyTransform(zoomAround(transformRef.current, anchor, factor));
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (pendingInspectRef.current !== null) {
      clearTimeout(pendingInspectRef.current);
      pendingInspectRef.current = null;
    }
    updateRect();
    const anchor = screenPoint(e as unknown as React.PointerEvent);
    applyTransform(zoomAround(transformRef.current, anchor, 2));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 40;
    if (e.key === "ArrowLeft") applyTransform(translateBy(transformRef.current, step, 0));
    else if (e.key === "ArrowRight") applyTransform(translateBy(transformRef.current, -step, 0));
    else if (e.key === "ArrowUp") applyTransform(translateBy(transformRef.current, 0, step));
    else if (e.key === "ArrowDown") applyTransform(translateBy(transformRef.current, 0, -step));
    else if (e.key === "+" || e.key === "=") {
      const rect = containerRectRef.current;
      const center = rect
        ? { x: rect.width / 2, y: rect.height / 2 }
        : { x: 0, y: 0 };
      applyTransform(zoomAround(transformRef.current, center, 1.25));
    } else if (e.key === "-" || e.key === "_") {
      const rect = containerRectRef.current;
      const center = rect
        ? { x: rect.width / 2, y: rect.height / 2 }
        : { x: 0, y: 0 };
      applyTransform(zoomAround(transformRef.current, center, 0.8));
    } else if (e.key === "0") {
      const rect = containerRectRef.current;
      if (rect) {
        applyTransform(
          defaultTransform(meta, { width: rect.width, height: rect.height }),
        );
      }
    }
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHoverPx(null)}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        position: "relative",
        // Disable browser default touch behaviors (pan, zoom) so the
        // canvas owns the gestures end-to-end.
        touchAction: "none",
        // Prevent text selection on rapid double-tap-to-zoom.
        userSelect: "none",
        // Background = palette[default_color], so chunks-not-yet-loaded
        // blend with the painted areas (and "empty canvas" looks deliberate).
        background: meta.palette[meta.default_color] ?? "#000",
        outline: "none",
      }}
      data-min-scale={MIN_SCALE}
      data-max-scale={MAX_SCALE}
    >
      <SectorCanvas
        ref={canvasHandleRef}
        width={meta.width}
        height={meta.height}
        chunkSize={meta.chunk_size}
        paletteHex={meta.palette}
        defaultColor={meta.default_color}
        transform={transform}
        debugGrid={debugGrid}
      />
      {debugGrid && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: meta.width,
            height: meta.height,
            transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
            transformOrigin: "0 0",
            pointerEvents: "none",
            // Two repeating gradients = vertical + horizontal grid lines
            // every `chunk_size` world-pixels. Semi-transparent magenta
            // so painted pixels still read through.
            backgroundImage: `linear-gradient(to right, rgba(255,0,255,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,0,255,0.35) 1px, transparent 1px)`,
            backgroundSize: `${meta.chunk_size}px ${meta.chunk_size}px`,
            backgroundPosition: "0 0",
          }}
        />
      )}
      {hoverPx &&
        transform.scale >= HOVER_HIGHLIGHT_MIN_SCALE &&
        !inspect && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: hoverPx.wx * transform.scale + transform.tx,
              top: hoverPx.wy * transform.scale + transform.ty,
              width: transform.scale,
              height: transform.scale,
              pointerEvents: "none",
              boxSizing: "border-box",
              border: "1px solid rgba(255,255,255,0.55)",
              boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.45)",
              zIndex: 5,
            }}
          />
        )}
      {!healthy && (
        <div role="status" aria-live="polite" style={stalePillStyle}>
          Reconnecting…
        </div>
      )}
      {inspect && (
        <PixelInspectBox
          position={inspect.position}
          outcome={inspect.outcome}
          paletteHex={meta.palette}
          onClose={() => setInspect(null)}
          onInspectBot={(handle) => {
            // Open the bot's public profile in a new tab so the
            // canvas keeps streaming. Hub-hopping (in-canvas chained
            // navigation) is explicitly out of scope. The profile
            // page renders the bot's metadata + a reverse-chronological
            // activity feed with paginated history.
            window.open(
              `/bots/${encodeURIComponent(handle)}`,
              "_blank",
              "noopener,noreferrer",
            );
          }}
        />
      )}
    </div>
  );
}

const stalePillStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  left: "50%",
  transform: "translateX(-50%)",
  padding: "6px 14px",
  borderRadius: 999,
  background: "rgba(85, 65, 95, 0.92)",
  color: "#dcf5ff",
  fontSize: 12,
  fontFamily: "system-ui, -apple-system, sans-serif",
  pointerEvents: "none",
  zIndex: 10,
};
