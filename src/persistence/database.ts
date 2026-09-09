export const BOARD_STORE_NAME = "boards";
export const ASSET_STORE_NAME = "assets";

const DATABASE_NAME = "the-canvas";
const DATABASE_VERSION = 2;

let databasePromise: Promise<IDBDatabase> | null = null;

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      request.error ?? new Error("IndexedDB request failed"),
    );
  });
}

export function openCanvasDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available"));
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BOARD_STORE_NAME)) {
        request.result.createObjectStore(BOARD_STORE_NAME, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(ASSET_STORE_NAME)) {
        request.result.createObjectStore(ASSET_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("Could not open local canvas storage"));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("Local canvas storage is open in an older tab"));
    };
  });

  return databasePromise;
}
