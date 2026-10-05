import { getBoardAsset, type SignedBoardAsset } from "../api/assets";
import type { ImageCanvasObject } from "../canvas/objects/types";

export const CLOUD_IMAGE_REFRESH_MARGIN_MS = 30_000;
type Entry = { asset?: SignedBoardAsset; pending?: Promise<SignedBoardAsset>; controller?: AbortController };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let identity = { userId: null as string | null, epoch: 0 };

export function resolveCloudImageReference(
  object: Pick<ImageCanvasObject, "assetId" | "cloudAsset">,
  account: { boardId: string; imageAssets?: Record<string, string> } | null,
) {
  if (!object.cloudAsset) return undefined;
  const assets = account?.imageAssets;
  if (account && assets && Object.hasOwn(assets, object.assetId)) {
    return { boardId: account.boardId, assetId: assets[object.assetId] };
  }
  return object.cloudAsset;
}

export const getCloudImageIdentity = () => identity;
export function subscribeCloudImageIdentity(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function clearCloudImageAccess(userId: string | null = null) {
  for (const entry of cache.values()) entry.controller?.abort();
  cache.clear();
  identity = { userId, epoch: identity.epoch + 1 };
  for (const listener of listeners) listener();
}

export function getCloudImageAccess(userId: string, boardId: string, assetId: string, force = false): Promise<SignedBoardAsset> {
  if (identity.userId !== userId) return Promise.reject(new DOMException("Account changed", "AbortError"));
  const key = JSON.stringify([userId, boardId, assetId]);
  const entry = cache.get(key) ?? {};
  if (entry.pending) return entry.pending;
  if (!force && entry.asset && entry.asset.expiresAt > Date.now() + CLOUD_IMAGE_REFRESH_MARGIN_MS) return Promise.resolve(entry.asset);
  const epoch = identity.epoch;
  const controller = new AbortController();
  entry.controller = controller;
  cache.set(key, entry);
  const pending = getBoardAsset(boardId, assetId, controller.signal).then((asset) => {
    if (controller.signal.aborted || identity.epoch !== epoch || identity.userId !== userId) {
      throw new DOMException("Account changed", "AbortError");
    }
    entry.asset = asset;
    return asset;
  }).catch((error: unknown) => {
    // Failed revalidation must not keep offering a previously issued URL.
    entry.asset = undefined;
    throw error;
  }).finally(() => {
    if (entry.pending === pending) { entry.pending = undefined; entry.controller = undefined; }
  });
  entry.pending = pending;
  return pending;
}
