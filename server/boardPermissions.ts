import { Prisma } from "./generated/prisma/client.js";
import { HttpError } from "./errors.js";
import type { BoardRole } from "./boards.js";

const linkRoleSql = (userId: string) => Prisma.sql`(
  SELECT l.role FROM board_share_links l
  JOIN board_share_link_grants g ON g.board_id = l.board_id AND g.generation = l.generation
  WHERE l.board_id = b.id AND l.enabled AND g.user_id = ${userId}::uuid
)`;

export const boardRoleSql = (userId: string) => Prisma.sql`
  CASE WHEN b.owner_id = ${userId}::uuid THEN 'owner'
    WHEN m.role = 'editor' OR ${linkRoleSql(userId)} = 'editor' THEN 'editor'
    WHEN m.role = 'viewer' OR ${linkRoleSql(userId)} = 'viewer' THEN 'viewer'
    ELSE NULL END
`;

export async function lockBoardAccess(tx: Prisma.TransactionClient, boardId: string, userId: string, required: "read" | "edit" | "owner", readLock: "share" | "update" = "update") {
  // Lock the parent first; sharing mutations use the same lock as document saves.
  // Workspace reads can visit a revoked preference and then a fallback. Shared
  // read locks protect authorization without making those readers lock cycles.
  const lock = required === "read" && readLock === "share" ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`;
  const boards = await tx.$queryRaw<{ id: string; owner_id: string | null }[]>`
    SELECT id, owner_id FROM boards WHERE id = ${boardId}::uuid ${lock}
  `;
  const board = boards[0];
  if (!board || !board.owner_id) return undefined;
  // A fresh statement after the parent lock observes committed revocations and
  // downgrades, including when this transaction had to wait for the owner.
  const [effective] = await tx.$queryRaw<{ role: BoardRole | null }[]>`
    SELECT ${boardRoleSql(userId)} AS role FROM boards b
    LEFT JOIN board_members m ON m.board_id = b.id AND m.user_id = ${userId}::uuid
    WHERE b.id = ${boardId}::uuid
  `;
  const role = effective?.role;
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
