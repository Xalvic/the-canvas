export type Point = {
  x: number;
  y: number;
};

export type Viewport = {
  /** World origin translated into screen-space pixels. */
  x: number;
  /** World origin translated into screen-space pixels. */
  y: number;
  zoom: number;
};

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;

export function clampZoom(
  zoom: number,
  min = MIN_ZOOM,
  max = MAX_ZOOM,
): number {
  return Math.min(max, Math.max(min, zoom));
}

export function worldToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.zoom + viewport.x,
    y: point.y * viewport.zoom + viewport.y,
  };
}

export function screenToWorld(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom,
  };
}

export function panViewport(viewport: Viewport, delta: Point): Viewport {
  return {
    ...viewport,
    x: viewport.x + delta.x,
    y: viewport.y + delta.y,
  };
}

/**
 * Returns a viewport whose zoom is anchored at the supplied screen point.
 * The world coordinate beneath that point is identical before and after.
 */
export function zoomViewportAtPoint(
  viewport: Viewport,
  screenPoint: Point,
  requestedZoom: number,
): Viewport {
  const zoom = clampZoom(requestedZoom);
  const anchoredWorldPoint = screenToWorld(screenPoint, viewport);

  return {
    x: screenPoint.x - anchoredWorldPoint.x * zoom,
    y: screenPoint.y - anchoredWorldPoint.y * zoom,
    zoom,
  };
}
