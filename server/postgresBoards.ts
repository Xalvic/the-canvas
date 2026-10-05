import { randomUUID } from "node:crypto";
import type { Board, PrismaClient } from "./generated/prisma/client.js";
import type { BoardMetadata, BoardStore, BoardRole } from "./boards.js";
import { boardRoleSql, lockBoardAccess } from "./boardPermissions.js";

type BoardRow = Pick<Board, "id" | "title" | "createdAt" | "updatedAt"> & { role?: BoardRole };
const metadataSelect = { id: true, title: true, createdAt: true, updatedAt: true } as const;

function toMetadata(row: BoardRow): BoardMetadata {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    role: row.role ?? "owner",
  };
}

export function createPostgresBoardStore(prisma: PrismaClient): BoardStore {
  return {
    async list(ownerId) {
      const rows = await prisma.$queryRaw<BoardRow[]>`
        SELECT b.id, b.title, b.created_at AS "createdAt", b.updated_at AS "updatedAt", ${boardRoleSql(ownerId)} AS role
        FROM boards b LEFT JOIN board_members m ON m.board_id = b.id AND m.user_id = ${ownerId}::uuid
        WHERE b.owner_id IS NOT NULL AND (b.owner_id = ${ownerId}::uuid OR m.role IN ('editor', 'viewer'))
        ORDER BY b.created_at, b.id
      `;
      return rows.map(toMetadata);
    },
    async get(id, ownerId) {
      const rows = await prisma.$queryRaw<BoardRow[]>`
        SELECT b.id, b.title, b.created_at AS "createdAt", b.updated_at AS "updatedAt", ${boardRoleSql(ownerId)} AS role
        FROM boards b LEFT JOIN board_members m ON m.board_id = b.id AND m.user_id = ${ownerId}::uuid
        WHERE b.id = ${id}::uuid AND b.owner_id IS NOT NULL
          AND (b.owner_id = ${ownerId}::uuid OR m.role IN ('editor', 'viewer'))
      `;
      return rows[0] ? toMetadata(rows[0]) : undefined;
    },
    async create(title, ownerId) {
      const row = await prisma.board.create({ data: { id: randomUUID(), title, ownerId }, select: metadataSelect });
      return toMetadata(row);
    },
    async rename(id, title, ownerId) {
      // Keep the atomic no-op/monotonic timestamp behavior in SQL. Tagged
      // parameters are bound by Prisma, including titles containing SQL text.
      return prisma.$transaction(async (tx) => {
        const access = await lockBoardAccess(tx, id, ownerId, "edit");
        if (!access) return undefined;
        const rows = await tx.$queryRaw<BoardRow[]>`
          UPDATE boards SET title = ${title},
            updated_at = CASE WHEN title = ${title} THEN updated_at ELSE GREATEST(clock_timestamp(), updated_at) END
          WHERE id = ${id}::uuid
          RETURNING id, title, created_at AS "createdAt", updated_at AS "updatedAt", ${access.role}::text AS role
        `;
        return rows[0] ? toMetadata(rows[0]) : undefined;
      });
    },
    async delete(id, ownerId) {
      return prisma.$transaction(async (tx) => {
        if (!await lockBoardAccess(tx, id, ownerId, "owner")) return false;
        const result = await tx.board.deleteMany({ where: { id, ownerId } });
        return result.count === 1;
      });
    },
  };
}
