import { randomUUID } from "node:crypto";
import type { Board, PrismaClient } from "./generated/prisma/client.js";
import type { BoardMetadata, BoardStore } from "./boards.js";

type BoardRow = Pick<Board, "id" | "title" | "createdAt" | "updatedAt">;
const metadataSelect = { id: true, title: true, createdAt: true, updatedAt: true } as const;

function toMetadata(row: BoardRow): BoardMetadata {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export function createPostgresBoardStore(prisma: PrismaClient): BoardStore {
  return {
    async list(ownerId) {
      const rows = await prisma.board.findMany({
        where: { ownerId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: metadataSelect,
      });
      return rows.map(toMetadata);
    },
    async get(id, ownerId) {
      const row = await prisma.board.findFirst({ where: { id, ownerId }, select: metadataSelect });
      return row ? toMetadata(row) : undefined;
    },
    async create(title, ownerId) {
      const row = await prisma.board.create({ data: { id: randomUUID(), title, ownerId }, select: metadataSelect });
      return toMetadata(row);
    },
    async rename(id, title, ownerId) {
      // Keep the atomic no-op/monotonic timestamp behavior in SQL. Tagged
      // parameters are bound by Prisma, including titles containing SQL text.
      const rows = await prisma.$queryRaw<BoardRow[]>`
        UPDATE boards SET title = ${title},
          updated_at = CASE WHEN title = ${title} THEN updated_at ELSE GREATEST(clock_timestamp(), updated_at) END
        WHERE id = ${id}::uuid AND owner_id = ${ownerId}::uuid
        RETURNING id, title, created_at AS "createdAt", updated_at AS "updatedAt"
      `;
      return rows[0] ? toMetadata(rows[0]) : undefined;
    },
    async delete(id, ownerId) {
      const result = await prisma.board.deleteMany({ where: { id, ownerId } });
      return result.count === 1;
    },
  };
}
