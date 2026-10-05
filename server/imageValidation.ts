import sharp from "sharp";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 4096;
export const MAX_IMAGE_PIXELS = 16_000_000;
export type ImageMimeType = "image/jpeg" | "image/png" | "image/webp";
export type ImageExtension = "jpg" | "png" | "webp";
export type ValidatedImage = {
  buffer: Buffer; mimeType: ImageMimeType; extension: ImageExtension;
  width: number; height: number; size: number;
};

export class ImageValidationError extends Error {
  constructor(public readonly code: "image_too_large" | "unsupported_image" | "invalid_image", message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

function sniff(buffer: Buffer): "jpeg" | "png" | "webp" | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/** Some PNG loaders silently select APNG's first frame, so inspect its chunk table too. */
function assertStaticContainer(buffer: Buffer, format: "jpeg" | "png" | "webp"): void {
  if (format === "jpeg") return;
  const png = format === "png";
  const end = png ? buffer.length : buffer.readUInt32LE(4) + 8;
  if (end > buffer.length) throw new Error();
  let offset = png ? 8 : 12;
  let finished = false;
  while (offset < end) {
    if (offset + (png ? 12 : 8) > end) throw new Error();
    const length = png ? buffer.readUInt32BE(offset) : buffer.readUInt32LE(offset + 4);
    const kind = buffer.toString("ascii", png ? offset + 4 : offset, png ? offset + 8 : offset + 4);
    const next = offset + (png ? 12 : 8) + length + (!png && length % 2 ? 1 : 0);
    if (next > end || next <= offset) throw new Error();
    if ((png && kind === "acTL") || (!png && (kind === "ANIM" || kind === "ANMF" ||
        (kind === "VP8X" && length > 0 && (buffer[offset + 8] & 0x02) !== 0)))) {
      throw new ImageValidationError("unsupported_image", "Only static JPEG, PNG, and WebP images are supported");
    }
    offset = next;
    if (png && kind === "IEND") { finished = true; break; }
  }
  if (png && !finished) throw new Error();
}

/** MIME/extension supplied by the browser are never trusted as file validation. */
export async function validateImage(buffer: Buffer, declaredMimeType: string): Promise<ValidatedImage> {
  if (buffer.length > MAX_IMAGE_BYTES) throw new ImageValidationError("image_too_large", "Images must be at most 5 MiB");
  const format = sniff(buffer);
  if (!format) throw new ImageValidationError("unsupported_image", "Only static JPEG, PNG, and WebP images are supported");
  const mimeType = `image/${format}` as ImageMimeType;
  if (declaredMimeType !== mimeType) throw new ImageValidationError("unsupported_image", "Image content must match its JPEG, PNG, or WebP content type");
  try {
    assertStaticContainer(buffer, format);
    const image = sharp(buffer, { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS });
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height ||
        metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION ||
        metadata.width * metadata.height > MAX_IMAGE_PIXELS) {
      throw new ImageValidationError("invalid_image", "Image dimensions must be at most 4096 by 4096 and 16 million pixels");
    }
    // A full decode catches damaged pixel data. Re-encoding removes metadata and appended content;
    // auto-orientation preserves how the original was displayed before stripping its EXIF tag.
    const encoded = await image.rotate().toFormat(format).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
    if (encoded.data.length > MAX_IMAGE_BYTES) throw new ImageValidationError("image_too_large", "Validated image exceeds the 5 MiB storage limit");
    return {
      buffer: encoded.data, mimeType, extension: format === "jpeg" ? "jpg" : format,
      width: encoded.info.width, height: encoded.info.height, size: encoded.data.length,
    };
  } catch (error) {
    if (error instanceof ImageValidationError) throw error;
    throw new ImageValidationError("invalid_image", "Image is damaged, incomplete, or exceeds the supported dimensions");
  }
}
