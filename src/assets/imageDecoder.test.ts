import { describe, expect, it } from "vitest";
import {
  getInitialImageSize,
  MAX_IMAGE_FILE_SIZE,
  resolveImageMimeType,
} from "./imageDecoder";

describe("image import sizing and validation", () => {
  it("resolves supported MIME types with a filename fallback", () => {
    expect(resolveImageMimeType(new Blob([], { type: "image/png" }))).toBe(
      "image/png",
    );
    expect(resolveImageMimeType(new Blob([]), "photo.JPG")).toBe(
      "image/jpeg",
    );
    expect(resolveImageMimeType(new Blob([]), "vector.svg")).toBeNull();
  });

  it("fits large images inside the initial bounds without upscaling", () => {
    expect(getInitialImageSize(1600, 1200)).toEqual({
      width: 480,
      height: 360,
    });
    expect(getInitialImageSize(240, 120)).toEqual({
      width: 240,
      height: 120,
    });
  });

  it("uses a 20 MB file-size limit", () => {
    expect(MAX_IMAGE_FILE_SIZE).toBe(20 * 1024 * 1024);
  });
});
