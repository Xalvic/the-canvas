import type { Point } from "../viewport/viewportMath";
import type { StrokePoint } from "../objects/types";

export function buildSmoothedStrokePath(points: Point[]): string {
  const first = points[0];
  if (!first) return "";
  if (points.length === 1) return `M ${first.x} ${first.y} l 0.01 0`;
  if (points.length === 2) {
    return `M ${first.x} ${first.y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    const midpoint = {
      x: (point.x + next.x) / 2,
      y: (point.y + next.y) / 2,
    };
    path += ` Q ${point.x} ${point.y} ${midpoint.x} ${midpoint.y}`;
  }
  const last = points.at(-1)!;
  return `${path} L ${last.x} ${last.y}`;
}

const MIN_WIDTH_RATIO = 0.18;

export function getStrokeWidthAtPressure(
  pressure: number,
  maxWidth: number,
): number {
  const normalizedPressure = Math.min(1, Math.max(0, pressure));
  return maxWidth * (
    MIN_WIDTH_RATIO + normalizedPressure * (1 - MIN_WIDTH_RATIO)
  );
}

function getStrokeTangent(points: StrokePoint[], index: number): Point {
  const previous = points[Math.max(0, index - 1)];
  const next = points[Math.min(points.length - 1, index + 1)];
  const deltaX = next.x - previous.x;
  const deltaY = next.y - previous.y;
  const length = Math.hypot(deltaX, deltaY);
  if (length < 0.0001) return { x: 1, y: 0 };
  return { x: deltaX / length, y: deltaY / length };
}

function getSmoothedPressure(points: StrokePoint[], index: number): number {
  if (index === 0 || index === points.length - 1) {
    return points[index].pressure;
  }
  return (
    points[index - 1].pressure +
    points[index].pressure * 2 +
    points[index + 1].pressure
  ) / 4;
}

function appendSmoothedEdge(path: string, points: Point[]): string {
  if (points.length === 1) return path;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    path += ` Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  }
  const last = points.at(-1)!;
  return `${path} L ${last.x} ${last.y}`;
}

export function buildVariableWidthStrokePath(
  points: StrokePoint[],
  maxWidth: number,
): string {
  const first = points[0];
  if (!first) return "";

  if (points.length === 1) {
    const radius = getStrokeWidthAtPressure(first.pressure, maxWidth) / 2;
    return `M ${first.x + radius} ${first.y} A ${radius} ${radius} 0 1 0 ${first.x - radius} ${first.y} A ${radius} ${radius} 0 1 0 ${first.x + radius} ${first.y} Z`;
  }

  const left: Point[] = [];
  const right: Point[] = [];
  const tangents: Point[] = [];
  const radii: number[] = [];

  points.forEach((point, index) => {
    const tangent = getStrokeTangent(points, index);
    const radius =
      getStrokeWidthAtPressure(
        getSmoothedPressure(points, index),
        maxWidth,
      ) / 2;
    tangents.push(tangent);
    radii.push(radius);
    left.push({
      x: point.x - tangent.y * radius,
      y: point.y + tangent.x * radius,
    });
    right.push({
      x: point.x + tangent.y * radius,
      y: point.y - tangent.x * radius,
    });
  });

  let path = appendSmoothedEdge(`M ${left[0].x} ${left[0].y}`, left);
  const lastIndex = points.length - 1;
  const lastPoint = points[lastIndex];
  const lastTangent = tangents[lastIndex];
  const lastRadius = radii[lastIndex];
  path += ` Q ${lastPoint.x + lastTangent.x * lastRadius} ${lastPoint.y + lastTangent.y * lastRadius} ${right[lastIndex].x} ${right[lastIndex].y}`;

  path = appendSmoothedEdge(path, [...right].reverse());
  const firstTangent = tangents[0];
  const firstRadius = radii[0];
  return `${path} Q ${first.x - firstTangent.x * firstRadius} ${first.y - firstTangent.y * firstRadius} ${left[0].x} ${left[0].y} Z`;
}

export function getStrokeBounds(
  points: Point[],
  strokeWidth: number,
): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const padding = strokeWidth / 2;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs) - padding;
  const top = Math.min(...ys) - padding;
  const right = Math.max(...xs) + padding;
  const bottom = Math.max(...ys) + padding;
  return {
    x: left,
    y: top,
    width: Math.max(strokeWidth, right - left),
    height: Math.max(strokeWidth, bottom - top),
  };
}
