import type { StrokeCanvasObject, StrokePoint } from "../objects/types";
import { getStrokeBounds } from "./strokeGeometry";
import { DEFAULT_PEN_SETTINGS, PEN_WIDTHS, type PenToolSettings } from "../../tools/toolSettings";

export const DEFAULT_STROKE_COLOR = "#3f413d";
export const DEFAULT_STROKE_WIDTH = 4;

export function createStrokeObject(
  points: StrokePoint[],
  zIndex: number,
  settings: PenToolSettings | string = DEFAULT_PEN_SETTINGS,
): StrokeCanvasObject {
  const timestamp = Date.now();
  const preferences = typeof settings === "string" ? { ...DEFAULT_PEN_SETTINGS, color: settings } : settings;
  const strokeWidth = PEN_WIDTHS[preferences.size];
  return {
    id: crypto.randomUUID(),
    type: "stroke",
    points,
    strokeWidth,
    color: preferences.color,
    mode: preferences.mode,
    opacity: preferences.opacity,
    ...getStrokeBounds(points, strokeWidth),
    zIndex,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
