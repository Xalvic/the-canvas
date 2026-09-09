import type { StrokeCanvasObject, StrokePoint } from "../objects/types";
import { getStrokeBounds } from "./strokeGeometry";

export const DEFAULT_STROKE_COLOR = "#3f413d";
export const DEFAULT_STROKE_WIDTH = 4;

export function createStrokeObject(
  points: StrokePoint[],
  zIndex: number,
  color = DEFAULT_STROKE_COLOR,
): StrokeCanvasObject {
  const timestamp = Date.now();
  const strokeWidth = DEFAULT_STROKE_WIDTH;
  return {
    id: crypto.randomUUID(),
    type: "stroke",
    points,
    strokeWidth,
    color,
    ...getStrokeBounds(points, strokeWidth),
    zIndex,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
