import type { StrokeInputKind } from "../objects/types";

export function chooseStrokeDetail(width: number, input: StrokeInputKind | undefined, zoom: number, wasSimple = false): boolean {
  const projectedMinimum = width * (input === "pen" ? 1 / 3 : 0.54) * zoom;
  // Hysteresis keeps wheel/pinch noise from alternating representations.
  return wasSimple ? zoom < 0.55 && projectedMinimum < 1.6
    : zoom < 0.5 && projectedMinimum < 1.4;
}

export function simpleStrokeWidth(width: number, input?: StrokeInputKind): number {
  return width * (input === "pen" ? 0.65 : 0.8);
}

export function simpleStrokeWidthStyle(width: number, input?: StrokeInputKind): string {
  // The camera scales an HTML ancestor, outside SVG's vector-effect space.
  // Convert the CSS-pixel floor back to world units before that transform.
  return `max(calc(0.85px / var(--stroke-zoom)), ${simpleStrokeWidth(width, input)}px)`;
}

export function strokeHitWidthStyle(width: number): string {
  return `max(calc(14px / var(--stroke-zoom)), calc(${width}px + 10px / var(--stroke-zoom)))`;
}

export function strokeZoomBucket(zoom: number): number {
  return zoom <= 0.6 ? Math.round(zoom * 100) / 100 : 1;
}
