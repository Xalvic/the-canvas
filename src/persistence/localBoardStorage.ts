import type { CanvasObject } from "../canvas/objects/types";
import type { Viewport } from "../canvas/viewport/viewportMath";
import type { DocumentSnapshot } from "../store/documentStore";
import { isOpacity } from "../tools/toolSettings";
import { z } from "zod";
import { canvasDocumentSchema, type CanvasDocument } from "./canvasDocument";
import {
  BOARD_STORE_NAME,
  openCanvasDatabase,
  requestResult,
} from "./database";

export const CURRENT_BOARD_ID = "current-board";
export const LOCAL_BOARD_SCHEMA_VERSION = 1;

export type AccountBoardLink = {
  ownerId: string;
  boardId: string;
  revision: number;
  savedDocument: CanvasDocument;
  savedTitle: string;
  pendingSave?: { document: CanvasDocument; expectedRevision: number };
};

export function accountBoardStorageId(ownerId: string, boardId: string): string {
  return `account-board:${encodeURIComponent(ownerId)}:${encodeURIComponent(boardId)}`;
}

const accountBoardLinkSchema = z.strictObject({
  ownerId: z.string().min(1).refine((value) => value.trim().length > 0),
  boardId: z.string().min(1).refine((value) => value.trim().length > 0),
  revision: z.number().int().nonnegative(),
  savedDocument: canvasDocumentSchema,
  savedTitle: z.string(),
  pendingSave: z.strictObject({
    document: canvasDocumentSchema,
    expectedRevision: z.number().int().nonnegative(),
  }).optional(),
});

export type LocalBoardRecord = {
  schemaVersion: typeof LOCAL_BOARD_SCHEMA_VERSION;
  id: string;
  title: string;
  objects: DocumentSnapshot;
  viewport: Viewport;
  createdAt: number;
  updatedAt: number;
  account?: AccountBoardLink;
};

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
    !["card", "text", "frame", "stroke", "image"].includes(String(value.type)) ||
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
  if (value.type === "text") return (
    typeof value.text === "string" &&
    (value.color === undefined || typeof value.color === "string") &&
    (value.fontSize === undefined || (isFiniteNumber(value.fontSize) && value.fontSize > 0)) &&
    (value.fontWeight === undefined || (isFiniteNumber(value.fontWeight) && value.fontWeight >= 1 && value.fontWeight <= 1000)) &&
    (value.textAlign === undefined || ["left", "center", "right"].includes(String(value.textAlign))) &&
    (value.opacity === undefined || isOpacity(value.opacity))
  );
  if (value.type === "frame") {
    return typeof value.title === "string" && typeof value.moveContents === "boolean";
  }
  if (value.type === "image") {
    return (
      typeof value.assetId === "string" &&
      isFiniteNumber(value.originalWidth) &&
      value.originalWidth > 0 &&
      isFiniteNumber(value.originalHeight) &&
      value.originalHeight > 0 &&
      (value.name === undefined || typeof value.name === "string") &&
      (value.mimeType === undefined || typeof value.mimeType === "string")
    );
  }
  if (value.type !== "stroke") return false;
  return (
    typeof value.color === "string" &&
    isFiniteNumber(value.strokeWidth) &&
    value.strokeWidth > 0 &&
    (value.mode === undefined || value.mode === "draw" || value.mode === "solid") &&
    (value.opacity === undefined || isOpacity(value.opacity)) &&
    Array.isArray(value.points) &&
    value.points.every(
      (point) =>
        isRecord(point) &&
        isFiniteNumber(point.x) &&
        isFiniteNumber(point.y) &&
        (point.pressure === undefined || isOpacity(point.pressure)) &&
        (point.widthRatio === undefined || (isOpacity(point.widthRatio) && point.widthRatio > 0)) &&
        (point.velocity === undefined || (isFiniteNumber(point.velocity) && point.velocity >= 0)),
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

  if (value.account !== undefined) {
    const account = accountBoardLinkSchema.safeParse(value.account);
    if (!account.success) return null;
    let storageId: string;
    try {
      storageId = accountBoardStorageId(account.data.ownerId, account.data.boardId);
    } catch {
      return null;
    }
    if (value.id !== storageId && value.id !== `${storageId}:recovery`) return null;
    return { ...value, account: account.data } as LocalBoardRecord;
  }

  return value as LocalBoardRecord;
}

export async function loadLocalBoard(id = CURRENT_BOARD_ID): Promise<LocalBoardRecord | null> {
  const database = await openCanvasDatabase();
  const transaction = database.transaction(BOARD_STORE_NAME, "readonly");
  const rawBoard = await requestResult(
    transaction.objectStore(BOARD_STORE_NAME).get(id),
  );
  if (rawBoard === undefined) return null;
  const board = parseLocalBoard(rawBoard);
  if (!board) throw new Error("The locally saved board has an unsupported format");
  if (board.id !== id) throw new Error("The locally saved board has a mismatched identity");
  return board;
}

export async function saveLocalBoard(board: LocalBoardRecord): Promise<void> {
  const database = await openCanvasDatabase();
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
