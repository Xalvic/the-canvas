import { z } from "zod";
import { canvasDocumentSchema, type CanvasDocument } from "../persistence/canvasDocument";

const MAX_DOCUMENT_REVISION = 2_147_483_647;
const identifier = z.string().min(1);
const timestamp = z.number().finite().nonnegative();
const titleSchema = z.string().trim().min(1).max(120);
export const boardRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type BoardRole = z.infer<typeof boardRoleSchema>;
const boardSchema = z.object({
  id: identifier,
  title: titleSchema,
  role: boardRoleSchema.optional(),
  // Older metadata-only clients and fixtures did not include timestamps.
  createdAt: timestamp.optional(),
  updatedAt: timestamp.optional(),
});
const boardListSchema = z.object({ boards: z.array(boardSchema) });
const boardResponseSchema = z.object({ board: boardSchema });
const pageRequestSchema = z.strictObject({
  title: titleSchema,
  requestId: z.uuid().transform((value) => value.toLowerCase()),
  initializeDocument: z.literal(true),
});
const pageCreationSchema = z.object({
  board: boardSchema.extend({ id: z.uuid() }),
  creation: z.object({
    requestId: z.uuid(),
    documentRevision: z.literal(1),
    replayed: z.boolean(),
    expiresAt: timestamp,
  }),
});
const boardDocumentSchema = canvasDocumentSchema.safeExtend({
  boardId: identifier,
  revision: z.number().int().min(1).max(MAX_DOCUMENT_REVISION),
  updatedAt: timestamp,
  role: boardRoleSchema.optional(),
});
const documentResponseSchema = z.object({ document: boardDocumentSchema });
const saveDocumentSchema = canvasDocumentSchema.safeExtend({
  expectedRevision: z.number().int().min(0).max(MAX_DOCUMENT_REVISION - 1),
});
const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});
const conflictDetailsSchema = z.object({
  currentRevision: z.number().int().min(0).max(MAX_DOCUMENT_REVISION),
});

export type ServerBoard = z.output<typeof boardSchema>;
export type ServerBoardDocument = z.output<typeof boardDocumentSchema>;
export type CreateServerPageInput = z.input<typeof pageRequestSchema>;
export type ServerPageCreation = z.output<typeof pageCreationSchema>;

export class BoardApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly currentRevision?: number,
  ) {
    super(message);
    this.name = "BoardApiError";
  }
}

export class BoardSignInRequired extends BoardApiError {
  constructor(message = "Sign in to access your server boards") {
    super(401, "UNAUTHENTICATED", message);
    this.name = "BoardSignInRequired";
  }
}

export async function boardRequest(url: string, init: RequestInit, failureMessage: string) {
  const response = await fetch(url, { credentials: "same-origin", ...init });
  if (response.status === 401) throw new BoardSignInRequired();
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const parsed = errorResponseSchema.safeParse(payload);
    const error = parsed.success ? parsed.data.error : undefined;
    const conflict = error && ["REVISION_CONFLICT", "COLLABORATION_CONFLICT"].includes(error.code)
      ? conflictDetailsSchema.safeParse(error.details) : undefined;
    throw new BoardApiError(
      response.status,
      error?.code ?? "HTTP_ERROR",
      error?.message ?? failureMessage,
      conflict?.success ? conflict.data.currentRevision : undefined,
    );
  }
  return response;
}

export async function parseResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new BoardApiError(response.status, "INVALID_RESPONSE", "The server returned an invalid board response");
  }
  return parsed.data;
}

function requireIdentity(actualId: string, requestedId: string, status: number) {
  if (actualId !== requestedId) {
    throw new BoardApiError(status, "INVALID_RESPONSE", "The server returned a different board");
  }
}

function boardUrl(id: string) {
  return `/api/boards/${encodeURIComponent(identifier.parse(id))}`;
}

export function mutation(method: string, signal?: AbortSignal, body?: unknown): RequestInit {
  return {
    method,
    headers: {
      "X-Scribble-Request": "1",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal,
  };
}

export async function listServerBoards(signal?: AbortSignal): Promise<ServerBoard[]> {
  const response = await boardRequest("/api/boards", { signal }, "Could not load server boards");
  return (await parseResponse(response, boardListSchema)).boards;
}

export async function getServerBoard(id: string, signal?: AbortSignal): Promise<ServerBoard> {
  const response = await boardRequest(boardUrl(id), { signal }, "Could not check board access");
  const board = (await parseResponse(response, boardResponseSchema)).board;
  requireIdentity(board.id, id, response.status);
  return board;
}

export async function createServerBoard(title: string, signal?: AbortSignal): Promise<ServerBoard> {
  const body = { title: titleSchema.parse(title) };
  const response = await boardRequest("/api/boards", mutation("POST", signal, body), "Could not create server board");
  return (await parseResponse(response, boardResponseSchema)).board;
}

// Callers persist this intent before dispatch and keep its requestId on retry.
// Orchestration is added in M6/M7; the legacy UI still uses createServerBoard.
export async function createServerPage(input: CreateServerPageInput, signal?: AbortSignal): Promise<ServerPageCreation> {
  const body = pageRequestSchema.parse(input);
  const response = await boardRequest("/api/boards", mutation("POST", signal, body), "Could not create workspace page");
  const result = await parseResponse(response, pageCreationSchema);
  if (result.creation.requestId !== body.requestId) {
    throw new BoardApiError(response.status, "INVALID_RESPONSE", "The server returned a different creation request");
  }
  if (response.status !== (result.creation.replayed ? 200 : 201)) {
    throw new BoardApiError(response.status, "INVALID_RESPONSE", "The server returned an unexpected creation acknowledgement");
  }
  return result;
}

export async function renameServerBoard(id: string, title: string, signal?: AbortSignal): Promise<ServerBoard> {
  const body = { title: titleSchema.parse(title) };
  const response = await boardRequest(boardUrl(id), mutation("PATCH", signal, body), "Could not rename server board");
  const board = (await parseResponse(response, boardResponseSchema)).board;
  requireIdentity(board.id, id, response.status);
  return board;
}

export async function deleteServerBoard(id: string, signal?: AbortSignal): Promise<void> {
  const response = await boardRequest(boardUrl(id), mutation("DELETE", signal), "Could not delete server board");
  if (response.status !== 204) {
    throw new BoardApiError(response.status, "INVALID_RESPONSE", "The server did not confirm board deletion");
  }
}

export async function getServerBoardDocument(id: string, signal?: AbortSignal): Promise<ServerBoardDocument> {
  const response = await boardRequest(`${boardUrl(id)}/document`, { signal }, "Could not open server board");
  const document = (await parseResponse(response, documentResponseSchema)).document;
  requireIdentity(document.boardId, id, response.status);
  return document;
}

export async function saveServerBoardDocument(
  id: string,
  document: CanvasDocument,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<ServerBoardDocument> {
  const body = saveDocumentSchema.parse({ ...document, expectedRevision });
  const response = await boardRequest(`${boardUrl(id)}/document`, mutation("PUT", signal, body), "Could not save server board");
  const saved = (await parseResponse(response, documentResponseSchema)).document;
  requireIdentity(saved.boardId, id, response.status);
  if (saved.revision !== expectedRevision + 1) {
    throw new BoardApiError(response.status, "INVALID_RESPONSE", "The server returned an unexpected document revision");
  }
  return saved;
}
