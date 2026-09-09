import { describe, expect, it } from "vitest";
import {
  createCardObject,
  createFrameObject,
} from "../objects/objectFactories";
import { createStrokeObject } from "../strokes/strokeFactories";
import {
  expandIdsToGroups,
  getMovementIds,
  toggleObjectOrGroup,
} from "./grouping";

describe("basic grouping", () => {
  const first = {
    ...createCardObject({ x: 180, y: 160 }, 2),
    id: "first",
    x: 80,
    y: 80,
    groupId: "group-1",
  };
  const second = {
    ...createCardObject({ x: 780, y: 160 }, 3),
    id: "second",
    x: 680,
    y: 80,
    groupId: "group-1",
  };
  const frame = {
    ...createFrameObject(
      { left: 0, top: 0, right: 600, bottom: 400 },
      1,
    ),
    id: "frame",
  };
  const stroke = {
    ...createStrokeObject(
      [
        { x: 120, y: 260, pressure: 0.5 },
        { x: 300, y: 310, pressure: 0.5 },
      ],
      4,
    ),
    id: "stroke",
  };
  const objects = {
    [frame.id]: frame,
    [first.id]: first,
    [second.id]: second,
    [stroke.id]: stroke,
  };

  it("expands one group member to the complete flat group", () => {
    expect(expandIdsToGroups([first.id], objects)).toEqual(
      new Set([first.id, second.id]),
    );
  });

  it("toggles a group atomically", () => {
    expect(toggleObjectOrGroup([], first.id, objects)).toEqual(
      new Set([first.id, second.id]),
    );
    expect(
      toggleObjectOrGroup([first.id, second.id], first.id, objects),
    ).toEqual(new Set());
  });

  it("moves frame contents and preserves their group", () => {
    expect(getMovementIds([frame.id], objects)).toEqual(
      new Set([frame.id, first.id, stroke.id, second.id]),
    );
    expect(
      getMovementIds([frame.id], {
        ...objects,
        [frame.id]: { ...frame, moveContents: false },
      }),
    ).toEqual(new Set([frame.id]));
  });
});
