// Pan + zoom math. Pure — no DOM, no React, no event handlers. The
// component layer wires these into pointer/touch events.
//
// Coordinate model:
// - "world" is the canvas pixel grid (sector_width × sector_height).
// - "screen" is the viewport in CSS pixels.
// - The transform maps world → screen: screen = (world * scale) + translate.
//
// Constants tuned to balance "see the whole canvas" (low scale) and
// "inspect a single pixel comfortably" (scale of 4-8 makes a pixel ~4-8px,
// which is readable but not tile-sized).

export interface Transform {
  /** Translate in screen pixels (CSS px). */
  tx: number;
  ty: number;
  /** Multiplier on world → screen. */
  scale: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface World {
  width: number;
  height: number;
}

export const MIN_SCALE = 0.1;
// Spec'd in M2 requirement V4: at 0.1 the whole sector fits in 100px;
// at 8 each pixel is 8 CSS px (readable at 1:1 on a phone screen).
export const MAX_SCALE = 8;

/**
 * Default transform: fit the world into the viewport with ~5% padding.
 * If the world is small enough to fit at higher zoom, prefer the higher
 * zoom (e.g. tiny test sectors) up to a sane ceiling — otherwise the
 * canvas fills the screen as much as possible.
 */
export function defaultTransform(world: World, viewport: Viewport): Transform {
  const padding = 0.95;
  const scaleX = (viewport.width * padding) / world.width;
  const scaleY = (viewport.height * padding) / world.height;
  const scale = clampScale(Math.min(scaleX, scaleY));

  const worldScreenW = world.width * scale;
  const worldScreenH = world.height * scale;
  const tx = (viewport.width - worldScreenW) / 2;
  const ty = (viewport.height - worldScreenH) / 2;

  return { tx, ty, scale };
}

export function clampScale(scale: number): number {
  if (scale < MIN_SCALE) return MIN_SCALE;
  if (scale > MAX_SCALE) return MAX_SCALE;
  return scale;
}

/**
 * Clamp the translation so the world never fully escapes the viewport.
 * Specifically: at least 25% of either axis stays on-screen, regardless of
 * scale. This prevents the user from accidentally panning the canvas off
 * into nowhere on a phone.
 */
export function clampTranslate(
  t: Transform,
  world: World,
  viewport: Viewport,
): Transform {
  const margin = 0.25;
  const worldScreenW = world.width * t.scale;
  const worldScreenH = world.height * t.scale;
  const minTx = viewport.width * margin - worldScreenW;
  const maxTx = viewport.width * (1 - margin);
  const minTy = viewport.height * margin - worldScreenH;
  const maxTy = viewport.height * (1 - margin);

  return {
    ...t,
    tx: Math.min(Math.max(t.tx, minTx), maxTx),
    ty: Math.min(Math.max(t.ty, minTy), maxTy),
  };
}

/**
 * Apply a zoom around an anchor in screen coordinates (e.g. the cursor or
 * the midpoint of a pinch). The world point under the anchor stays put.
 */
export function zoomAround(
  t: Transform,
  anchor: { x: number; y: number },
  scaleFactor: number,
): Transform {
  const newScale = clampScale(t.scale * scaleFactor);
  // World point under the anchor before zoom: (anchor - translate) / scale.
  // We want the same world point under the same anchor after zoom:
  //   anchor = world * newScale + newTranslate
  // => newTranslate = anchor - world * newScale
  const worldX = (anchor.x - t.tx) / t.scale;
  const worldY = (anchor.y - t.ty) / t.scale;
  return {
    tx: anchor.x - worldX * newScale,
    ty: anchor.y - worldY * newScale,
    scale: newScale,
  };
}

/**
 * Translate by a screen-pixel delta (typical pointer drag).
 */
export function translateBy(t: Transform, dx: number, dy: number): Transform {
  return { ...t, tx: t.tx + dx, ty: t.ty + dy };
}

/**
 * Apply both clamps in sequence. Used after every interactive update so
 * the user can't end up in a degenerate state.
 */
export function normalize(
  t: Transform,
  world: World,
  viewport: Viewport,
): Transform {
  return clampTranslate(
    { ...t, scale: clampScale(t.scale) },
    world,
    viewport,
  );
}

