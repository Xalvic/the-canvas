import { buildConnectorPath, getAnchorPoint } from "./connectorGeometry";
import {
  isCanvasNodeObject,
  isConnectorObject,
  type CanvasNodeObject,
  type CanvasObject,
} from "../objects/types";

function numericStyle(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function liveNode(
  object: CanvasNodeObject,
  elements: Map<string, HTMLElement>,
): CanvasNodeObject {
  const element = elements.get(object.id);
  if (!element) return object;

  return {
    ...object,
    x: numericStyle(element.style.left, object.x),
    y: numericStyle(element.style.top, object.y),
    width: numericStyle(element.style.width, object.width),
    height: numericStyle(element.style.height, object.height),
  };
}

export function refreshConnectorGeometryFromDom(
  objects: Record<string, CanvasObject>,
  root: ParentNode = document,
): void {
  const nodeElements = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>("[data-object-id]").forEach((element) => {
    const id = element.dataset.objectId;
    if (id) nodeElements.set(id, element);
  });
  const connectorPaths = new Map<string, SVGPathElement[]>();
  root
    .querySelectorAll<SVGPathElement>("[data-connector-path-id]")
    .forEach((element) => {
      const id = element.dataset.connectorPathId;
      if (!id) return;
      const paths = connectorPaths.get(id) ?? [];
      paths.push(element);
      connectorPaths.set(id, paths);
    });
  const connectorHandles = new Map<string, SVGCircleElement[]>();
  root
    .querySelectorAll<SVGCircleElement>("[data-connector-handle-id]")
    .forEach((element) => {
      const id = element.dataset.connectorHandleId;
      if (!id) return;
      const handles = connectorHandles.get(id) ?? [];
      handles.push(element);
      connectorHandles.set(id, handles);
    });

  const nodes = Object.fromEntries(
    Object.entries(objects)
      .filter((entry): entry is [string, CanvasNodeObject] =>
        isCanvasNodeObject(entry[1]),
      )
      .map(([id, object]) => [id, liveNode(object, nodeElements)]),
  );

  for (const connector of Object.values(objects).filter(isConnectorObject)) {
    const fromObject = nodes[connector.from.objectId];
    const toObject = nodes[connector.to.objectId];
    if (!fromObject || !toObject) continue;
    const from = getAnchorPoint(fromObject, connector.from.anchor);
    const to = getAnchorPoint(toObject, connector.to.anchor);
    const path = buildConnectorPath(
      from,
      to,
      connector.from.anchor,
      connector.to.anchor,
    );

    connectorPaths
      .get(connector.id)
      ?.forEach((element) => element.setAttribute("d", path));

    connectorHandles.get(connector.id)?.forEach((element) => {
        const point = element.dataset.connectorEnd === "from" ? from : to;
        element.setAttribute("cx", String(point.x));
        element.setAttribute("cy", String(point.y));
    });
  }
}
