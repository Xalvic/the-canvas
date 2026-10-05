import { z } from "zod";
import { BoardApiError, boardRequest, parseResponse } from "./boards";

export const MAX_CLOUD_IMAGE_BYTES = 5 * 1024 * 1024;
const mimeType = z.enum(["image/jpeg", "image/png", "image/webp"]);
const assetSchema = z.object({
  id: z.uuid(), boardId: z.uuid(), mimeType,
  byteSize: z.number().int().positive().max(MAX_CLOUD_IMAGE_BYTES),
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
  createdAt: z.number().finite().nonnegative(),
}).refine((asset) => asset.width * asset.height <= 16_000_000);
const signedAssetSchema = assetSchema.safeExtend({
  url: z.url().refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === "https:" ||
      (import.meta.env.MODE === "test" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)));
  }),
  expiresAt: z.number().finite().positive(),
});
export type BoardAsset = z.output<typeof assetSchema>;
export type SignedBoardAsset = z.output<typeof signedAssetSchema>;

function assetsUrl(boardId: string) {
  return `/api/boards/${encodeURIComponent(z.uuid().parse(boardId))}/assets`;
}
function invalid(message: string): never {
  throw new BoardApiError(200, "INVALID_RESPONSE", message);
}

export async function uploadBoardAsset(boardId: string, blob: Blob, signal?: AbortSignal): Promise<BoardAsset> {
  const type = mimeType.safeParse(blob.type);
  if (!type.success || blob.size < 1 || blob.size > MAX_CLOUD_IMAGE_BYTES) {
    throw new Error("Cloud images must be JPEG, PNG or WebP and at most 5 MiB");
  }
  const response = await boardRequest(assetsUrl(boardId), {
    method: "POST", headers: { "X-Scribble-Request": "1", "Content-Type": type.data }, body: blob,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
  }, "Could not upload image");
  const { asset } = await parseResponse(response, z.object({ asset: assetSchema }));
  if (response.status !== 201 || asset.boardId !== boardId) invalid("The server returned a different image board");
  return asset;
}

export async function getBoardAsset(boardId: string, assetId: string, signal?: AbortSignal): Promise<SignedBoardAsset> {
  const response = await boardRequest(`${assetsUrl(boardId)}/${encodeURIComponent(z.uuid().parse(assetId))}`, {
    signal, cache: "no-store",
  }, "Could not access image");
  const { asset } = await parseResponse(response, z.object({ asset: signedAssetSchema }));
  if (asset.boardId !== boardId || asset.id !== assetId || asset.expiresAt <= Date.now() || asset.expiresAt > Date.now() + 310_000) {
    invalid("The server returned an invalid image identity or expiry");
  }
  return asset;
}

// Used only during an explicit account copy/upload. Remote bytes never enter IndexedDB.
export async function downloadBoardAsset(boardId: string, assetId: string, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  const asset = await getBoardAsset(boardId, assetId, signal);
  signal?.throwIfAborted();
  const response = await fetch(asset.url, { signal, credentials: "omit", cache: "no-store", redirect: "error" });
  if (!response.ok || response.headers.get("content-type")?.split(";")[0].trim() !== asset.mimeType) {
    throw new Error("Could not read the cloud image for copying");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_CLOUD_IMAGE_BYTES)) {
    await response.body?.cancel();
    throw new Error("Cloud image exceeds the upload size limit");
  }
  if (!response.body) throw new Error("The cloud image response was empty");
  const reader = response.body.getReader();
  const abortRead = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abortRead, { once: true });
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_CLOUD_IMAGE_BYTES || size > asset.byteSize) throw new Error("Cloud image exceeds its expected size");
      chunks.push(new Uint8Array(value));
    }
    signal?.throwIfAborted();
    if (size !== asset.byteSize) throw new Error("The cloud image response was incomplete");
    return new Blob(chunks, { type: asset.mimeType });
  } finally {
    signal?.removeEventListener("abort", abortRead);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
