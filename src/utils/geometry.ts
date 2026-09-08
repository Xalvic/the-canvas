import type { CanvasObject } from "../canvas/objects/types";

export type Bounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function getObjectBounds(object: CanvasObject): Bounds {
  return {
    left: object.x,
    top: object.y,
    right: object.x + object.width,
    bottom: object.y + object.height,
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
): Bounds | null {
  if (objects.length === 0) return null;

  return objects.reduce<Bounds>(
    (combined, object) => {
      const bounds = getObjectBounds(object);
      return {
        left: Math.min(combined.left, bounds.left),
        top: Math.min(combined.top, bounds.top),
        right: Math.max(combined.right, bounds.right),
        bottom: Math.max(combined.bottom, bounds.bottom),
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
