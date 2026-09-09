import type { CSSProperties } from "react";
import type { TextCanvasObject } from "./types";

// Match the original typography for saved objects without appearance fields.
export function getTextStyle(object: TextCanvasObject): CSSProperties {
  return {
    color: object.color ?? "#252622",
    fontSize: object.fontSize ?? 17,
    fontWeight: object.fontWeight ?? 550,
    textAlign: object.textAlign ?? "left",
  };
}

export function measureStyledTextHeight(object: TextCanvasObject): number {
  const source = document.querySelector<HTMLElement>(
    `[data-object-id="${object.id}"] .text-object-value`,
  );
  if (!source) return object.height;
  const measure = source.cloneNode(true) as HTMLElement;
  Object.assign(measure.style, {
    ...getTextStyle(object),
    fontSize: `${object.fontSize ?? 17}px`,
    position: "fixed",
    left: "-10000px",
    top: "0",
    visibility: "hidden",
    width: `${object.width - 20}px`,
    height: "auto",
    opacity: "1",
  });
  document.body.appendChild(measure);
  const height = Math.max(
    52,
    Math.ceil(measure.getBoundingClientRect().height) + 16,
  );
  measure.remove();
  return height;
}
