import type {
  CardCanvasObject,
  FrameCanvasObject,
  ImageCanvasObject,
  TextCanvasObject,
} from "./types";
import type { Bounds } from "../../utils/geometry";
import type { Point } from "../viewport/viewportMath";
import { DEFAULT_TEXT_SETTINGS, TEXT_SIZES, TEXT_WEIGHTS, type TextToolSettings } from "../../tools/toolSettings";

const TEXT_WIDTH = 220;
const TEXT_HEIGHT = 52;
const CARD_WIDTH = 248;
const CARD_HEIGHT = 172;
export const MIN_FRAME_WIDTH = 280;
export const MIN_FRAME_HEIGHT = 180;
export const DEFAULT_FRAME_WIDTH = 520;
export const DEFAULT_FRAME_HEIGHT = 320;

type CreateImageObjectInput = {
  assetId: string;
  center: Point;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  name?: string;
  mimeType?: string;
  zIndex: number;
};

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
  settings: TextToolSettings = DEFAULT_TEXT_SETTINGS,
): TextCanvasObject {
  return {
    ...baseObject({ x: point.x, y: point.y - TEXT_HEIGHT / 2 }, zIndex),
    type: "text",
    width: TEXT_WIDTH,
    height: TEXT_HEIGHT,
    text: "Start typing…",
    color: settings.color,
    fontSize: TEXT_SIZES[settings.size],
    opacity: settings.opacity,
    fontWeight: TEXT_WEIGHTS[settings.weight],
    textAlign: settings.align,
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

export function createImageObject(
  input: CreateImageObjectInput,
): ImageCanvasObject {
  return {
    ...baseObject(
      {
        x: input.center.x - input.width / 2,
        y: input.center.y - input.height / 2,
      },
      input.zIndex,
    ),
    type: "image",
    assetId: input.assetId,
    width: input.width,
    height: input.height,
    originalWidth: input.originalWidth,
    originalHeight: input.originalHeight,
    name: input.name,
    mimeType: input.mimeType,
  };
}
