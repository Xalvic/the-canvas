import { expect, it } from "vitest";
import { strokeIntersectsWindow, updateStrokeRenderWindow } from "./strokeVisibility";
import { createStrokeObject } from "./strokeFactories";

it("uses overscan, holds its window during small camera changes and exposes panned ink", () => {
  const size = { width: 1000, height: 800 };
  const window = updateStrokeRenderWindow(null, { x: 0, y: 0, zoom: 1 }, size)!;
  expect(window.left).toBeLessThan(-128);
  expect(updateStrokeRenderWindow(window, { x: 50, y: 0, zoom: 1 }, size)).toBe(window);
  const offscreen = createStrokeObject([{ x: 4000, y: 500 }], 1);
  expect(strokeIntersectsWindow(offscreen, window)).toBe(false);
  expect(strokeIntersectsWindow(offscreen, updateStrokeRenderWindow(window, { x: -3500, y: 0, zoom: 1 }, size))).toBe(true);
  expect(strokeIntersectsWindow(offscreen, updateStrokeRenderWindow(window, { x: 0, y: 0, zoom: 0.2 }, size))).toBe(true);
});
