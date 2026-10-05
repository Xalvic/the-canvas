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

export interface AssetStore {
  assertCanUpload(boardId: string, userId: string): Promise<void>;
  reserve(boardId: string, userId: string, input: AssetReservationInput): Promise<AssetMetadata>;
  finalize(id: string, userId: string, file: StoredAssetFile): Promise<AssetMetadata>;
  // Checks current access and consumes the bounded signing allowance atomically.
  getForRead(boardId: string, id: string, userId: string): Promise<AssetMetadata>;
  claimAbandoned(limit: number): Promise<AssetMetadata[]>;
  // Release storage only after confirmed provider deletion or confirmed absence.
  finishDelete(id: string): Promise<void>;
}

export function publicAsset(asset: AssetMetadata) {
  return {
    id: asset.id, boardId: asset.boardId, mimeType: asset.mimeType,
    byteSize: asset.byteSize, width: asset.width, height: asset.height,
    createdAt: asset.createdAt,
  };
}
