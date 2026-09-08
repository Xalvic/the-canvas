import { describe, expect, it } from "vitest";
import { createCardObject, createTextObject } from "./objectFactories";

describe("canvas object factories", () => {
  it("creates a text object around the requested world position", () => {
    const object = createTextObject({ x: -240, y: 160 }, 4);

    expect(object).toMatchObject({
      type: "text",
      x: -240,
      y: 134,
      width: 220,
      height: 52,
      zIndex: 4,
    });
    expect(object.id).toBeTruthy();
  });

  it("creates a card centered horizontally near the requested world position", () => {
    const object = createCardObject({ x: 500, y: -80 }, 9);

    expect(object).toMatchObject({
      type: "card",
      x: 376,
      y: -112,
      width: 248,
      height: 172,
      zIndex: 9,
    });
    expect(object.createdAt).toBe(object.updatedAt);
  });
});
