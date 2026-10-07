import { z } from "zod";
import { BoardApiError, boardRequest, parseResponse, expectedAccountHeaders } from "./boards";

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
const uploadIdentity = { requestId: z.uuid(), boardId: z.uuid(), assetId: z.uuid() };
const uploadSchema = z.discriminatedUnion("state", [
  z.object({ ...uploadIdentity, state: z.literal("ready"), canRetry: z.literal(false), retryAfterMs: z.null(), asset: assetSchema }),
  z.object({ ...uploadIdentity, state: z.literal("pending"), canRetry: z.boolean(), retryAfterMs: z.number().int().min(1).max(90_000), asset: z.null() }),
  z.object({ ...uploadIdentity, state: z.literal("failed"), canRetry: z.literal(false), retryAfterMs: z.null(), asset: z.null() }),
]);
export type BoardAssetUpload = z.output<typeof uploadSchema>;

function assetsUrl(boardId: string) {
  return `/api/boards/${encodeURIComponent(z.uuid().parse(boardId))}/assets`;
}
function invalid(message: string): never {
  throw new BoardApiError(200, "INVALID_RESPONSE", message);
}

function uploadIdentityInput(boardId: string, requestId: string) {
  return { boardId: z.uuid().parse(boardId).toLowerCase(), requestId: z.uuid().parse(requestId).toLowerCase() };
}
async function parseUpload(response: Response, boardId: string, requestId: string, mutation: boolean): Promise<BoardAssetUpload> {
  const { upload } = await parseResponse(response, z.object({ upload: uploadSchema }));
  const expectedStatus = mutation && upload.state === "pending" ? 202 : 200;
  if (response.status !== expectedStatus || upload.boardId !== boardId || upload.requestId !== requestId ||
      (mutation && upload.state === "failed") || (upload.state === "ready" &&
        (upload.asset.boardId !== boardId || upload.asset.id !== upload.assetId))) {
    invalid("The server returned a different image upload identity or state");
  }
  return upload;
}

// Caller must durably save this UUID BEFORE dispatch, and reuse it after reload.
// One request only: lifecycle/polling and automatic uploads belong to M7/M8.
export async function uploadBoardAssetRequest(boardId: string, blob: Blob, requestId: string, signal?: AbortSignal, accountId?: string): Promise<BoardAssetUpload> {
  const identity = uploadIdentityInput(boardId, requestId);
  const type = mimeType.safeParse(blob.type);
  if (!type.success || blob.size < 1 || blob.size > MAX_CLOUD_IMAGE_BYTES) {
    throw new Error("Cloud images must be JPEG, PNG or WebP and at most 5 MiB");
  }
  const response = await boardRequest(assetsUrl(identity.boardId), {
    method: "POST", headers: { ...expectedAccountHeaders(accountId).headers, "X-Scribble-Request": "1", "Content-Type": type.data, "X-Scribble-Upload-Request": identity.requestId }, body: blob,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
  }, "Could not upload image");
  return parseUpload(response, identity.boardId, identity.requestId, true);
}

export async function getBoardAssetUpload(boardId: string, requestId: string, signal?: AbortSignal, accountId?: string): Promise<BoardAssetUpload> {
  const identity = uploadIdentityInput(boardId, requestId);
  const response = await boardRequest(`/api/boards/${identity.boardId}/asset-uploads/${identity.requestId}`, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000), cache: "no-store", ...expectedAccountHeaders(accountId),
  }, "Could not check image upload");
  return parseUpload(response, identity.boardId, identity.requestId, false);
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

export async function getBoardAsset(boardId: string, assetId: string, signal?: AbortSignal, accountId?: string): Promise<SignedBoardAsset> {
  const response = await boardRequest(`${assetsUrl(boardId)}/${encodeURIComponent(z.uuid().parse(assetId))}`, {
    signal, cache: "no-store", ...expectedAccountHeaders(accountId),
  }, "Could not access image");
  const { asset } = await parseResponse(response, z.object({ asset: signedAssetSchema }));
  if (asset.boardId !== boardId || asset.id !== assetId || asset.expiresAt <= Date.now() || asset.expiresAt > Date.now() + 310_000) {
    invalid("The server returned an invalid image identity or expiry");
  }
  return asset;
}

// An authorized cross-page paste/copy may preserve these bytes in its upload
// intent before dispatch. Signed URLs remain transient.
export async function downloadBoardAsset(boardId: string, assetId: string, signal?: AbortSignal, accountId?: string): Promise<Blob> {
  signal?.throwIfAborted();
  const asset = await getBoardAsset(boardId, assetId, signal, accountId);
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
