import { Prisma } from "./generated/prisma/client.js";
import { HttpError } from "./errors.js";
import type { BoardRole } from "./boards.js";

export const boardRoleSql = (userId: string) => Prisma.sql`
  CASE WHEN b.owner_id = ${userId}::uuid THEN 'owner' ELSE m.role END
`;

export async function lockBoardAccess(tx: Prisma.TransactionClient, boardId: string, userId: string, required: "read" | "edit" | "owner") {
  // Lock the parent first; sharing mutations use the same lock as document saves.
  const boards = await tx.$queryRaw<{ id: string; owner_id: string | null }[]>`
    SELECT id, owner_id FROM boards WHERE id = ${boardId}::uuid FOR UPDATE
  `;
  const board = boards[0];
  if (!board || !board.owner_id) return undefined;
  const member = board.owner_id === userId ? null : await tx.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } }, select: { role: true },
  });
  const role = board.owner_id === userId ? "owner" : member?.role;
  if (role !== "owner" && role !== "editor" && role !== "viewer") return undefined;
  if ((required === "owner" && role !== "owner") || (required === "edit" && role === "viewer")) {
    throw new HttpError(403, "BOARD_FORBIDDEN", required === "owner" ? "Only the owner can manage this board" : "This board is read-only");
  }
  return { ownerId: board.owner_id, role: role as BoardRole };
}

export async function requireOwner(tx: Prisma.TransactionClient, boardId: string, userId: string) {
  const access = await lockBoardAccess(tx, boardId, userId, "owner");
  if (!access) throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
  return access;
}
