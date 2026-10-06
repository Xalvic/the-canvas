import type { Viewport } from "../viewport/viewportMath";
import type { StrokeCanvasObject } from "../objects/types";

export type StrokeRenderWindow = { left: number; top: number; right: number; bottom: number; zoom: number };

export function updateStrokeRenderWindow(
  previous: StrokeRenderWindow | null, viewport: Viewport, size: { width: number; height: number },
): StrokeRenderWindow | null {
  if (!size.width || !size.height) return previous;
  const left = -viewport.x / viewport.zoom, top = -viewport.y / viewport.zoom;
  const right = left + size.width / viewport.zoom, bottom = top + size.height / viewport.zoom;
  const margin = 128 / viewport.zoom;
  if (previous && viewport.zoom / previous.zoom >= 0.9 && viewport.zoom / previous.zoom <= 1.1 &&
    left >= previous.left + margin && top >= previous.top + margin &&
    right <= previous.right - margin && bottom <= previous.bottom - margin) return previous;
  const padding = margin * 2, tile = 256;
  return {
    zoom: viewport.zoom,
    left: Math.floor((left - padding) / tile) * tile, top: Math.floor((top - padding) / tile) * tile,
    right: Math.ceil((right + padding) / tile) * tile, bottom: Math.ceil((bottom + padding) / tile) * tile,
  };
}

export function strokeIntersectsWindow(stroke: StrokeCanvasObject, window: StrokeRenderWindow | null): boolean {
  return !window || (stroke.x + stroke.width >= window.left && stroke.x <= window.right &&
    stroke.y + stroke.height >= window.top && stroke.y <= window.bottom);
}
