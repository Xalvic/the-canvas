export type BaseCanvasObject = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  createdAt: number;
  updatedAt: number;
};

export type TextCanvasObject = BaseCanvasObject & {
  type: "text";
  text: string;
};

export type CardCanvasObject = BaseCanvasObject & {
  type: "card";
  title: string;
  body: string;
};

export type CanvasObject = TextCanvasObject | CardCanvasObject;

export type CanvasObjectType = CanvasObject["type"];
