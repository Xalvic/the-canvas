import { z } from "zod";
import { cloudDocumentSchema, type CloudCanvasDocument } from "./contracts/cloudDocument.js";
import type { BoardRole } from "./boards.js";

export const DOCUMENT_BODY_LIMIT = "1mb";
export const MAX_DOCUMENT_REVISION = 2_147_483_647;
export const saveDocumentSchema = cloudDocumentSchema.safeExtend({
  // Leave room for the accepted save to increment PostgreSQL's integer counter.
  expectedRevision: z.number().int().min(0).max(MAX_DOCUMENT_REVISION - 1),
});

export type SaveDocumentInput = z.output<typeof saveDocumentSchema>;
export type BoardDocument = CloudCanvasDocument & {
  boardId: string;
  revision: number;
  updatedAt: number;
  role?: BoardRole;
};
export type DocumentReadResult =
  | { status: "found"; document: BoardDocument }
  | { status: "board-not-found" }
  | { status: "document-not-found" };
export type DocumentSaveResult =
  | { status: "saved"; created: boolean; document: BoardDocument }
  | { status: "board-not-found" }
  | { status: "conflict"; currentRevision: number };

export interface BoardDocumentStore {
  get(boardId: string, ownerId: string): Promise<DocumentReadResult>;
  save(boardId: string, input: SaveDocumentInput, ownerId: string): Promise<DocumentSaveResult>;
}
