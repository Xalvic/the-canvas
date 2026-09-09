import { describe, expect, it } from "vitest";
import { createStrokeObject } from "./strokeFactories";

describe("stroke factory", () => {
  it("creates a variable-width stroke in world coordinates", () => {
    const points = [
      { x: -20, y: 10, pressure: 0.5 },
      { x: 80, y: 50, pressure: 0.5 },
    ];
    const stroke = createStrokeObject(points, 6);

    expect(stroke).toMatchObject({
      type: "stroke",
      points,
      strokeWidth: 4,
      x: -22,
      y: 8,
      zIndex: 6,
    });
    expect(stroke.width).toBeCloseTo(104);
    expect(stroke.height).toBeCloseTo(44);
    expect(stroke.createdAt).toBe(stroke.updatedAt);
  });
});
