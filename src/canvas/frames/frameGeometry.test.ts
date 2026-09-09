import { describe, expect, it } from "vitest";
import {
  createCardObject,
  createFrameObject,
} from "../objects/objectFactories";
import { frameContainsObject, getContainedObjectIds } from "./frameGeometry";

describe("frame containment", () => {
  const frame = {
    ...createFrameObject(
      { left: 0, top: 0, right: 600, bottom: 400 },
      1,
    ),
    id: "frame",
  };
  const inside = {
    ...createCardObject({ x: 220, y: 160 }, 2),
    id: "inside",
    x: 80,
    y: 80,
  };
  const crossing = {
    ...createCardObject({ x: 600, y: 160 }, 3),
    id: "crossing",
    x: 500,
    y: 80,
  };

  it("contains only nodes fully enclosed by the frame", () => {
    expect(frameContainsObject(frame, inside)).toBe(true);
    expect(frameContainsObject(frame, crossing)).toBe(false);
    expect(frameContainsObject(frame, frame)).toBe(false);
  });

  it("lists enclosed object IDs", () => {
    expect(
      getContainedObjectIds(frame, {
        [frame.id]: frame,
        [inside.id]: inside,
        [crossing.id]: crossing,
      }),
    ).toEqual([inside.id]);
  });
});
