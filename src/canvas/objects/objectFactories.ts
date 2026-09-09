import type {
  CardCanvasObject,
  FrameCanvasObject,
  TextCanvasObject,
} from "./types";
import type { Bounds } from "../../utils/geometry";
import type { Point } from "../viewport/viewportMath";

const TEXT_WIDTH = 220;
const TEXT_HEIGHT = 52;
const CARD_WIDTH = 248;
const CARD_HEIGHT = 172;
export const MIN_FRAME_WIDTH = 280;
export const MIN_FRAME_HEIGHT = 180;
export const DEFAULT_FRAME_WIDTH = 520;
export const DEFAULT_FRAME_HEIGHT = 320;

function baseObject(point: Point, zIndex: number) {
  const timestamp = Date.now();

  return {
    id: crypto.randomUUID(),
    x: point.x,
    y: point.y,
    zIndex,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createTextObject(
  point: Point,
  zIndex: number,
): TextCanvasObject {
  return {
    ...baseObject({ x: point.x, y: point.y - TEXT_HEIGHT / 2 }, zIndex),
    type: "text",
    width: TEXT_WIDTH,
    height: TEXT_HEIGHT,
    text: "Start typing…",
  };
}

export function createCardObject(
  point: Point,
  zIndex: number,
): CardCanvasObject {
  return {
    ...baseObject(
      { x: point.x - CARD_WIDTH / 2, y: point.y - 32 },
      zIndex,
    ),
    type: "card",
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    title: "New idea",
    body: "Add a thought, question, or next step.",
  };
}

export function createFrameObject(
  bounds: Bounds,
  zIndex: number,
): FrameCanvasObject {
  const timestamp = Date.now();
  return {
    id: crypto.randomUUID(),
    type: "frame",
    x: bounds.left,
    y: bounds.top,
    width: Math.max(MIN_FRAME_WIDTH, bounds.right - bounds.left),
    height: Math.max(MIN_FRAME_HEIGHT, bounds.bottom - bounds.top),
    title: "Untitled section",
    moveContents: true,
    zIndex,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
