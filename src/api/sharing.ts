import { z } from "zod";
import { boardRequest, expectedAccountHeaders, mutation, parseResponse } from "./boards";

export const memberRoleSchema = z.enum(["editor", "viewer"]);
export type MemberRole = z.infer<typeof memberRoleSchema>;
const invitationSchema = z.object({ id: z.string().uuid(), email: z.email(), role: memberRoleSchema, expiresAt: z.number().finite() });
const incomingSchema = invitationSchema.extend({ boardId: z.string().uuid(), boardTitle: z.string(), ownerEmail: z.email() });
const sharingSchema = z.object({
  members: z.array(z.object({ userId: z.string().uuid(), email: z.email(), displayName: z.string().nullable(), role: memberRoleSchema })),
  invitations: z.array(invitationSchema),
});
const boardPath = (id: string) => `/api/boards/${encodeURIComponent(id)}`;
const invitePath = (id: string) => `/api/invitations/${encodeURIComponent(id)}`;

export async function getBoardSharing(id: string, signal?: AbortSignal, accountId?: string) {
  return parseResponse(await boardRequest(`${boardPath(id)}/sharing`, { signal, ...expectedAccountHeaders(accountId) }, "Could not load sharing"), sharingSchema);
}
export async function getInvitations(signal?: AbortSignal, accountId?: string) {
  return (await parseResponse(await boardRequest("/api/invitations", { signal, ...expectedAccountHeaders(accountId) }, "Could not load invitations"), z.object({ invitations: z.array(incomingSchema) }))).invitations;
}
export async function inviteToBoard(id: string, email: string, role: MemberRole, signal?: AbortSignal) {
  const body = { email: z.email().max(254).parse(email.trim().toLowerCase()), role: memberRoleSchema.parse(role) };
  return parseResponse(await boardRequest(`${boardPath(id)}/invitations`, mutation("POST", signal, body), "Could not invite this person"), z.object({ invitation: invitationSchema }));
}
export async function changeMemberRole(id: string, userId: string, role: MemberRole, signal?: AbortSignal) {
  await boardRequest(`${boardPath(id)}/members/${encodeURIComponent(userId)}`, mutation("PATCH", signal, { role: memberRoleSchema.parse(role) }), "Could not change this role");
}
export async function removeMember(id: string, userId: string, signal?: AbortSignal) {
  await boardRequest(`${boardPath(id)}/members/${encodeURIComponent(userId)}`, mutation("DELETE", signal), "Could not remove this person");
}
export async function cancelInvitation(id: string, invitationId: string, signal?: AbortSignal) {
  await boardRequest(`${boardPath(id)}/invitations/${encodeURIComponent(invitationId)}`, mutation("DELETE", signal), "Could not cancel this invitation");
}
export async function acceptInvitation(id: string, signal?: AbortSignal) {
  await boardRequest(`${invitePath(id)}/accept`, mutation("POST", signal), "Could not accept this invitation");
}
export async function declineInvitation(id: string, signal?: AbortSignal) {
  await boardRequest(invitePath(id), mutation("DELETE", signal), "Could not decline this invitation");
}
