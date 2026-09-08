import { describe, expect, it } from "vitest";
import { createConnectorObject } from "./connectorFactories";

describe("connector factory", () => {
  const from = { objectId: "from", anchor: "right" } as const;
  const to = { objectId: "to", anchor: "left" } as const;

  it("creates a directional connector by default", () => {
    expect(createConnectorObject(from, to, 4)).toMatchObject({
      type: "connector",
      from,
      to,
      directed: true,
      zIndex: 4,
    });
  });

  it("can create a non-directional connector", () => {
    expect(createConnectorObject(from, to, 4, false).directed).toBe(false);
  });
});
