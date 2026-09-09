import { describe, expect, it } from "vitest";
import { createStrokeDynamics, sampleStrokeDynamics } from "./strokeDynamics";
import {
  buildVariableWidthStrokePath,
  getPointWidthRatio,
} from "./strokeGeometry";
import { createStrokeObject } from "./strokeFactories";
import { DEFAULT_PEN_SETTINGS, PEN_WIDTHS } from "../../tools/toolSettings";

function draw(
  speed: number,
  pointerType = "mouse",
  pressure = 0.5,
  curved = false,
  dt = 8,
) {
  const state = createStrokeDynamics();
  return Array.from({ length: Math.ceil(1000 / dt) }, (_, index) => {
    const distance = index * speed * dt;
    const point = curved
      ? {
          x: 140 * Math.sin(distance / 140),
          y: 140 * (1 - Math.cos(distance / 140)),
        }
      : { x: distance, y: 0 };
    return {
      ...point,
      ...sampleStrokeDynamics(state, point, index * dt, pressure, pointerType),
    };
  });
}

describe("expressive stroke dynamics", () => {
  it.each(["mouse", "touch", "pen"])(
    "makes slow straight and curved %s strokes thicker than fast ones",
    (pointerType) => {
      for (const curved of [false, true]) {
        const slow = draw(0.1, pointerType, 0.5, curved).at(-1)!;
        const fast = draw(2.5, pointerType, 0.5, curved).at(-1)!;
        expect(slow.widthRatio!).toBeGreaterThan(fast.widthRatio! * 2);
      }
    },
  );

  it("combines stylus force with velocity and falls back when force is absent", () => {
    for (const speed of [0.1, 1, 2.5]) {
      expect(draw(speed, "pen", 0.9).at(-1)!.widthRatio!).toBeGreaterThan(
        draw(speed, "pen", 0.1).at(-1)!.widthRatio!,
      );
      expect(draw(speed, "pen", 0).at(-1)!.widthRatio).toBeCloseTo(
        draw(speed).at(-1)!.widthRatio!,
      );
    }
  });

  it("smooths abrupt speed/pressure changes without depending on sample frequency", () => {
    const state = createStrokeDynamics();
    let previous = sampleStrokeDynamics(
      state,
      { x: 0, y: 0 },
      0,
      1,
      "pen",
    ).widthRatio!;
    for (let i = 1; i < 80; i++) {
      const width = sampleStrokeDynamics(
        state,
        { x: i * 24, y: 0 },
        i * 8,
        0.1,
        "pen",
      ).widthRatio!;
      expect(Math.abs(width - previous)).toBeLessThan(0.13);
      previous = width;
    }
    expect(draw(1, "mouse", 0, false, 4).at(-1)!.widthRatio).toBeCloseTo(
      draw(1, "mouse", 0, false, 16).at(-1)!.widthRatio!,
      3,
    );
  });

  it("retains legacy pressure rendering and handles points without pressure", () => {
    expect(getPointWidthRatio({ x: 0, y: 0, pressure: 0 })).toBeCloseTo(0.18);
    expect(getPointWidthRatio({ x: 0, y: 0, pressure: 1 })).toBe(1);
    expect(getPointWidthRatio({ x: 0, y: 0 })).toBe(1);
    expect(
      buildVariableWidthStrokePath(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        4,
      ),
    ).not.toMatch(/NaN|undefined/);
  });

  it("preserves appearance and expressive ratios for all thicknesses in both modes", () => {
    const points = draw(0.5);
    for (const mode of ["draw", "solid"] as const) {
      for (const size of ["small", "large", "xl"] as const) {
        const stroke = createStrokeObject(points, 1, {
          ...DEFAULT_PEN_SETTINGS,
          mode,
          size,
          color: "#3878d5",
          opacity: 0.35,
        });
        expect(stroke).toMatchObject({
          mode,
          strokeWidth: PEN_WIDTHS[size],
          color: "#3878d5",
          opacity: 0.35,
          points,
        });
      }
    }
  });
});
