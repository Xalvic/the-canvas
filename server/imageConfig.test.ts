import { describe, expect, it } from "vitest";
import { loadImageKitConfig } from "./imageConfig.js";

const complete = {
  IMAGEKIT_PRIVATE_KEY: "private_SENSITIVE_TEST_VALUE",
  IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/scribblemilan/",
  IMAGEKIT_FOLDER: "scribble/dev",
};
describe("ImageKit backend configuration", () => {
  it("disables cleanly with no variables and normalizes a complete configuration", () => {
    expect(loadImageKitConfig({})).toBeNull();
    expect(loadImageKitConfig(complete)).toEqual({ privateKey: complete.IMAGEKIT_PRIVATE_KEY, urlEndpoint: "https://ik.imagekit.io/scribblemilan", folder: "scribble/dev" });
    expect(loadImageKitConfig({ ...complete, IMAGEKIT_FOLDER: "/scribble/dev/" })?.folder).toBe("scribble/dev");
  });
  it.each([
    { IMAGEKIT_PRIVATE_KEY: complete.IMAGEKIT_PRIVATE_KEY },
    { ...complete, IMAGEKIT_PRIVATE_KEY: "public_not_private" },
    { ...complete, IMAGEKIT_PRIVATE_KEY: "private_ secret with spaces" },
    { ...complete, IMAGEKIT_FOLDER: " " },
    { ...complete, IMAGEKIT_FOLDER: "scribble/../dev" },
    { ...complete, IMAGEKIT_FOLDER: "scribble\\dev" },
    { ...complete, IMAGEKIT_URL_ENDPOINT: "http://ik.imagekit.io/scribblemilan" },
    { ...complete, IMAGEKIT_URL_ENDPOINT: "https://user:secret@ik.imagekit.io/scribblemilan" },
    { ...complete, IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/scribblemilan?secret=value" },
    { ...complete, IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/scribblemilan#fragment" },
  ])("rejects partial/unsafe configuration without revealing values", (env) => {
    expect(() => loadImageKitConfig(env)).toThrow(/IMAGEKIT_PRIVATE_KEY.*IMAGEKIT_URL_ENDPOINT.*IMAGEKIT_FOLDER/);
    try { loadImageKitConfig(env); } catch (error) { expect(String(error)).not.toContain("SENSITIVE_TEST_VALUE"); }
  });
});
