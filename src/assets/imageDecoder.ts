export const MAX_IMAGE_FILE_SIZE = 20 * 1024 * 1024;
export const MAX_INITIAL_IMAGE_WIDTH = 480;
export const MAX_INITIAL_IMAGE_HEIGHT = 360;

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const SUPPORTED_IMAGE_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

export type DecodedImageInfo = {
  width: number;
  height: number;
  mimeType: string;
};

export function resolveImageMimeType(blob: Blob, name?: string): string | null {
  const blobType = blob.type.toLowerCase();
  if (SUPPORTED_IMAGE_TYPES.has(blobType)) return blobType;
  const extension = name?.split(".").at(-1)?.toLowerCase();
  return extension ? MIME_BY_EXTENSION[extension] ?? null : null;
}

export function getInitialImageSize(
  originalWidth: number,
  originalHeight: number,
): { width: number; height: number } {
  const scale = Math.min(
    1,
    MAX_INITIAL_IMAGE_WIDTH / originalWidth,
    MAX_INITIAL_IMAGE_HEIGHT / originalHeight,
  );
  return {
    width: originalWidth * scale,
    height: originalHeight * scale,
  };
}

function decodeWithImageElement(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const source = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const dimensions = {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      URL.revokeObjectURL(source);
      resolve(dimensions);
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error("The image could not be decoded"));
    };
    image.src = source;
  });
}

export async function decodeImage(
  blob: Blob,
  name?: string,
): Promise<DecodedImageInfo> {
  const mimeType = resolveImageMimeType(blob, name);
  if (!mimeType) {
    throw new Error("Only PNG, JPEG, WEBP, and GIF images are supported");
  }
  if (blob.size > MAX_IMAGE_FILE_SIZE) {
    throw new Error(`${name || "Image"} is larger than the 20 MB limit`);
  }

  let dimensions: { width: number; height: number };
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
    } catch {
      dimensions = await decodeWithImageElement(blob);
    }
  } else {
    dimensions = await decodeWithImageElement(blob);
  }

  if (dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error("The image has invalid dimensions");
  }
  return { ...dimensions, mimeType };
}
