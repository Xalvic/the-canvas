import { describe, expect, it } from "vitest";
import {
  buildSmoothedStrokePath,
  buildVariableWidthStrokePath,
  getStrokeWidthAtPressure,
  getStrokeBounds,
} from "./strokeGeometry";

describe("stroke geometry", () => {
  it("builds a midpoint-smoothed quadratic path", () => {
    expect(
      buildSmoothedStrokePath([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ]),
    ).toBe("M 0 0 Q 10 10 15 5 L 20 0");
  });

  it("renders a visible dot for a single sampled point", () => {
    expect(buildSmoothedStrokePath([{ x: 4, y: 8 }])).toBe(
      "M 4 8 l 0.01 0",
    );
  });

  it("derives padded bounds", () => {
    const points = [
      { x: 10, y: 20, pressure: 0.25 },
      { x: 40, y: 60, pressure: 0.75 },
    ];
    expect(getStrokeBounds(points, 4)).toEqual({
      x: 8,
      y: 18,
      width: 34,
      height: 44,
    });
  });

  it("builds one closed outline with pressure-dependent width", () => {
    const path = buildVariableWidthStrokePath(
      [
        { x: 0, y: 0, pressure: 0 },
        { x: 10, y: 0, pressure: 1 },
      ],
      4,
    );

    expect(path).toMatch(/^M /);
    expect(path).toMatch(/ Z$/);
    expect(getStrokeWidthAtPressure(0, 4)).toBeCloseTo(0.72);
    expect(getStrokeWidthAtPressure(1, 4)).toBe(4);
  });

  it("builds a pressure-sized dot from one point", () => {
    expect(
      buildVariableWidthStrokePath(
        [{ x: 4, y: 8, pressure: 0.5 }],
        4,
      ),
    ).toContain(" A ");
  });
});
