// Canvas-2D paint surface. The component owns:
// - An offscreen ImageData buffer at world resolution (sector_width × sector_height).
// - A pre-computed Uint32 palette in RGBA-little-endian for fast pixel
//   writes via Uint32Array views into ImageData.data.
// - A `repaintChunk` ref that the parent invokes whenever chunk bytes
//   change in the cache. Imperative on purpose — we don't re-render React
//   for every per-chunk repaint.
//
// The CSS transform on the wrapper handles all pan/zoom; the canvas pixel
// buffer stays 1:1 with the world. `image-rendering: pixelated` keeps
// upscaling crisp.

"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

import type { Transform } from "./pan-zoom";

export interface CanvasHandle {
  /** Paint a single chunk at (cx, cy) using the supplied palette indices. */
  repaintChunk(cx: number, cy: number, bytes: Uint8Array): void;
  /** Direct access to the underlying canvas element (event binding). */
  el(): HTMLCanvasElement | null;
}

interface CanvasProps {
  width: number;
  height: number;
  chunkSize: number;
  paletteHex: readonly string[];
  defaultColor: number;
  transform: Transform;
}

function hexToRgbaU32(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  // Uint32Array view of ImageData.data (a Uint8ClampedArray) is
  // little-endian on every platform that runs a browser, so the
  // byte order is RGBA when written in increasing memory order;
  // expressed as a u32 word, the high byte is alpha.
  return (0xff << 24) | (b << 16) | (g << 8) | r;
}

export const SectorCanvas = forwardRef<CanvasHandle, CanvasProps>(
  function SectorCanvas(
    { width, height, chunkSize, paletteHex, defaultColor, transform },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageDataRef = useRef<ImageData | null>(null);
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

    const palette = useMemo(() => {
      const arr = new Uint32Array(paletteHex.length);
      for (let i = 0; i < paletteHex.length; i++) arr[i] = hexToRgbaU32(paletteHex[i]);
      return arr;
    }, [paletteHex]);

    // Initialize / resize. Fill with default_color.
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctxRef.current = ctx;
      const imageData = ctx.createImageData(width, height);
      imageDataRef.current = imageData;
      const u32 = new Uint32Array(imageData.data.buffer);
      u32.fill(palette[defaultColor] ?? palette[0]);
      ctx.putImageData(imageData, 0, 0);
    }, [width, height, defaultColor, palette]);

    const repaintChunk = useCallback(
      (cx: number, cy: number, bytes: Uint8Array) => {
        const ctx = ctxRef.current;
        const imageData = imageDataRef.current;
        if (!ctx || !imageData) return;
        const u32 = new Uint32Array(imageData.data.buffer);
        const baseX = cx * chunkSize;
        const baseY = cy * chunkSize;
        // Clamp the dirty rect against the world bounds in case the last
        // chunk row/col is partial (chunks_x ceil > width / chunk_size).
        const drawW = Math.min(chunkSize, width - baseX);
        const drawH = Math.min(chunkSize, height - baseY);
        if (drawW <= 0 || drawH <= 0) return;
        const fallback = palette[0];
        for (let y = 0; y < drawH; y++) {
          const dstBase = (baseY + y) * width + baseX;
          const srcBase = y * chunkSize;
          for (let x = 0; x < drawW; x++) {
            const idx = bytes[srcBase + x];
            u32[dstBase + x] = palette[idx] ?? fallback;
          }
        }
        ctx.putImageData(imageData, 0, 0, baseX, baseY, drawW, drawH);
      },
      [chunkSize, palette, width, height],
    );

    useImperativeHandle(
      ref,
      () => ({
        repaintChunk,
        el: () => canvasRef.current,
      }),
      [repaintChunk],
    );

    const cssTransform = `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`;

    return (
      <canvas
        ref={canvasRef}
        style={{
          transform: cssTransform,
          transformOrigin: "0 0",
          imageRendering: "pixelated",
          // Sub-pixel hinting off; we want sharp pixel boundaries.
          // @ts-expect-error -- vendor prefix not in the TS lib types.
          MozImageRendering: "crisp-edges",
        }}
        // The wrapper handles pointer events; the canvas itself doesn't
        // need to be interactive.
      />
    );
  },
);
