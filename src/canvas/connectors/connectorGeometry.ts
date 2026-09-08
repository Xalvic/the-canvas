import type {
  CanvasNodeObject,
  ConnectionAnchor,
  ConnectionEndpoint,
} from "../objects/types";
import type { Point } from "../viewport/viewportMath";

export function getAnchorPoint(
  object: CanvasNodeObject,
  anchor: ConnectionAnchor,
): Point {
  switch (anchor) {
    case "top":
      return { x: object.x + object.width / 2, y: object.y };
    case "right":
      return { x: object.x + object.width, y: object.y + object.height / 2 };
    case "bottom":
      return { x: object.x + object.width / 2, y: object.y + object.height };
    case "left":
      return { x: object.x, y: object.y + object.height / 2 };
  }
}

export function getEndpointPoint(
  endpoint: ConnectionEndpoint,
  nodes: Record<string, CanvasNodeObject>,
): Point | null {
  const object = nodes[endpoint.objectId];
  return object ? getAnchorPoint(object, endpoint.anchor) : null;
}

function anchorVector(anchor: ConnectionAnchor): Point {
  switch (anchor) {
    case "top":
      return { x: 0, y: -1 };
    case "right":
      return { x: 1, y: 0 };
    case "bottom":
      return { x: 0, y: 1 };
    case "left":
      return { x: -1, y: 0 };
  }
}

export function inferAnchorToward(from: Point, to: Point): ConnectionAnchor {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0 ? "right" : "left";
  }
  return deltaY >= 0 ? "bottom" : "top";
}

export function buildConnectorPath(
  from: Point,
  to: Point,
  fromAnchor: ConnectionAnchor,
  toAnchor: ConnectionAnchor,
): string {
  const fromVector = anchorVector(fromAnchor);
  const toVector = anchorVector(toAnchor);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const controlDistance = Math.max(44, Math.min(180, distance * 0.46));
  const firstControl = {
    x: from.x + fromVector.x * controlDistance,
    y: from.y + fromVector.y * controlDistance,
  };
  const secondControl = {
    x: to.x + toVector.x * controlDistance,
    y: to.y + toVector.y * controlDistance,
  };

  return `M ${from.x} ${from.y} C ${firstControl.x} ${firstControl.y}, ${secondControl.x} ${secondControl.y}, ${to.x} ${to.y}`;
}
