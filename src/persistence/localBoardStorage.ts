import type { CanvasObject } from "../canvas/objects/types";
import type { Viewport } from "../canvas/viewport/viewportMath";
import type { DocumentSnapshot } from "../store/documentStore";

const DATABASE_NAME = "the-canvas";
const DATABASE_VERSION = 1;
const BOARD_STORE_NAME = "boards";
export const CURRENT_BOARD_ID = "current-board";
export const LOCAL_BOARD_SCHEMA_VERSION = 1;

export type LocalBoardRecord = {
  schemaVersion: typeof LOCAL_BOARD_SCHEMA_VERSION;
  id: string;
  title: string;
  objects: DocumentSnapshot;
  viewport: Viewport;
  createdAt: number;
  updatedAt: number;
};

let databasePromise: Promise<IDBDatabase> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isEndpoint(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.objectId === "string" &&
    ["top", "right", "bottom", "left"].includes(String(value.anchor))
  );
}

function isCanvasObjectRecord(value: unknown): value is CanvasObject {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isFiniteNumber(value.zIndex) ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt) ||
    (value.groupId !== undefined && typeof value.groupId !== "string")
  ) {
    return false;
  }

  if (value.type === "connector") {
    return (
      isEndpoint(value.from) &&
      isEndpoint(value.to) &&
      typeof value.directed === "boolean"
    );
  }

  if (
    !["card", "text", "frame", "stroke"].includes(String(value.type)) ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    !isFiniteNumber(value.width) ||
    !isFiniteNumber(value.height)
  ) {
    return false;
  }

  if (value.type === "card") {
    return typeof value.title === "string" && typeof value.body === "string";
  }
  if (value.type === "text") return typeof value.text === "string";
  if (value.type === "frame") {
    return typeof value.title === "string" && typeof value.moveContents === "boolean";
  }
  if (value.type !== "stroke") return false;
  return (
    typeof value.color === "string" &&
    isFiniteNumber(value.strokeWidth) &&
    Array.isArray(value.points) &&
    value.points.every(
      (point) =>
        isRecord(point) &&
        isFiniteNumber(point.x) &&
        isFiniteNumber(point.y) &&
        isFiniteNumber(point.pressure),
    )
  );
}

export function parseLocalBoard(value: unknown): LocalBoardRecord | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== LOCAL_BOARD_SCHEMA_VERSION ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt) ||
    !isRecord(value.objects) ||
    !isRecord(value.viewport) ||
    !isFiniteNumber(value.viewport.x) ||
    !isFiniteNumber(value.viewport.y) ||
    !isFiniteNumber(value.viewport.zoom) ||
    value.viewport.zoom <= 0
  ) {
    return null;
  }

  const objects = Object.entries(value.objects);
  if (
    !objects.every(
      ([id, object]) => isCanvasObjectRecord(object) && object.id === id,
    )
  ) {
    return null;
  }

  return value as LocalBoardRecord;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
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
      reject(request.error ?? new Error("Could not open local board storage"));
    };
  });
  return databasePromise;
}

export async function loadLocalBoard(): Promise<LocalBoardRecord | null> {
  const database = await openDatabase();
  const transaction = database.transaction(BOARD_STORE_NAME, "readonly");
  const rawBoard = await requestResult(
    transaction.objectStore(BOARD_STORE_NAME).get(CURRENT_BOARD_ID),
  );
  if (rawBoard === undefined) return null;
  const board = parseLocalBoard(rawBoard);
  if (!board) throw new Error("The locally saved board has an unsupported format");
  return board;
}

export async function saveLocalBoard(board: LocalBoardRecord): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(BOARD_STORE_NAME, "readwrite");
    transaction.objectStore(BOARD_STORE_NAME).put(board);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error("Could not save the board locally"),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error("Saving the board was interrupted"),
    );
  });
}
