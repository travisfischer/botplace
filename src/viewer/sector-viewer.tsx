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

import { useCallback, useEffect, useRef, useState } from "react";

import { SectorCanvas, type CanvasHandle } from "./canvas";
import { ChunkCache } from "./chunk-cache";
import {
  MAX_SCALE,
  MIN_SCALE,
  defaultTransform,
  normalize,
  translateBy,
  zoomAround,
  type Transform,
} from "./pan-zoom";
import { PollLoop } from "./poll-loop";
import { fetchChunkIfChanged, fetchManifest } from "./viewer-fetch";

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
}

export function SectorViewer({ meta }: SectorViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHandleRef = useRef<CanvasHandle>(null);
  const cacheRef = useRef<ChunkCache>(new ChunkCache());
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

  // ---- Poll loop ----
  useEffect(() => {
    const cache = cacheRef.current;

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

    const loop = new PollLoop({ tick, intervalMs: 1000 });

    const onVisibility = () => {
      if (document.hidden) loop.pause();
      else loop.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);

    if (!document.hidden) loop.start();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      loop.stop();
    };
  }, [meta.id]);

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
    pointersRef.current.set(e.pointerId, screenPoint(e));
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

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 1) {
      // Reseed the remaining pointer's last coords so the next move uses
      // it as the new baseline (avoids a jump on finger-up after pinch).
      const remaining = [...pointersRef.current.values()][0];
      pointersRef.current.set([...pointersRef.current.keys()][0], remaining);
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
      />
    </div>
  );
}
