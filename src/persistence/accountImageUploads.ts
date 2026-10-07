import { z } from "zod";
import { useBoardStore } from "../store/boardStore";
import type { CanvasObject, ImageCanvasObject } from "../canvas/objects/types";
import { getAsset } from "../assets/assetStore";
import { downloadBoardAsset, getBoardAssetUpload, uploadBoardAssetRequest, MAX_CLOUD_IMAGE_BYTES } from "../api/assets";
import { BoardApiError } from "../api/boards";
import type { AccountBoardLink } from "./localBoardStorage";

export const imageUploadIntentSchema = z.strictObject({
  requestId: z.uuid(), blob: z.instanceof(Blob).optional(),
  cloudAsset: z.strictObject({ boardId: z.string().min(1), assetId: z.uuid() }).optional(),
  dispatched: z.boolean(), pendingConfirmed: z.boolean(), canRetry: z.boolean(),
  nextAttemptAt: z.number().finite().nonnegative(), failed: z.boolean(),
});
export type ImageUploadIntent = z.output<typeof imageUploadIntentSchema>;
// Validate own entries, including local IDs such as __proto__.
export const imageUploadIntentsSchema = z.custom<Record<string, ImageUploadIntent>>((value) =>
  typeof value === "object" && value !== null &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
  Object.values(value).every((intent) => imageUploadIntentSchema.safeParse(intent).success),
).transform((value) => Object.fromEntries(Object.entries(value)));

export function missingAccountImages(objects: Record<string, CanvasObject>, link: AccountBoardLink) {
  return [...new Map(Object.values(objects).filter((object): object is ImageCanvasObject => object.type === "image" &&
    !Object.hasOwn(link.imageAssets ?? {}, object.assetId) && object.cloudAsset?.boardId !== link.boardId)
    .map((image) => [image.assetId, image])).values()];
}

/** Called only by a new insertion or explicit migration consent, never by loading
 * a document, remote merging, sign-in, or history replay. Metadata is outside undo. */
export function authorizeAccountImages(objects: CanvasObject[]) {
  const board = useBoardStore.getState(), link = board.account;
  if (!board.isHydrated || board.readOnly || !link) return;
  const additions = missingAccountImages(Object.fromEntries(objects.map((object) => [object.id, object])), link)
    .filter((image) => !Object.hasOwn(link.imageUploads ?? {}, image.assetId));
  if (!additions.length) return;
  board.setAccount({ ...link, imageUploads: { ...link.imageUploads, ...Object.fromEntries(additions.map((image) => [image.assetId, {
    requestId: crypto.randomUUID(), ...(image.cloudAsset ? { cloudAsset: { ...image.cloudAsset } } : {}),
    dispatched: false, pendingConfirmed: false, canRetry: true, nextAttemptAt: 0, failed: false,
  }])) } });
}

export class PendingImageUpload extends Error {
  constructor(public readonly retryAfterMs: number, public readonly retryable = true) {
    super(retryable ? "An image upload is still being confirmed. Your draft is saved on this device."
      : "An image upload needs attention. Your original file and upload request are retained on this device.");
  }
}

/** One bounded attempt. Persist the immutable bytes and dispatch marker before
 * POST; reconcile unknown outcomes with GET before sending those same bytes. */
export async function uploadAccountImage(localId: string, original: ImageUploadIntent, link: AccountBoardLink,
  signal: AbortSignal, persist: (intent: ImageUploadIntent) => Promise<void>) {
  let intent = original;
  if (intent.failed) throw new PendingImageUpload(0, false);
  if (Date.now() < intent.nextAttemptAt) throw new PendingImageUpload(intent.nextAttemptAt - Date.now());
  if (!intent.blob) {
    const blob = intent.cloudAsset ? await downloadBoardAsset(intent.cloudAsset.boardId, intent.cloudAsset.assetId, signal, link.ownerId)
      : await getAsset(localId);
    signal.throwIfAborted();
    if (!blob || !["image/jpeg", "image/png", "image/webp"].includes(blob.type) || blob.size < 1 || blob.size > MAX_CLOUD_IMAGE_BYTES)
      throw new Error("Restore the image as JPEG, PNG or WebP up to 5 MiB. Its local content is retained.");
    intent = { ...intent, blob };
    await persist(intent);
  }
  let upload;
  if (intent.dispatched) {
    try { upload = await getBoardAssetUpload(link.boardId, intent.requestId, signal, link.ownerId); }
    catch (error) { if (!(error instanceof BoardApiError && error.code === "ASSET_UPLOAD_NOT_FOUND")) throw error; }
  }
  if (!upload || upload.state === "pending" && upload.canRetry && intent.pendingConfirmed) {
    if (!intent.canRetry) throw new PendingImageUpload(0, false);
    intent = { ...intent, dispatched: true, pendingConfirmed: false, nextAttemptAt: Date.now() + 5_000 };
    await persist(intent);
    try { upload = await uploadBoardAssetRequest(link.boardId, intent.blob!, intent.requestId, signal, link.ownerId); }
    catch (error) {
      if (error instanceof BoardApiError && error.retryAfterMs) await persist({ ...intent, nextAttemptAt: Date.now() + error.retryAfterMs });
      throw error;
    }
  }
  await persist({ ...intent, pendingConfirmed: upload.state === "pending", canRetry: upload.canRetry,
    failed: upload.state === "failed", nextAttemptAt: Date.now() + (upload.retryAfterMs ?? 0) });
  if (upload.state !== "ready") throw new PendingImageUpload(upload.retryAfterMs ?? 0, upload.state !== "failed" && upload.canRetry);
  return upload.assetId;
}
