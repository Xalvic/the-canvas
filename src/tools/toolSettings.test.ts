import { describe, expect, it } from "vitest";
import {
  DEFAULT_PEN_SETTINGS,
  DEFAULT_TEXT_SETTINGS,
  parseToolPreferences,
} from "./toolSettings";

describe("tool preferences", () => {
  it("keeps defaults when local data is absent or invalid", () => {
    for (const invalid of [
      null,
      [],
      8,
      "old",
      {
        pen: { mode: "brush", opacity: -1, size: "huge" },
        text: { align: "justify", weight: "light" },
      },
    ]) {
      expect(parseToolPreferences(invalid)).toEqual({
        pen: DEFAULT_PEN_SETTINGS,
        text: DEFAULT_TEXT_SETTINGS,
      });
    }
  });
  it("restores every preference including zero opacity, ignoring unrelated document data", () => {
    const settings = {
      pen: { mode: "solid", color: "#3878d5", size: "xl", opacity: 0 },
      text: {
        color: "#dc4545",
        size: "large",
        opacity: 0.2,
        weight: "bold",
        align: "right",
      },
    };
    expect(
      parseToolPreferences({ ...settings, objects: { ignored: {} } }),
    ).toEqual(settings);
  });
});
