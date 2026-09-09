export type BaseDocumentObject = {
  id: string;
  zIndex: number;
  createdAt: number;
  updatedAt: number;
  groupId?: string;
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
  color?: string;
  fontSize?: number;
  opacity?: number;
  fontWeight?: number;
  textAlign?: "left" | "center" | "right";
};

export type CardCanvasObject = BaseSpatialObject & {
  type: "card";
  title: string;
  body: string;
};

export type FrameCanvasObject = BaseSpatialObject & {
  type: "frame";
  title: string;
  moveContents: boolean;
};

export type ImageCanvasObject = BaseSpatialObject & {
  type: "image";
  assetId: string;
  originalWidth: number;
  originalHeight: number;
  name?: string;
  mimeType?: string;
};

export type StrokePoint = {
  x: number;
  y: number;
  pressure?: number;
  // New Draw strokes store the smoothed width as a fraction of strokeWidth.
  // A ratio keeps thickness edits independent of captured expressive dynamics.
  widthRatio?: number;
  velocity?: number;
};

export type StrokeCanvasObject = BaseSpatialObject & {
  type: "stroke";
  points: StrokePoint[];
  strokeWidth: number;
  color: string;
  mode?: "draw" | "solid";
  opacity?: number;
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
export type CanvasLayerObject = CanvasNodeObject | ImageCanvasObject;
export type CanvasDomObject = CanvasLayerObject | FrameCanvasObject;
export type CanvasSpatialObject = CanvasDomObject | StrokeCanvasObject;
export type CanvasObject = CanvasSpatialObject | ConnectorCanvasObject;
export type CanvasObjectType = CanvasObject["type"];

export function isCanvasNodeObject(
  object: CanvasObject,
): object is CanvasNodeObject {
  return object.type === "text" || object.type === "card";
}

export function isFrameObject(
  object: CanvasObject,
): object is FrameCanvasObject {
  return object.type === "frame";
}

export function isImageObject(
  object: CanvasObject,
): object is ImageCanvasObject {
  return object.type === "image";
}

export function isCanvasLayerObject(
  object: CanvasObject,
): object is CanvasLayerObject {
  return isCanvasNodeObject(object) || isImageObject(object);
}

export function isStrokeObject(
  object: CanvasObject,
): object is StrokeCanvasObject {
  return object.type === "stroke";
}

export function isCanvasSpatialObject(
  object: CanvasObject,
): object is CanvasSpatialObject {
  return (
    isCanvasNodeObject(object) ||
    isFrameObject(object) ||
    isImageObject(object) ||
    isStrokeObject(object)
  );
}

export function isConnectorObject(
  object: CanvasObject,
): object is ConnectorCanvasObject {
  return object.type === "connector";
}
