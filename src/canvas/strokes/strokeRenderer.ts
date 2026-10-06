import { getStrokeOutlinePoints, getStrokePoints } from "perfect-freehand";
import type { StrokeCanvasObject, StrokePoint } from "../objects/types";
import type { Point } from "../viewport/viewportMath";
import { buildSmoothedStrokePath, buildVariableWidthStrokePath, getStrokeBounds } from "./strokeGeometry";

export type StrokeGeometry = {
  outlinePath: string;
  centerlinePath: string;
  outline: Point[];
  bounds: { x: number; y: number; width: number; height: number };
};
type StrokeShape = Pick<StrokeCanvasObject, "points" | "strokeWidth" | "mode" | "rendererVersion" | "inputKind">;

const cache = new WeakMap<StrokePoint[], Map<string, StrokeGeometry>>();
const cacheOrder = new Map<StrokePoint[], true>();
let cachedPointCount = 0;

function touchCache(points: StrokePoint[]) {
  if (cacheOrder.delete(points)) cachedPointCount -= points.length;
  cacheOrder.set(points, true);
  cachedPointCount += points.length;
  // Culling must also release cold outlines. Keep one oversized logical stroke
  // cacheable, while bounding other retained geometry by samples and entries.
  while (cacheOrder.size > 512 || (cachedPointCount > 50_000 && cacheOrder.size > 1)) {
    const oldest = cacheOrder.keys().next().value!;
    cacheOrder.delete(oldest);
    cache.delete(oldest);
    cachedPointCount -= oldest.length;
  }
}

function boundsOf(points: Point[], padding = 0) {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const point of points) {
    left = Math.min(left, point.x); top = Math.min(top, point.y);
    right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
  }
  return { x: left - padding, y: top - padding, width: right - left + padding * 2, height: bottom - top + padding * 2 };
}

function closedPath(points: Point[]): string {
  if (!points.length) return "";
  // Quadratic control points remain inside the outline's conservative bounds.
  const first = points[0], second = points[1] ?? first;
  let path = `M ${(first.x + second.x) / 2} ${(first.y + second.y) / 2}`;
  for (let index = 1; index <= points.length; index++) {
    const point = points[index % points.length];
    const next = points[(index + 1) % points.length];
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  }
  return `${path} Z`;
}

export function getStrokeGeometry(shape: StrokeShape, complete = true): StrokeGeometry {
  const key = `${shape.rendererVersion ?? 1}:${shape.inputKind ?? "mouse"}:${shape.strokeWidth}:${shape.mode ?? "draw"}`;
  const saved = complete ? cache.get(shape.points)?.get(key) : undefined;
  if (saved) { touchCache(shape.points); return saved; }
  let geometry: StrokeGeometry;
  if (shape.rendererVersion !== 2) {
    geometry = {
      centerlinePath: buildSmoothedStrokePath(shape.points),
      outlinePath: buildVariableWidthStrokePath(shape.points, shape.strokeWidth),
      outline: [], bounds: getStrokeBounds(shape.points, shape.strokeWidth),
    };
  } else if (!shape.points.length) {
    geometry = { outlinePath: "", centerlinePath: "", outline: [], bounds: boundsOf([]) };
  } else {
    const thinning = shape.inputKind === "pen" ? 0.5 : 0.3;
    // The library size is not a maximum diameter. At pressure=1 its diameter
    // is size*(1+thinning); calibrate to the existing 4 / 10 / 20 controls.
    const size = shape.strokeWidth / (1 + thinning);
    const input = shape.points.map(({ x, y, inkPressure }) => ({ x, y, pressure: inkPressure ?? 0.5 }));
    const options = { size, thinning, streamline: 0.5, smoothing: 0.6, simulatePressure: false, last: complete };
    let center: Point[];
    let outline: Point[];
    if (input.length === 1) {
      const first = input[0];
      const radius = size * (0.5 - thinning * (0.5 - first.pressure));
      center = [first];
      outline = Array.from({ length: 32 }, (_, i) => ({
        x: first.x + radius * Math.cos(i * Math.PI / 16),
        y: first.y + radius * Math.sin(i * Math.PI / 16),
      }));
    } else {
      // Limit the library's size-dependent startup point rejection so XL ink
      // retains small lettering. Outline thickness still uses calibrated size.
      // The latest confirmed contact is an exact endpoint even in preview.
      // Otherwise a sparse 2-point move can lag tens of pixels and jump on up.
      const processed = getStrokePoints(input, { ...options, size: Math.min(2, size), last: true });
      center = processed.map(({ point }) => ({ x: point[0], y: point[1] }));
      outline = getStrokeOutlinePoints(processed, options).map(([x, y]) => ({ x, y }));
    }
    const solidBounds = boundsOf(center, shape.strokeWidth / 2 + (center.length === 1 ? 0.01 : 0));
    const inkBounds = boundsOf(outline);
    geometry = {
      outlinePath: closedPath(outline), centerlinePath: buildSmoothedStrokePath(center), outline,
      bounds: shape.mode === "solid" ? solidBounds : inkBounds,
    };
  }
  if (complete) {
    let entries = cache.get(shape.points);
    if (!entries) { entries = new Map(); cache.set(shape.points, entries); }
    // Bounds cache lifetime to the immutable points and a handful of styles.
    if (entries.size >= 12) entries.clear();
    entries.set(key, geometry);
    touchCache(shape.points);
  }
  return geometry;
}
