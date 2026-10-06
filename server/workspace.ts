import { z } from "zod";
import type { BoardMetadata } from "./boards.js";

export const initializeWorkspaceSchema = z.strictObject({
  requestId: z.uuid().transform((value) => value.toLowerCase()),
  createInitialPage: z.boolean(),
});
export const updateWorkspaceSchema = z.strictObject({
  lastOpenedBoardId: z.uuid().transform((value) => value.toLowerCase()).nullable(),
});
export type InitializeWorkspaceInput = z.output<typeof initializeWorkspaceSchema>;
export type UpdateWorkspaceInput = z.output<typeof updateWorkspaceSchema>;
export type WorkspaceState = { initialized: boolean; lastOpenedBoardId: string | null };
export type WorkspaceInitialization = {
  workspace: WorkspaceState;
  // A current opening candidate, never a document snapshot or creation receipt.
  board: BoardMetadata | null;
  initialization: { requestId: string; replayed: boolean; initializedNow: boolean };
};
export interface WorkspaceStore {
  get(userId: string): Promise<WorkspaceState>;
  update(input: UpdateWorkspaceInput, userId: string): Promise<WorkspaceState>;
  initialize(input: InitializeWorkspaceInput, userId: string): Promise<WorkspaceInitialization>;
}
