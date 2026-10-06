// Local tests only. Provider state lives in a separate HTTP fixture, surviving
// API process restarts and sharing the immutable-path behavior of ImageKit.
import type { ImageStorage, StoredImage } from "../imageKit.js";

export function createControlledImageStorage(providerUrl: string): ImageStorage {
  const url = new URL(providerUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") throw new Error("Loopback provider fixture required");
  async function call(path: string, body?: Buffer): Promise<StoredImage | null> {
    const response = await fetch(`${providerUrl}/file?path=${encodeURIComponent(path)}`, {
      method: body ? "POST" : "GET", ...(body ? { body, headers: { "Content-Type": "application/octet-stream" } } : {}), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Controlled provider unavailable");
    return response.json() as Promise<StoredImage | null>;
  }
  return {
    pathFor: (target) => `/scribble/test/${target.boardId}/${target.assetId}.${target.extension}`,
    async upload(buffer, target) { const file = await call(this.pathFor(target), buffer); if (!file) throw new Error("No provider file"); return file; },
    find: (path) => call(path),
    sign: () => "https://ik.imagekit.io/controlled/image?ik-s=test",
    async delete(fileId) {
      const response = await fetch(`${providerUrl}/file/${fileId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Controlled deletion failed");
    },
  };
}
