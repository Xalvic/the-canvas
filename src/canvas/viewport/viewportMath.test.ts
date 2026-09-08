import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  panViewport,
  screenToWorld,
  worldToScreen,
  zoomViewportAtPoint,
  type Viewport,
} from "./viewportMath";

describe("viewport math", () => {
  const viewport: Viewport = { x: 320, y: -180, zoom: 1.75 };

  it("converts world coordinates into screen coordinates", () => {
    expect(worldToScreen({ x: 80, y: 40 }, viewport)).toEqual({
      x: 460,
      y: -110,
    });
  });

  it("converts screen coordinates back into world coordinates", () => {
    expect(screenToWorld({ x: 460, y: -110 }, viewport)).toEqual({
      x: 80,
      y: 40,
    });
  });

  it("round-trips arbitrary points without drift", () => {
    const point = { x: -123.45, y: 987.65 };
    const roundTrip = screenToWorld(worldToScreen(point, viewport), viewport);

    expect(roundTrip.x).toBeCloseTo(point.x);
    expect(roundTrip.y).toBeCloseTo(point.y);
  });

  it("translates a viewport by a screen-space delta", () => {
    expect(panViewport(viewport, { x: 12, y: -9 })).toEqual({
      x: 332,
      y: -189,
      zoom: 1.75,
    });
  });

  it("keeps the world point beneath the cursor fixed while zooming", () => {
    const anchor = { x: 720, y: 410 };
    const before = screenToWorld(anchor, viewport);
    const zoomed = zoomViewportAtPoint(viewport, anchor, 3.2);
    const after = screenToWorld(anchor, zoomed);

    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("clamps zoom to the supported range", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(8)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it("preserves the cursor anchor even when requested zoom is clamped", () => {
    const anchor = { x: 10, y: 20 };
    const before = screenToWorld(anchor, viewport);
    const zoomed = zoomViewportAtPoint(viewport, anchor, 100);

    expect(zoomed.zoom).toBe(MAX_ZOOM);
    expect(screenToWorld(anchor, zoomed).x).toBeCloseTo(before.x);
    expect(screenToWorld(anchor, zoomed).y).toBeCloseTo(before.y);
  });
});
