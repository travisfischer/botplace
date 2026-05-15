// Pure math test for pan-zoom. No DOM, no events.

import { describe, expect, it } from "vitest";

import {
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  defaultTransform,
  normalize,
  screenToWorld,
  translateBy,
  zoomAround,
} from "@/src/viewer/pan-zoom";

const WORLD = { width: 1000, height: 1000 };
const VIEWPORT = { width: 800, height: 600 };

describe("clampScale", () => {
  it("clamps to MIN/MAX", () => {
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(2)).toBe(2);
  });
});

describe("defaultTransform", () => {
  it("fits the world inside the viewport with padding, centered", () => {
    const t = defaultTransform(WORLD, VIEWPORT);
    // Smaller axis is height: 600 * 0.95 / 1000 = 0.57.
    expect(t.scale).toBeCloseTo(0.57, 2);
    // Centered in both axes after fitting.
    const wScreenW = WORLD.width * t.scale;
    const wScreenH = WORLD.height * t.scale;
    expect(t.tx).toBeCloseTo((VIEWPORT.width - wScreenW) / 2, 1);
    expect(t.ty).toBeCloseTo((VIEWPORT.height - wScreenH) / 2, 1);
  });

  it("respects MIN_SCALE for absurdly small viewports", () => {
    const t = defaultTransform(WORLD, { width: 10, height: 10 });
    expect(t.scale).toBe(MIN_SCALE);
  });
});

describe("zoomAround", () => {
  it("keeps the world point under the anchor invariant", () => {
    const t = { tx: 100, ty: 100, scale: 1 };
    const anchor = { x: 200, y: 150 };
    const worldBefore = {
      x: (anchor.x - t.tx) / t.scale,
      y: (anchor.y - t.ty) / t.scale,
    };
    const t2 = zoomAround(t, anchor, 2);
    const worldAfter = {
      x: (anchor.x - t2.tx) / t2.scale,
      y: (anchor.y - t2.ty) / t2.scale,
    };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 5);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 5);
    expect(t2.scale).toBe(2);
  });

  it("clamps the resulting scale", () => {
    const t = { tx: 0, ty: 0, scale: 8 };
    const t2 = zoomAround(t, { x: 0, y: 0 }, 100);
    expect(t2.scale).toBe(MAX_SCALE);
  });
});

describe("translateBy", () => {
  it("adds the deltas to the existing translate", () => {
    const t = { tx: 10, ty: 20, scale: 1 };
    const t2 = translateBy(t, 5, -3);
    expect(t2.tx).toBe(15);
    expect(t2.ty).toBe(17);
  });
});

describe("normalize", () => {
  it("clamps so at least 25% of an axis stays on-screen", () => {
    // Push the world way off-screen to the left.
    const t = { tx: -10000, ty: -10000, scale: 1 };
    const n = normalize(t, WORLD, VIEWPORT);
    // After clamp, the right edge of the world should be at >= 25% of viewport.width.
    const worldRightOnScreen = n.tx + WORLD.width * n.scale;
    expect(worldRightOnScreen).toBeGreaterThanOrEqual(VIEWPORT.width * 0.25);
  });
});


describe("screenToWorld", () => {
  // Identity transform: scale=1, no translate. Screen pixel == world pixel.
  it("returns floor(screen) at scale 1, no translate", () => {
    const t = { tx: 0, ty: 0, scale: 1 };
    expect(screenToWorld(t, { x: 5, y: 7 }, WORLD)).toEqual({ x: 5, y: 7 });
    expect(screenToWorld(t, { x: 5.9, y: 7.1 }, WORLD)).toEqual({ x: 5, y: 7 });
  });

  it("inverts pan", () => {
    const t = { tx: 100, ty: 50, scale: 1 };
    // Screen (150, 60) → world (50, 10).
    expect(screenToWorld(t, { x: 150, y: 60 }, WORLD)).toEqual({ x: 50, y: 10 });
  });

  it("inverts zoom", () => {
    const t = { tx: 0, ty: 0, scale: 4 };
    // Screen (40, 80) at 4x → world (10, 20).
    expect(screenToWorld(t, { x: 40, y: 80 }, WORLD)).toEqual({ x: 10, y: 20 });
  });

  it("returns null for out-of-world points", () => {
    const t = { tx: 0, ty: 0, scale: 1 };
    expect(screenToWorld(t, { x: -1, y: 0 }, WORLD)).toBeNull();
    expect(screenToWorld(t, { x: 0, y: -1 }, WORLD)).toBeNull();
    expect(screenToWorld(t, { x: WORLD.width, y: 0 }, WORLD)).toBeNull();
    expect(screenToWorld(t, { x: 0, y: WORLD.height }, WORLD)).toBeNull();
  });

  it("returns null when pan pushes the click into negative world space", () => {
    // tx > 0: the world has been shifted right on screen, so any
    // screen click left of tx is in negative world coords.
    const t = { tx: 50, ty: 0, scale: 1 };
    // Screen 0 → world (0 - 50) / 1 = -50, out of bounds.
    expect(screenToWorld(t, { x: 0, y: 0 }, WORLD)).toBeNull();
  });
});
