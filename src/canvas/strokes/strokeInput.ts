import type { Point } from "../viewport/viewportMath";
import type { StrokeInputKind, StrokePoint } from "../objects/types";
import { sampleInkDynamics, type InkDynamics } from "./strokeDynamics";

// Touch styluses and fingers cannot be distinguished reliably. A second contact
// may promote only a just-started, nearly stationary draft to navigation.
export const TOUCH_GESTURE_START_MS = 160;
export const TOUCH_GESTURE_START_DISTANCE = 6;

export type StrokeContact = {
  pointerType: string;
  startedAt: number;
  travel: number;
  lastClientPoint: Point;
};

export function isProvisionalTouch(contact: StrokeContact, time: number): boolean {
  return contact.pointerType === "touch" &&
    time >= contact.startedAt && time - contact.startedAt <= TOUCH_GESTURE_START_MS &&
    contact.travel <= TOUCH_GESTURE_START_DISTANCE;
}

export function trackStrokeTravel(contact: StrokeContact, point: Point) {
  contact.travel += Math.hypot(
    point.x - contact.lastClientPoint.x, point.y - contact.lastClientPoint.y,
  );
  contact.lastClientPoint = point;
}

export function getConfirmedPointerSamples(event: PointerEvent): PointerEvent[] {
  // Some insecure origins / browsers omit this optional API altogether.
  const samples = event.type === "pointermove" ? event.getCoalescedEvents?.() : undefined;
  return samples?.length ? samples : [event];
}

export function appendInkSample(
  points: StrokePoint[], dynamics: InkDynamics, input: StrokeInputKind,
  sample: Pick<PointerEvent, "clientX" | "clientY" | "pressure" | "timeStamp">,
  world: Point, zoom: number, ending = false,
): boolean {
  const values = sampleInkDynamics(dynamics, { x: sample.clientX, y: sample.clientY }, sample.timeStamp, sample.pressure, input, ending);
  const previous = points.at(-1);
  const distance = previous ? Math.hypot(world.x - previous.x, world.y - previous.y) * zoom : Infinity;
  const pressureChanged = previous && Math.abs((previous.inkPressure ?? 0.5) - values.inkPressure!) >= 0.01;
  if (distance === 0) {
    if (pressureChanged && !ending) Object.assign(previous!, values);
    return !!pressureChanged && !ending;
  }
  // Capture fidelity is independent of rendering simplification. Final real
  // movement always survives; subpixel force changes survive without duplicates.
  if (!ending && distance < 0.15 && !pressureChanged) return false;
  points.push({ ...world, ...values });
  return true;
}
