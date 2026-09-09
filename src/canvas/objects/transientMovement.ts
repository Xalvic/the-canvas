import type { Point } from "../viewport/viewportMath";

export type MovementElement = HTMLElement | SVGGElement;

export function collectMovementElements(
  positions: Record<string, Point>,
  root: ParentNode = document,
): Map<string, MovementElement> {
  const elements = new Map<string, MovementElement>();
  root.querySelectorAll<HTMLElement>("[data-object-id]").forEach((element) => {
    const id = element.dataset.objectId;
    if (id && id in positions) elements.set(id, element);
  });
  root
    .querySelectorAll<SVGGElement>("[data-stroke-object-id]")
    .forEach((element) => {
      const id = element.dataset.strokeObjectId;
      if (id && id in positions) elements.set(id, element);
    });
  return elements;
}

export function paintMovementElements(
  startPositions: Record<string, Point>,
  nextPositions: Record<string, Point>,
  elements: Map<string, MovementElement>,
): void {
  for (const [id, next] of Object.entries(nextPositions)) {
    const element = elements.get(id);
    const start = startPositions[id];
    if (!element || !start) continue;
    if (element instanceof HTMLElement) {
      element.style.left = `${next.x}px`;
      element.style.top = `${next.y}px`;
    } else {
      element.setAttribute(
        "transform",
        `translate(${next.x - start.x} ${next.y - start.y})`,
      );
    }
  }
}

export function clearMovementTransforms(
  elements: Map<string, MovementElement>,
): void {
  for (const element of elements.values()) {
    if (element instanceof SVGElement) element.removeAttribute("transform");
  }
}
