import ImageKit, { toFile } from "@imagekit/nodejs";
import type { ImageKitConfig } from "./imageConfig.js";
import { MAX_IMAGE_BYTES, type ImageExtension, type ImageMimeType } from "./imageValidation.js";

export const IMAGE_URL_TTL_SECONDS = 300;
export type ImageUploadTarget = { assetId: string; boardId: string; mimeType: ImageMimeType; extension: ImageExtension };
export type StoredImage = { fileId: string; filePath: string; size: number };
export interface ImageStorage {
  pathFor(target: ImageUploadTarget): string;
  // Create at this exact immutable path. Reject an existing file; never rename,
  // overwrite or create another version. M5 retry safety depends on this guarantee.
  upload(buffer: Buffer, target: ImageUploadTarget): Promise<StoredImage>;
  sign(filePath: string, expiresAtUnixSeconds: number): string;
  delete(fileId: string): Promise<void>;
  find(filePath: string): Promise<StoredImage | null>;
}

/** Provider messages/headers may contain private information; only expose this safe error. */
export class ImageStorageError extends Error {
  constructor(public readonly operation: "upload" | "read" | "delete" | "sign") {
    super(`Image storage ${operation} failed; retry later or check the backend ImageKit configuration`);
    this.name = "ImageStorageError";
  }
}

export function createImageKitStorage(config: ImageKitConfig): ImageStorage {
  const client = new ImageKit({ privateKey: config.privateKey, timeout: 30_000, maxRetries: 0, logLevel: "off" });
  const prefix = `/${config.folder}/`;
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const ownedPath = new RegExp(`^${prefix}${uuid}/${uuid}\\.(jpg|png|webp)$`, "i");
  function assertPath(path: string): void {
    if (!ownedPath.test(path)) throw new ImageStorageError("read");
  }
  function stored(value: { fileId?: string; filePath?: string; size?: number; isPrivateFile?: boolean }, expected: string): StoredImage {
    if (!value.fileId || !/^[A-Za-z0-9_-]{1,128}$/.test(value.fileId) || value.filePath !== expected || value.isPrivateFile !== true ||
        !Number.isSafeInteger(value.size) || value.size! < 1 || value.size! > MAX_IMAGE_BYTES) throw new ImageStorageError("upload");
    return { fileId: value.fileId, filePath: expected, size: value.size! };
  }
  return {
    pathFor(target) {
      const filePath = `${prefix}${target.boardId}/${target.assetId}.${target.extension}`;
      assertPath(filePath);
      return filePath;
    },
    async upload(buffer, target) {
      const filePath = this.pathFor(target);
      const fileName = `${target.assetId}.${target.extension}`;
      try {
        const response = await client.files.upload({
          file: await toFile(buffer, fileName, { type: target.mimeType }), fileName,
          folder: `${prefix}${target.boardId}`, useUniqueFileName: false, overwriteFile: false,
          isPrivateFile: true, responseFields: ["isPrivateFile"],
        });
        const result = stored(response, filePath);
        if (result.size !== buffer.length) throw new ImageStorageError("upload");
        return result;
      } catch { throw new ImageStorageError("upload"); }
    },
    sign(filePath, expiresAtUnixSeconds) {
      assertPath(filePath);
      const ttl = expiresAtUnixSeconds - Math.floor(Date.now() / 1000);
      if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > IMAGE_URL_TTL_SECONDS) throw new ImageStorageError("sign");
      try {
        const url = client.helper.buildSrc({ urlEndpoint: config.urlEndpoint, src: filePath, signed: true, expiresIn: ttl });
        if (!new URL(url).searchParams.get("ik-s")) throw new Error();
        return url;
      } catch { throw new ImageStorageError("sign"); }
    },
    async delete(fileId) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(fileId)) throw new ImageStorageError("delete");
      try { await client.files.delete(fileId); }
      catch (error) { if (!(error instanceof ImageKit.NotFoundError)) throw new ImageStorageError("delete"); }
    },
    async find(filePath) {
      assertPath(filePath);
      const slash = filePath.lastIndexOf("/");
      try {
        const files = await client.assets.list({
          path: filePath.slice(0, slash + 1), searchQuery: `name = "${filePath.slice(slash + 1)}"`, limit: 2,
        });
        const matches = files.filter((file): file is ImageKit.File => "filePath" in file && file.filePath === filePath);
        if (matches.length > 1) throw new Error();
        return matches.length ? stored(matches[0], filePath) : null;
      } catch { throw new ImageStorageError("read"); }
    },
  };
}
