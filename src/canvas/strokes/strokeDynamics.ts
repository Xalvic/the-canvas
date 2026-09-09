import type { StrokePoint } from "../objects/types";
import type { Point } from "../viewport/viewportMath";

export type StrokeDynamics = {
  previous: { point: Point; time: number } | null;
  velocity: number;
  widthRatio: number;
};

export function createStrokeDynamics(): StrokeDynamics {
  return { previous: null, velocity: 0, widthRatio: 0.65 };
}

// Screen pixels / ms keeps the feel consistent across zoom levels. Time-based
// smoothing makes mouse, touch and coalesced stylus samples behave alike.
export function sampleStrokeDynamics(
  state: StrokeDynamics,
  point: Point,
  time: number,
  pressure: number,
  pointerType: string,
): Pick<StrokePoint, "pressure" | "velocity" | "widthRatio"> {
  const elapsed = state.previous ? Math.max(1, time - state.previous.time) : 16;
  const distance = state.previous
    ? Math.hypot(
        point.x - state.previous.point.x,
        point.y - state.previous.point.y,
      )
    : 0;
  const velocity = Math.min(6, distance / elapsed);
  state.velocity += (velocity - state.velocity) * (1 - Math.exp(-elapsed / 32));
  // Mouse pressure is a synthetic 0.5. Touch defaults to that value as well;
  // use real force when the device reports it, falling back to velocity alone.
  const hasPressure =
    pointerType !== "mouse" && Number.isFinite(pressure) && pressure > 0;
  const normalizedPressure = hasPressure ? Math.min(1, pressure) : 0.5;
  const speedWidth = 0.24 + 0.76 / (1 + (state.velocity / 0.65) ** 1.5);
  const pressureScale = hasPressure ? 0.42 + normalizedPressure * 0.58 : 1;
  const target = Math.max(0.12, speedWidth * pressureScale);
  if (!state.previous) state.widthRatio = target;
  else
    state.widthRatio +=
      (target - state.widthRatio) * (1 - Math.exp(-elapsed / 42));
  state.previous = { point, time };
  return {
    pressure: normalizedPressure,
    velocity: state.velocity,
    widthRatio: state.widthRatio,
  };
}
