import type { StrokeInputKind, StrokePoint } from "../objects/types";
import type { Point } from "../viewport/viewportMath";

export type StrokeDynamics = {
  previous: { point: Point; time: number } | null;
  velocity: number;
  widthRatio: number;
};

export function createStrokeDynamics(): StrokeDynamics {
  return { previous: null, velocity: 0, widthRatio: 0.65 };
}

export type InkDynamics = {
  previous: { point: Point; time: number } | null;
  velocity: number;
  inkPressure: number;
  pressure: number;
};

export function createInkDynamics(): InkDynamics {
  return { previous: null, velocity: 0, inkPressure: 0.5, pressure: 0.5 };
}

export function strokeInputKind(pointerType: string): StrokeInputKind {
  return pointerType === "pen" || pointerType === "touch" ? pointerType : "mouse";
}

// Capture-time screen speed owns synthetic thickness. The renderer disables
// library simulation, avoiding spacing/zoom sensitivity and double thinning.
export function sampleInkDynamics(
  state: InkDynamics, point: Point, time: number, pressure: number,
  input: StrokeInputKind, ending = false,
): Pick<StrokePoint, "pressure" | "velocity" | "inkPressure"> {
  const safeTime = Number.isFinite(time) ? Math.max(time, state.previous?.time ?? time) : state.previous?.time ?? 0;
  const elapsed = state.previous ? Math.max(1, safeTime - state.previous.time) : 16;
  const distance = state.previous ? Math.hypot(point.x - state.previous.point.x, point.y - state.previous.point.y) : 0;
  const velocity = Math.min(6, distance / elapsed);
  state.velocity += (velocity - state.velocity) * (1 - Math.exp(-elapsed / 32));
  const force = input === "pen" && !ending && Number.isFinite(pressure) && pressure >= 0
    ? Math.min(1, pressure) : input === "pen" ? state.pressure : 0.5;
  const target = input === "pen" ? Math.pow(force, 0.65)
    : 0.12 + 0.88 / (1 + (state.velocity / 0.8) ** 1.5);
  if (!state.previous) state.inkPressure = target;
  // A stationary force change must be visible even when timestamps coincide.
  else if (input === "pen" && distance === 0) state.inkPressure = target;
  else if (!ending) state.inkPressure += (target - state.inkPressure) * (1 - Math.exp(-elapsed / (input === "pen" ? 12 : 42)));
  state.pressure = force;
  state.previous = { point, time: safeTime };
  return { pressure: force, velocity: state.velocity, inkPressure: state.inkPressure };
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
