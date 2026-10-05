import { randomUUID } from "node:crypto";
import { publicAsset, type AssetStore } from "./assets.js";
import { HttpError } from "./errors.js";
import { IMAGE_URL_TTL_SECONDS, type ImageStorage } from "./imageKit.js";
import { ImageValidationError, validateImage } from "./imageValidation.js";

export function createImageAssetService(store: AssetStore, storage: ImageStorage | null) {
  function configured(): ImageStorage {
    if (!storage) throw new HttpError(503, "IMAGE_STORAGE_UNAVAILABLE", "Cloud images are disabled until backend ImageKit settings are configured");
    return storage;
  }
  return {
    async authorizeUpload(boardId: string, userId: string) {
      configured();
      await store.assertCanUpload(boardId, userId);
    },
    async upload(boardId: string, userId: string, buffer: Buffer, declaredType: string) {
      const provider = configured();
      const image = await validateImage(buffer, declaredType).catch((error: unknown) => {
        if (!(error instanceof ImageValidationError)) throw error;
        if (error.code === "image_too_large") throw new HttpError(413, "PAYLOAD_TOO_LARGE", error.message);
        if (error.code === "unsupported_image") throw new HttpError(415, "UNSUPPORTED_IMAGE_TYPE", error.message);
        throw new HttpError(422, "INVALID_IMAGE", error.message);
      });
      const target = { assetId: randomUUID(), boardId, mimeType: image.mimeType, extension: image.extension };
      const reservation = await store.reserve(boardId, userId, {
        id: target.assetId, byteSize: image.size, mimeType: image.mimeType,
        width: image.width, height: image.height, filePath: provider.pathFor(target),
      });
      try {
        const file = await provider.upload(image.buffer, target);
        const ready = await store.finalize(reservation.id, userId, file);
        return publicAsset(ready);
      } catch (error) {
        // An upload may have reached ImageKit even when its response was lost.
        // Keep the durable reservation and exact path for delayed reconciliation;
        // never release quota or delete a potentially committed asset here.
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, "ASSET_UPLOAD_FAILED", "Image upload could not be completed. The board document was not changed");
      }
    },
    async read(boardId: string, assetId: string, userId: string) {
      const provider = configured();
      const asset = await store.getForRead(boardId, assetId, userId);
      const expiresAt = Math.floor(Date.now() / 1000) + IMAGE_URL_TTL_SECONDS;
      try {
        // Signing is synchronous: no provider request or cached permission check
        // sits between the current-access transaction and signature generation.
        return { ...publicAsset(asset), url: provider.sign(asset.filePath, expiresAt), expiresAt: expiresAt * 1000 };
      } catch {
        throw new HttpError(503, "ASSET_SIGNING_FAILED", "Image access could not be prepared. Retry later");
      }
    },
    async cleanup(limit = 20) {
      const provider = configured();
      const assets = await store.claimAbandoned(limit);
      let deleted = 0;
      for (const asset of assets) {
        try {
          const file = asset.fileId ? { fileId: asset.fileId } : await provider.find(asset.filePath);
          if (file) await provider.delete(file.fileId);
          await store.finishDelete(asset.id);
          deleted++;
        } catch {
          // Keep the reservation and deleting lease so a later run can retry.
        }
      }
      return { claimed: assets.length, deleted, deferred: assets.length - deleted };
    },
  };
}
export type ImageAssetService = ReturnType<typeof createImageAssetService>;

// Bound buffers/decode work even for invalid requests, before body parsing.
// Durable PostgreSQL limits additionally survive restarts and multiple servers.
export function createUploadGate() {
  let active = 0;
  const users = new Map<string, { active: boolean; count: number; startedAt: number }>();
  return (userId: string) => {
    const now = Date.now();
    for (const [id, state] of users) if (!state.active && state.startedAt <= now - 3_600_000) users.delete(id);
    const state = users.get(userId) ?? { active: false, count: 0, startedAt: now };
    if (state.active || state.count >= 10 || active >= 2 || users.size >= 4096 && !users.has(userId)) {
      throw new HttpError(429, "ASSET_UPLOAD_RATE_LIMIT", "Image upload limit reached. Retry later");
    }
    users.set(userId, state);
    state.active = true;
    state.count++;
    active++;
    return () => { state.active = false; active--; };
  };
}
