import type { Point } from "../canvas/viewport/viewportMath";
import { createImageObject } from "../canvas/objects/objectFactories";
import type { ImageCanvasObject } from "../canvas/objects/types";
import { saveAsset } from "./assetStore";
import { decodeImage, getInitialImageSize } from "./imageDecoder";

export type PreparedImageAsset = {
  assetId: string;
  name?: string;
  mimeType: string;
  originalWidth: number;
  originalHeight: number;
  width: number;
  height: number;
};

export async function prepareImageAsset(file: Blob): Promise<PreparedImageAsset> {
  const name = file instanceof File ? file.name : undefined;
  const decoded = await decodeImage(file, name);
  const displaySize = getInitialImageSize(decoded.width, decoded.height);
  const persistentBlob = file.type === decoded.mimeType
    ? file
    : file.slice(0, file.size, decoded.mimeType);
  const assetId = await saveAsset(persistentBlob, {
    name,
    mimeType: decoded.mimeType,
  });
  return {
    assetId,
    name,
    mimeType: decoded.mimeType,
    originalWidth: decoded.width,
    originalHeight: decoded.height,
    ...displaySize,
  };
}

export function createImportedImageObject(
  asset: PreparedImageAsset,
  center: Point,
  zIndex: number,
): ImageCanvasObject {
  return createImageObject({
    assetId: asset.assetId,
    center,
    width: asset.width,
    height: asset.height,
    originalWidth: asset.originalWidth,
    originalHeight: asset.originalHeight,
    name: asset.name,
    mimeType: asset.mimeType,
    zIndex,
  });
}

function fileFromItem(item: DataTransferItem): File | null {
  return item.kind === "file" ? item.getAsFile() : null;
}

export function getClipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = [
    ...[...data.items]
    .map(fileFromItem)
    .filter((file): file is File => file !== null),
    ...data.files,
  ].filter(
      (file) =>
        file.type.toLowerCase().startsWith("image/") ||
        /\.(png|jpe?g|webp|gif)$/i.test(file.name),
  );
  const seen = new Set<string>();
  return files.filter((file) => {
    const fingerprint = [
      file.name,
      file.type,
      file.size,
      file.lastModified,
    ].join(":");
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

export function getDroppedFiles(data: DataTransfer): File[] {
  return [...data.files];
}
