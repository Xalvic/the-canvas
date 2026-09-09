import { describe, expect, it } from "vitest";
import {
  getProportionalImageSize,
  MIN_IMAGE_SIZE,
} from "./imageGeometry";

describe("image resize geometry", () => {
  it("uses the dominant pointer axis while preserving aspect ratio", () => {
    expect(getProportionalImageSize(400, 200, 100, 10)).toEqual({
      width: 500,
      height: 250,
    });
    expect(getProportionalImageSize(400, 200, 10, 100)).toEqual({
      width: 600,
      height: 300,
    });
  });

  it("keeps both dimensions above the minimum size", () => {
    const result = getProportionalImageSize(400, 100, -1000, -1000);
    expect(result.width).toBe(128);
    expect(result.height).toBe(MIN_IMAGE_SIZE);
  });
});
