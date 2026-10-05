import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, validateImage } from "./imageValidation.js";

async function image(format: "jpeg" | "png" | "webp", width = 12, height = 7): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: "#3567a9" } }).toFormat(format).toBuffer();
}
describe("untrusted image content", () => {
  it.each(["jpeg", "png", "webp"] as const)("fully decodes %s, reports actual dimensions and strips appended data", async (format) => {
    const input = await image(format);
    const payload = Buffer.from("<script>private tracking payload</script>");
    const result = await validateImage(Buffer.concat([input, payload]), `image/${format}`);
    expect(result).toMatchObject({ mimeType: `image/${format}`, width: 12, height: 7, extension: format === "jpeg" ? "jpg" : format });
    expect(result.size).toBe(result.buffer.length);
    expect(result.buffer.includes(payload)).toBe(false);
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata).toMatchObject({ format, width: 12, height: 7 });
    expect(metadata.exif).toBeUndefined();
  });
  it("applies EXIF orientation before stripping metadata", async () => {
    const input = await sharp(await image("jpeg", 12, 7)).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const result = await validateImage(input, "image/jpeg");
    expect(result).toMatchObject({ width: 7, height: 12 });
    expect((await sharp(result.buffer).metadata()).exif).toBeUndefined();
  });
  it.each([
    [Buffer.alloc(0), "image/png"],
    [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml"],
    [Buffer.from("GIF89a"), "image/gif"],
    [Buffer.from("this is not an image"), "image/jpeg"],
  ])("rejects unsupported actual content", async (buffer, type) => {
    await expect(validateImage(buffer as Buffer, type as string)).rejects.toMatchObject({ code: "unsupported_image" });
  });
  it("rejects spoofed MIME types", async () => {
    await expect(validateImage(await image("png"), "image/jpeg")).rejects.toMatchObject({ code: "unsupported_image" });
    await expect(validateImage(await image("png"), "application/octet-stream")).rejects.toMatchObject({ code: "unsupported_image" });
  });
  it("rejects input over 5 MiB before any decode", async () => {
    await expect(validateImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/png")).rejects.toMatchObject({ code: "image_too_large" });
  });
  it.each(["jpeg", "png", "webp"] as const)("rejects truncated %s payloads", async (format) => {
    const input = await image(format, 100, 100);
    await expect(validateImage(input.subarray(0, Math.floor(input.length / 2)), `image/${format}`)).rejects.toMatchObject({ code: "invalid_image" });
  });
  it("rejects excessive dimensions and decompression pixel counts", async () => {
    await expect(validateImage(await image("png", 4097, 1), "image/png")).rejects.toMatchObject({ code: "invalid_image" });
    await expect(validateImage(await image("png", 4001, 4001), "image/png")).rejects.toMatchObject({ code: "invalid_image" });
  });
  it("rejects APNG even when a PNG decoder would select its first frame", async () => {
    const input = await image("png");
    const chunk = Buffer.alloc(20);
    chunk.writeUInt32BE(8, 0);
    chunk.write("acTL", 4, "ascii");
    chunk.writeUInt32BE(2, 8);
    await expect(validateImage(Buffer.concat([input.subarray(0, 33), chunk, input.subarray(33)]), "image/png"))
      .rejects.toMatchObject({ code: "unsupported_image" });
  });
  it("rejects animated WebP with an actual two-frame payload", async () => {
    const red = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toBuffer();
    const blue = await sharp({ create: { width: 2, height: 2, channels: 4, background: "blue" } }).png().toBuffer();
    const input = await sharp([red, blue], { join: { animated: true } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(input).metadata()).pages).toBe(2);
    await expect(validateImage(input, "image/webp")).rejects.toMatchObject({ code: "unsupported_image" });
  });
});
