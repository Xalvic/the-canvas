import { describe, expect, it } from "vitest";
import { createCardObject } from "../objects/objectFactories";
import {
  buildConnectorPath,
  getAnchorPoint,
  getEndpointPoint,
  inferAnchorToward,
} from "./connectorGeometry";

describe("connector geometry", () => {
  const card = {
    ...createCardObject({ x: 224, y: 232 }, 1),
    id: "card-1",
    x: 100,
    y: 200,
    width: 248,
    height: 172,
  };

  it("resolves all four anchors from live object geometry", () => {
    expect(getAnchorPoint(card, "top")).toEqual({ x: 224, y: 200 });
    expect(getAnchorPoint(card, "right")).toEqual({ x: 348, y: 286 });
    expect(getAnchorPoint(card, "bottom")).toEqual({ x: 224, y: 372 });
    expect(getAnchorPoint(card, "left")).toEqual({ x: 100, y: 286 });
  });

  it("resolves referenced endpoints and rejects missing nodes", () => {
    expect(
      getEndpointPoint(
        { objectId: card.id, anchor: "right" },
        { [card.id]: card },
      ),
    ).toEqual({ x: 348, y: 286 });
    expect(
      getEndpointPoint({ objectId: "missing", anchor: "left" }, {}),
    ).toBeNull();
  });

  it("infers the dominant direction and creates a stable Bezier route", () => {
    expect(inferAnchorToward({ x: 0, y: 0 }, { x: 90, y: 20 })).toBe(
      "right",
    );
    expect(inferAnchorToward({ x: 0, y: 0 }, { x: -10, y: -80 })).toBe(
      "top",
    );
    expect(
      buildConnectorPath(
        { x: 100, y: 0 },
        { x: 300, y: 0 },
        "right",
        "left",
      ),
    ).toBe("M 100 0 C 192 0, 208 0, 300 0");
  });
});
