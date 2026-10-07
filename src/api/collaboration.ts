import { z } from "zod";
import { boardRequest, mutation, parseResponse, boardRoleSchema, type ServerBoardDocument } from "./boards";
import { canvasDocumentSchema } from "../persistence/canvasDocument";
import type { ObjectChange } from "../persistence/collaborationMerge";
import { collaborationOperationSchema } from "../../server/contracts/collaboration";

export type CollaborationOperationInput = { operationId: string; baseRevision: number; changes: ObjectChange[] };
const responseSchema = z.object({ document: canvasDocumentSchema.safeExtend({
  boardId: z.uuid(), revision: z.number().int().positive(), updatedAt: z.number().finite().nonnegative(), role: boardRoleSchema.optional(),
}), replayed: z.boolean() });

export async function applyBoardOperation(boardId: string, input: CollaborationOperationInput, signal: AbortSignal, accountId?: string): Promise<ServerBoardDocument> {
  const body = collaborationOperationSchema.parse(input);
  const response = await boardRequest(`/api/boards/${encodeURIComponent(z.uuid().parse(boardId))}/operations`, mutation("POST", signal, body, accountId), "Could not share these edits");
  const { document } = await parseResponse(response, responseSchema);
  if (document.boardId !== boardId || document.revision <= body.baseRevision) throw new Error("The server returned an invalid collaboration revision");
  return document;
}

export async function sendBoardPresence(boardId: string, clientId: string, cursor: { x: number; y: number } | null, selectedIds: string[], signal?: AbortSignal) {
  await boardRequest(`/api/boards/${encodeURIComponent(boardId)}/presence`, mutation("POST", signal, { clientId, cursor, selectedIds: selectedIds.slice(0, 100) }), "Could not update presence");
}
