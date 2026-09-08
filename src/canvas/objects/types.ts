export type BaseDocumentObject = {
  id: string;
  zIndex: number;
  createdAt: number;
  updatedAt: number;
};

export type BaseSpatialObject = BaseDocumentObject & {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TextCanvasObject = BaseSpatialObject & {
  type: "text";
  text: string;
};

export type CardCanvasObject = BaseSpatialObject & {
  type: "card";
  title: string;
  body: string;
};

export type ConnectionAnchor = "top" | "right" | "bottom" | "left";

export type ConnectionEndpoint = {
  objectId: string;
  anchor: ConnectionAnchor;
};

export type ConnectorCanvasObject = BaseDocumentObject & {
  type: "connector";
  from: ConnectionEndpoint;
  to: ConnectionEndpoint;
  directed: boolean;
};

export type CanvasNodeObject = TextCanvasObject | CardCanvasObject;
export type CanvasObject = CanvasNodeObject | ConnectorCanvasObject;
export type CanvasObjectType = CanvasObject["type"];

export function isCanvasNodeObject(
  object: CanvasObject,
): object is CanvasNodeObject {
  return object.type === "text" || object.type === "card";
}

export function isConnectorObject(
  object: CanvasObject,
): object is ConnectorCanvasObject {
  return object.type === "connector";
}
