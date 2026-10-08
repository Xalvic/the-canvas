import { z } from "zod";
import { tokenSchema } from "./auth.js";
import type { BoardMetadata } from "./boards.js";
import { memberRoleSchema } from "./sharing.js";

const version = z.number().int().min(0).max(2_147_483_646);
const identity = { requestId: z.uuid().transform((value) => value.toLowerCase()), expectedVersion: version };
export const copyShareLinkSchema = z.strictObject(identity);
export const updateShareLinkSchema = z.union([
  z.strictObject({ ...identity, role: memberRoleSchema }),
  z.strictObject({ ...identity, enabled: z.literal(false) }),
]);
export const openShareLinkSchema = z.strictObject({ token: tokenSchema });
export type CopyShareLinkInput = z.output<typeof copyShareLinkSchema>;
export type UpdateShareLinkInput = z.output<typeof updateShareLinkSchema>;
export type ShareLinkSettings = { enabled: boolean; role: "viewer" | "editor"; generation: number; version: number };
export type ShareLinkMutation = { settings: ShareLinkSettings; requestId: string; replayed: boolean };
export interface ShareLinkStore {
  get(boardId: string, userId: string): Promise<ShareLinkSettings>;
  copy(boardId: string, userId: string, input: CopyShareLinkInput): Promise<ShareLinkMutation & { token: string }>;
  update(boardId: string, userId: string, input: UpdateShareLinkInput): Promise<ShareLinkMutation>;
  open(token: string, userId: string): Promise<BoardMetadata>;
}
