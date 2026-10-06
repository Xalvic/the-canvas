import { describe, expect, it } from "vitest";
import { getStrokeGeometry } from "./strokeRenderer";
import { buildVariableWidthStrokePath } from "./strokeGeometry";
import { createInkDynamics, sampleInkDynamics } from "./strokeDynamics";
import { appendInkSample } from "./strokeInput";
import type { StrokePoint } from "../objects/types";

const shape = (points: StrokePoint[], strokeWidth = 4) => ({ points, strokeWidth, rendererVersion: 2 as const, inputKind: "pen" as const });

describe("versioned stroke geometry", () => {
  const traces = [
    [{ x: 0, y: 0 }],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 20, y: 0 }],
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }],
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -10, y: 0 }, { x: 10, y: 0 }],
    Array.from({ length: 3000 }, (_, i) => ({ x: i / 4, y: 10 * Math.sin(i / 20) })),
  ];
  it.each(traces.map((points, i) => [i, points] as const))("contains all ink for trace %s at every size", (_, points) => {
    for (const width of [4, 10, 20]) {
      const result = getStrokeGeometry(shape(points.map((p) => ({ ...p, inkPressure: 0.7 })), width));
      expect(result.outlinePath).not.toMatch(/NaN|undefined|Infinity/);
      expect(result.centerlinePath).not.toMatch(/NaN|undefined|Infinity/);
      expect(result.bounds.width).toBeGreaterThan(0);
      for (const point of result.outline) {
        expect(point.x).toBeGreaterThanOrEqual(result.bounds.x - 1e-8);
        expect(point.x).toBeLessThanOrEqual(result.bounds.x + result.bounds.width + 1e-8);
        expect(point.y).toBeGreaterThanOrEqual(result.bounds.y - 1e-8);
        expect(point.y).toBeLessThanOrEqual(result.bounds.y + result.bounds.height + 1e-8);
      }
    }
  });

  it("calibrates maximum dot diameter to existing sizes and keeps light ink visible", () => {
    for (const width of [4, 10, 20]) {
      const strong = getStrokeGeometry(shape([{ x: 0, y: 0, inkPressure: 1 }], width));
      const light = getStrokeGeometry(shape([{ x: 0, y: 0, inkPressure: 0 }], width));
      expect(strong.bounds.width).toBeCloseTo(width);
      expect(light.bounds.width).toBeCloseTo(width / 3);
      const solid = getStrokeGeometry({ ...shape([{ x: 0, y: 0, inkPressure: 0 }], width), mode: "solid" });
      // Centerline dots contain a tiny segment with round caps; bounds include it.
      expect(solid.bounds.width).toBeGreaterThanOrEqual(width + 0.01);
      expect(solid.bounds.width).toBeLessThan(width + 0.03);
    }
  });

  it("keeps legacy geometry and reuses cached geometry across appearance/selection changes", () => {
    const points = [{ x: 0, y: 0, pressure: 0.2 }, { x: 30, y: 10, widthRatio: 0.8 }];
    const legacy = { points, strokeWidth: 4 };
    expect(getStrokeGeometry(legacy).outlinePath).toBe(buildVariableWidthStrokePath(points, 4));
    const next = { ...shape([{ x: 0, y: 0, inkPressure: 1 }]), color: "red", opacity: 0 };
    const appearanceChange = { ...next, color: "blue", opacity: 1 };
    expect(getStrokeGeometry(appearanceChange)).toBe(getStrokeGeometry(next));
    expect(getStrokeGeometry({ ...next, strokeWidth: 20 })).not.toBe(getStrokeGeometry(next));
  });

  it("settles only the endpoint on completion and retains Solid endpoint fidelity", () => {
    const points = Array.from({ length: 100 }, (_, i) => ({ x: i, y: Math.sin(i / 8) * 4, inkPressure: 0.6 }));
    const draft = getStrokeGeometry(shape(points), false);
    const final = getStrokeGeometry(shape(points));
    expect(draft.outline.slice(0, 10)).toEqual(final.outline.slice(0, 10));
    expect(final.centerlinePath).toMatch(/ L 99 /);
    const sparse = shape([{ x: 0, y: 0, inkPressure: 0.5 }, { x: 200, y: 0, inkPressure: 0.5 }]);
    expect(getStrokeGeometry(sparse, false).centerlinePath).toMatch(/ L 200 0$/);
    expect(getStrokeGeometry(sparse, false).outlinePath).toBe(getStrokeGeometry(sparse).outlinePath);
  });
});

describe("renderer 2 input dynamics", () => {
  function pressureAt(speed: number, input: "mouse" | "touch" | "pen", pressure: number, dt = 8) {
    const dynamics = createInkDynamics();
    for (let t = 0; t < 1000; t += dt) sampleInkDynamics(dynamics, { x: t * speed, y: 0 }, t, pressure, input);
    return dynamics.inkPressure;
  }
  it("shares mouse/touch simulation while pens respond to force independently of speed", () => {
    expect(pressureAt(2, "touch", 0.5)).toBeCloseTo(pressureAt(2, "mouse", 0.5));
    expect(pressureAt(0.1, "mouse", 0.5)).toBeGreaterThan(pressureAt(2, "mouse", 0.5));
    expect(pressureAt(2, "pen", 0.5)).toBeCloseTo(pressureAt(0.1, "pen", 0.5));
    expect(pressureAt(1, "pen", 0.9)).toBeGreaterThan(pressureAt(1, "pen", 0.01));
    expect(pressureAt(1, "pen", 0)).toBe(0);
    expect(pressureAt(1, "pen", NaN)).toBeGreaterThan(0);
    expect(pressureAt(1, "mouse", 0.5, 4)).toBeCloseTo(pressureAt(1, "mouse", 0.5, 16), 3);
  });

  it("captures stationary pressure and final subpixel endpoints without degenerate duplicates", () => {
    const points: StrokePoint[] = [], dynamics = createInkDynamics();
    const sample = { clientX: 10, clientY: 20, timeStamp: 10, pressure: 0.1 };
    appendInkSample(points, dynamics, "pen", sample, { x: 100, y: 200 }, 0.2);
    appendInkSample(points, dynamics, "pen", { ...sample, pressure: 0.9 }, { x: 100, y: 200 }, 0.2);
    expect(points).toHaveLength(1);
    expect(points[0].pressure).toBe(0.9);
    const pressure = points[0].inkPressure;
    appendInkSample(points, dynamics, "pen", { ...sample, clientX: 10.01, timeStamp: 9, pressure: 0 }, { x: 100.05, y: 200 }, 0.2, true);
    expect(points).toHaveLength(2);
    expect(points[1].inkPressure).toBe(pressure);
    expect(points[1].pressure).toBe(0.9);
    expect(Number.isFinite(points[1].velocity)).toBe(true);
  });
});
