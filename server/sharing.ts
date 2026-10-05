import { z } from "zod";
import type { BoardMetadata } from "./boards.js";

export const memberRoleSchema = z.enum(["editor", "viewer"]);
export const inviteSchema = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: memberRoleSchema,
});
export const memberUpdateSchema = z.strictObject({ role: memberRoleSchema });
export type MemberRole = z.output<typeof memberRoleSchema>;
export type BoardInvitation = { id: string; email: string; role: MemberRole; expiresAt: number };
export type IncomingInvitation = BoardInvitation & { boardId: string; boardTitle: string; ownerEmail: string };
export type BoardMember = { userId: string; email: string; displayName: string | null; role: MemberRole };
export type BoardSharing = { members: BoardMember[]; invitations: BoardInvitation[] };

export interface SharingStore {
  get(boardId: string, userId: string): Promise<BoardSharing>;
  invite(boardId: string, userId: string, input: z.output<typeof inviteSchema>): Promise<BoardInvitation>;
  cancel(boardId: string, userId: string, inviteId: string): Promise<void>;
  updateMember(boardId: string, userId: string, memberId: string, role: MemberRole): Promise<void>;
  removeMember(boardId: string, userId: string, memberId: string): Promise<void>;
  incoming(userId: string, email: string): Promise<IncomingInvitation[]>;
  accept(inviteId: string, userId: string, email: string): Promise<BoardMetadata>;
  decline(inviteId: string, userId: string, email: string): Promise<void>;
}
