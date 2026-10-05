import { randomUUID } from "node:crypto";
import type { PrismaClient } from "./generated/prisma/client.js";
import { requireOwner } from "./boardPermissions.js";
import { HttpError } from "./errors.js";
import { memberRoleSchema, type SharingStore, type BoardInvitation } from "./sharing.js";

type InvitationRow = { id: string; email: string; role: string; expires_at: Date };
const invitation = (row: InvitationRow): BoardInvitation => ({
  id: row.id, email: row.email, role: memberRoleSchema.parse(row.role), expiresAt: row.expires_at.getTime(),
});
const missingInvite = () => new HttpError(404, "INVITATION_NOT_FOUND", "Invitation not found or expired");

export function createPostgresSharingStore(prisma: PrismaClient): SharingStore {
  return {
    get(boardId, userId) {
      return prisma.$transaction(async (tx) => {
        await requireOwner(tx, boardId, userId);
        const members = await tx.boardMember.findMany({
          where: { boardId }, orderBy: { createdAt: "asc" },
          select: { userId: true, role: true, user: { select: { email: true, displayName: true } } },
        });
        const invitations = await tx.$queryRaw<InvitationRow[]>`
          SELECT id, email, role, expires_at FROM board_invitations
          WHERE board_id = ${boardId}::uuid AND expires_at > clock_timestamp() ORDER BY created_at, id
        `;
        return {
          members: members.map((member) => ({ userId: member.userId, ...member.user, role: memberRoleSchema.parse(member.role) })),
          invitations: invitations.map(invitation),
        };
      });
    },
    invite(boardId, userId, input) {
      return prisma.$transaction(async (tx) => {
        await requireOwner(tx, boardId, userId);
        const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
        if (owner.email.toLowerCase() === input.email) throw new HttpError(400, "CANNOT_INVITE_OWNER", "The owner already has full access");
        const existing = await tx.$queryRaw<{ user_id: string }[]>`
          SELECT m.user_id FROM board_members m JOIN users u ON u.id = m.user_id
          WHERE m.board_id = ${boardId}::uuid AND lower(u.email) = ${input.email}
        `;
        if (existing[0]) throw new HttpError(409, "ALREADY_A_MEMBER", "This person already has access. Change their role in Members.");
        const rows = await tx.$queryRaw<InvitationRow[]>`
          INSERT INTO board_invitations (id, board_id, email, role)
          VALUES (${randomUUID()}::uuid, ${boardId}::uuid, ${input.email}, ${input.role})
          ON CONFLICT (board_id, email) DO UPDATE SET role = EXCLUDED.role,
            expires_at = GREATEST(clock_timestamp() + interval '7 days', board_invitations.created_at + interval '7 days')
          RETURNING id, email, role, expires_at
        `;
        return invitation(rows[0]);
      });
    },
    async cancel(boardId, userId, inviteId) {
      await prisma.$transaction(async (tx) => {
        await requireOwner(tx, boardId, userId);
        const result = await tx.boardInvitation.deleteMany({ where: { id: inviteId, boardId } });
        if (!result.count) throw missingInvite();
      });
    },
    async updateMember(boardId, userId, memberId, role) {
      await prisma.$transaction(async (tx) => {
        await requireOwner(tx, boardId, userId);
        if (memberId === userId) throw new HttpError(400, "OWNER_ROLE_FIXED", "The owner role cannot be changed");
        const result = await tx.boardMember.updateMany({ where: { boardId, userId: memberId }, data: { role } });
        if (!result.count) throw new HttpError(404, "MEMBER_NOT_FOUND", "Member not found");
      });
    },
    async removeMember(boardId, userId, memberId) {
      await prisma.$transaction(async (tx) => {
        await requireOwner(tx, boardId, userId);
        if (memberId === userId) throw new HttpError(400, "OWNER_ROLE_FIXED", "The owner cannot be removed");
        const result = await tx.boardMember.deleteMany({ where: { boardId, userId: memberId } });
        if (!result.count) throw new HttpError(404, "MEMBER_NOT_FOUND", "Member not found");
      });
    },
    async incoming(_userId, email) {
      const rows = await prisma.$queryRaw<(InvitationRow & { board_id: string; board_title: string; owner_email: string })[]>`
        SELECT i.id, i.email, i.role, i.expires_at, i.board_id, b.title AS board_title, u.email AS owner_email
        FROM board_invitations i JOIN boards b ON b.id = i.board_id JOIN users u ON u.id = b.owner_id
        WHERE i.email = ${email.toLowerCase()} AND i.expires_at > clock_timestamp() ORDER BY i.created_at, i.id
      `;
      return rows.map((row) => ({ ...invitation(row), boardId: row.board_id, boardTitle: row.board_title, ownerEmail: row.owner_email }));
    },
    async accept(inviteId, userId, email) {
      return prisma.$transaction(async (tx) => {
        const invite = await tx.boardInvitation.findFirst({ where: { id: inviteId, email: email.toLowerCase() }, select: { boardId: true } });
        if (!invite) throw missingInvite();
        // Recipient acceptance shares the board lock with owner cancellation/revocation.
        const boards = await tx.$queryRaw<{ owner_id: string | null }[]>`
          SELECT owner_id FROM boards WHERE id = ${invite.boardId}::uuid FOR UPDATE
        `;
        if (!boards[0]?.owner_id || boards[0].owner_id === userId) throw missingInvite();
        const rows = await tx.$queryRaw<(InvitationRow & { board_id: string })[]>`
          DELETE FROM board_invitations WHERE id = ${inviteId}::uuid AND email = ${email.toLowerCase()}
            AND expires_at > clock_timestamp() RETURNING id, email, role, expires_at, board_id
        `;
        const row = rows[0];
        if (!row) throw missingInvite();
        await tx.boardMember.upsert({
          where: { boardId_userId: { boardId: row.board_id, userId } },
          create: { boardId: row.board_id, userId, role: row.role }, update: { role: row.role },
        });
        const board = await tx.board.findUniqueOrThrow({ where: { id: row.board_id }, select: { id: true, title: true, createdAt: true, updatedAt: true } });
        return { id: board.id, title: board.title, createdAt: board.createdAt.getTime(), updatedAt: board.updatedAt.getTime(), role: memberRoleSchema.parse(row.role) };
      });
    },
    async decline(inviteId, _userId, email) {
      await prisma.$transaction(async (tx) => {
        const invite = await tx.boardInvitation.findFirst({ where: { id: inviteId, email: email.toLowerCase() }, select: { boardId: true } });
        if (!invite) throw missingInvite();
        await tx.$queryRaw`SELECT id FROM boards WHERE id = ${invite.boardId}::uuid FOR UPDATE`;
        const result = await tx.$executeRaw`
          DELETE FROM board_invitations WHERE id = ${inviteId}::uuid AND email = ${email.toLowerCase()} AND expires_at > clock_timestamp()
        `;
        if (!result) throw missingInvite();
      });
    },
  };
}
