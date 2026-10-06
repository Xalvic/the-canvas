import { expect, it } from "vitest";
import { getConfirmedPointerSamples, isProvisionalTouch, trackStrokeTravel } from "./strokeInput";

it("only promotes a newly started touch; drawing a loop establishes ownership", () => {
  const contact = { pointerType: "touch", startedAt: 10, travel: 0, lastClientPoint: { x: 0, y: 0 } };
  expect(isProvisionalTouch(contact, 100)).toBe(true);
  expect(isProvisionalTouch(contact, 171)).toBe(false);
  trackStrokeTravel(contact, { x: 4, y: 0 });
  trackStrokeTravel(contact, { x: 0, y: 0 });
  expect(isProvisionalTouch(contact, 100)).toBe(false);
  expect(isProvisionalTouch({ ...contact, pointerType: "pen", travel: 0 }, 100)).toBe(false);
});

it("uses coalesced samples once, retains up endpoints, and falls back without the API", () => {
  const first = {} as PointerEvent;
  const second = {} as PointerEvent;
  const event = { type: "pointermove", getCoalescedEvents: () => [first, second] } as PointerEvent;
  expect(getConfirmedPointerSamples(event)).toEqual([first, second]);
  const up = { ...event, type: "pointerup" } as PointerEvent;
  expect(getConfirmedPointerSamples(up)).toEqual([up]);
  const ordinary = { type: "pointermove" } as PointerEvent;
  expect(getConfirmedPointerSamples(ordinary)).toEqual([ordinary]);
});
