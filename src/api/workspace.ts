import { z } from "zod";
import { BoardApiError, boardRequest, boardSchema, mutation, parseResponse } from "./boards";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const stateSchema = z.object({ initialized: z.boolean(), lastOpenedBoardId: z.uuid().nullable() });
const stateResponseSchema = z.object({ workspace: stateSchema });
const initializeSchema = z.strictObject({ requestId: uuid, createInitialPage: z.boolean() });
const updateSchema = z.strictObject({ lastOpenedBoardId: uuid.nullable() });
const initializationResponseSchema = z.object({
  workspace: stateSchema.extend({ initialized: z.literal(true) }),
  board: boardSchema.extend({ id: z.uuid() }).nullable(),
  initialization: z.object({ requestId: z.uuid(), replayed: z.boolean(), initializedNow: z.boolean() }),
});
export type ServerWorkspace = z.output<typeof stateSchema>;
export type InitializeServerWorkspaceInput = z.input<typeof initializeSchema>;
export type UpdateServerWorkspaceInput = z.input<typeof updateSchema>;
export type ServerWorkspaceInitialization = z.output<typeof initializationResponseSchema>;

function requireAcknowledgement(response: Response) {
  if (response.status !== 200) throw new BoardApiError(response.status, "INVALID_RESPONSE", "The server did not confirm workspace state");
}

export async function getServerWorkspace(signal?: AbortSignal): Promise<ServerWorkspace> {
  const response = await boardRequest("/api/workspace", { signal }, "Could not load workspace state");
  requireAcknowledgement(response);
  return (await parseResponse(response, stateResponseSchema)).workspace;
}

// Persist the caller's intent before dispatch; retry with the same UUID and mode.
// Opening a returned candidate always requires a fresh document read in M6.
export async function initializeServerWorkspace(input: InitializeServerWorkspaceInput, signal?: AbortSignal): Promise<ServerWorkspaceInitialization> {
  const body = initializeSchema.parse(input);
  const response = await boardRequest("/api/workspace/initialize", mutation("POST", signal, body), "Could not initialize workspace");
  requireAcknowledgement(response);
  const result = await parseResponse(response, initializationResponseSchema);
  if (result.initialization.requestId !== body.requestId || result.initialization.replayed && result.initialization.initializedNow ||
      result.workspace.lastOpenedBoardId !== null && result.board?.id !== result.workspace.lastOpenedBoardId) {
    throw new BoardApiError(response.status, "INVALID_RESPONSE", "The server returned an invalid workspace initialization");
  }
  return result;
}

// Call only after a successful page open. Other-device updates are a preference,
// not a command to navigate the currently displayed editor.
export async function updateServerWorkspace(input: UpdateServerWorkspaceInput, signal?: AbortSignal): Promise<ServerWorkspace> {
  const body = updateSchema.parse(input);
  const response = await boardRequest("/api/workspace", mutation("PATCH", signal, body), "Could not remember workspace page");
  requireAcknowledgement(response);
  const workspace = (await parseResponse(response, stateResponseSchema)).workspace;
  if (workspace.lastOpenedBoardId !== body.lastOpenedBoardId) {
    throw new BoardApiError(response.status, "INVALID_RESPONSE", "The server returned a different workspace page");
  }
  return workspace;
}
