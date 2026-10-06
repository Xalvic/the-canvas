export type AssetMetadata = {
  id: string;
  boardId: string | null;
  scopeBoardId: string;
  uploaderId: string;
  status: "pending" | "ready" | "deleting" | "failed";
  byteSize: number;
  mimeType: string;
  width: number;
  height: number;
  fileId: string | null;
  filePath: string;
  createdAt: number;
  lastReferencedAt: number | null;
};

export type AssetReservationInput = Pick<AssetMetadata, "id" | "byteSize" | "mimeType" | "width" | "height" | "filePath">;
export type StoredAssetFile = { fileId: string; filePath: string; size: number };
export const MAX_UPLOAD_ATTEMPTS = 3;
export const UPLOAD_RETRY_MS = 5_000;
export const UPLOAD_LEASE_MS = 90_000;
export type UploadClaim = {
  asset: AssetMetadata;
  requestId: string;
  leaseToken: string | null;
  attempts: number;
  retryAfterMs: number;
};

export interface AssetStore {
  assertCanUpload(boardId: string, userId: string): Promise<void>;
  reserve(boardId: string, userId: string, input: AssetReservationInput): Promise<AssetMetadata>;
  reserveUpload(boardId: string, userId: string, input: AssetReservationInput, requestId: string, contentHash: string): Promise<UploadClaim>;
  claimUpload(boardId: string, userId: string, requestId: string): Promise<UploadClaim>;
  beginUpload(id: string, userId: string, leaseToken: string): Promise<boolean>;
  releaseUpload(id: string, leaseToken: string): Promise<void>;
  finalize(id: string, userId: string, file: StoredAssetFile, leaseToken?: string): Promise<AssetMetadata>;
  // Checks current access and consumes the bounded signing allowance atomically.
  getForRead(boardId: string, id: string, userId: string): Promise<AssetMetadata>;
  claimAbandoned(limit: number): Promise<AssetMetadata[]>;
  // Release storage only after confirmed provider deletion or confirmed absence.
  finishDelete(id: string): Promise<void>;
}

export function publicUpload(claim: UploadClaim) {
  const { asset, requestId, attempts } = claim;
  const state = asset.status === "ready" ? "ready" : asset.status === "pending" ? "pending" : "failed";
  return {
    requestId, boardId: asset.scopeBoardId, assetId: asset.id, state,
    canRetry: state === "pending" && attempts < MAX_UPLOAD_ATTEMPTS,
    retryAfterMs: state === "pending" ? claim.retryAfterMs : null,
    asset: state === "ready" ? publicAsset(asset) : null,
  };
}

export function publicAsset(asset: AssetMetadata) {
  return {
    id: asset.id, boardId: asset.boardId, mimeType: asset.mimeType,
    byteSize: asset.byteSize, width: asset.width, height: asset.height,
    createdAt: asset.createdAt,
  };
}
