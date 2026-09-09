import { getAnchorPoint } from "../canvas/connectors/connectorGeometry";
import {
  isCanvasSpatialObject,
  isCanvasNodeObject,
  type CanvasObject,
  type CanvasNodeObject,
} from "../canvas/objects/types";

export type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function getObjectBounds(
  object: CanvasObject,
  allObjects: Record<string, CanvasObject> = {},
): Bounds | null {
  if (isCanvasSpatialObject(object)) {
    return {
      left: object.x,
      top: object.y,
      right: object.x + object.width,
      bottom: object.y + object.height,
    };
  }

  const fromObject = allObjects[object.from.objectId];
  const toObject = allObjects[object.to.objectId];
  if (
    !fromObject ||
    !toObject ||
    !isCanvasNodeObject(fromObject) ||
    !isCanvasNodeObject(toObject)
  ) {
    return null;
  }

  const from = getAnchorPoint(fromObject, object.from.anchor);
  const to = getAnchorPoint(toObject, object.to.anchor);
  return {
    left: Math.min(from.x, to.x),
    top: Math.min(from.y, to.y),
    right: Math.max(from.x, to.x),
    bottom: Math.max(from.y, to.y),
  };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(
    a.right < b.left ||
    a.left > b.right ||
    a.bottom < b.top ||
    a.top > b.bottom
  );
}

export function getCombinedBounds(
  objects: CanvasObject[],
  allObjects: Record<string, CanvasObject> = {},
): Bounds | null {
  const bounds = objects
    .map((object) => getObjectBounds(object, allObjects))
    .filter((value): value is Bounds => value !== null);
  if (bounds.length === 0) return null;

  return bounds.reduce<Bounds>(
    (combined, objectBounds) => {
      return {
        left: Math.min(combined.left, objectBounds.left),
        top: Math.min(combined.top, objectBounds.top),
        right: Math.max(combined.right, objectBounds.right),
        bottom: Math.max(combined.bottom, objectBounds.bottom),
      };
    },
    {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
  );
}

export function getNodeObjects(
  objects: Record<string, CanvasObject>,
): Record<string, CanvasNodeObject> {
  return Object.fromEntries(
    Object.entries(objects).filter((entry): entry is [string, CanvasNodeObject] =>
      isCanvasNodeObject(entry[1]),
    ),
  );
}
