import { describe, expect, it } from "vitest";
import { boundsIntersect, getCombinedBounds } from "./geometry";
import { createCardObject, createTextObject } from "../canvas/objects/objectFactories";

describe("geometry helpers", () => {
  it("detects overlap and edge contact", () => {
    const target = { left: 10, top: 10, right: 30, bottom: 30 };

    expect(
      boundsIntersect(target, { left: 20, top: 20, right: 40, bottom: 40 }),
    ).toBe(true);
    expect(
      boundsIntersect(target, { left: 30, top: 14, right: 50, bottom: 20 }),
    ).toBe(true);
    expect(
      boundsIntersect(target, { left: 31, top: 10, right: 50, bottom: 30 }),
    ).toBe(false);
  });

  it("combines object bounds in world coordinates", () => {
    const text = createTextObject({ x: -100, y: -40 }, 1);
    const card = createCardObject({ x: 300, y: 200 }, 2);

    expect(getCombinedBounds([text, card])).toEqual({
      left: -100,
      top: -66,
      right: 424,
      bottom: 340,
    });
  });

  it("returns null when no objects are supplied", () => {
    expect(getCombinedBounds([])).toBeNull();
  });
});
