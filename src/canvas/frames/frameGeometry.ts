import {
  isCanvasNodeObject,
  isStrokeObject,
  type CanvasObject,
  type FrameCanvasObject,
} from "../objects/types";

export function frameContainsObject(
  frame: FrameCanvasObject,
  object: CanvasObject,
): boolean {
  return (
    (isCanvasNodeObject(object) || isStrokeObject(object)) &&
    object.x >= frame.x &&
    object.y >= frame.y &&
    object.x + object.width <= frame.x + frame.width &&
    object.y + object.height <= frame.y + frame.height
  );
}

export function getContainedObjectIds(
  frame: FrameCanvasObject,
  objects: Record<string, CanvasObject>,
): string[] {
  return Object.values(objects)
    .filter((object) => frameContainsObject(frame, object))
    .map((object) => object.id);
}
