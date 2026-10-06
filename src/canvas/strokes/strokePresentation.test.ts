import { expect, it } from "vitest";
import { chooseStrokeDetail, simpleStrokeWidth, strokeZoomBucket } from "./strokePresentation";

it("simplifies thin low-zoom ink with hysteresis and restores full detail", () => {
  expect(chooseStrokeDetail(4, "pen", 0.2)).toBe(true);
  expect(chooseStrokeDetail(4, "touch", 0.35)).toBe(true);
  expect(chooseStrokeDetail(20, "mouse", 0.2)).toBe(false);
  expect(chooseStrokeDetail(4, "pen", 0.51, true)).toBe(true);
  expect(chooseStrokeDetail(4, "pen", 0.51, false)).toBe(false);
  expect(chooseStrokeDetail(4, "pen", 0.56, true)).toBe(false);
  expect(chooseStrokeDetail(4, "pen", 1, true)).toBe(false);
  expect(simpleStrokeWidth(4, "pen") * 0.2).toBeLessThan(0.85);
  expect(strokeZoomBucket(0.213)).toBe(0.21);
  expect(strokeZoomBucket(1.5)).toBe(1);
});
