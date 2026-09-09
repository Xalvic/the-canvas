import {
  ASSET_STORE_NAME,
  openCanvasDatabase,
  requestResult,
} from "../persistence/database";

type StoredAsset = {
  id: string;
  blob: Blob;
  name?: string;
  mimeType: string;
  createdAt: number;
};

export type AssetMetadata = {
  name?: string;
  mimeType?: string;
};

export async function saveAsset(
  blob: Blob,
  metadata: AssetMetadata = {},
): Promise<string> {
  const database = await openCanvasDatabase();
  const id = crypto.randomUUID();
  const asset: StoredAsset = {
    id,
    blob,
    name: metadata.name,
    mimeType: metadata.mimeType || blob.type || "application/octet-stream",
    createdAt: Date.now(),
  };

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ASSET_STORE_NAME, "readwrite");
    transaction.objectStore(ASSET_STORE_NAME).put(asset);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error("Could not save the image locally"),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error("Saving the image was interrupted"),
    );
  });
  return id;
}

export async function getAsset(assetId: string): Promise<Blob | null> {
  const database = await openCanvasDatabase();
  const transaction = database.transaction(ASSET_STORE_NAME, "readonly");
  const asset = await requestResult<StoredAsset | undefined>(
    transaction.objectStore(ASSET_STORE_NAME).get(assetId),
  );
  return asset?.blob ?? null;
}

export async function deleteAsset(assetId: string): Promise<void> {
  const database = await openCanvasDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(ASSET_STORE_NAME, "readwrite");
    transaction.objectStore(ASSET_STORE_NAME).delete(assetId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error("Could not delete the local image"),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error("Deleting the image was interrupted"),
    );
  });
}
