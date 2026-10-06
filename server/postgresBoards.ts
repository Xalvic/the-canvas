import { createHash, randomUUID } from "node:crypto";
import type { Board, Prisma, PrismaClient } from "./generated/prisma/client.js";
import type { BoardMetadata, BoardStore, BoardRole } from "./boards.js";
import { boardRoleSql, lockBoardAccess } from "./boardPermissions.js";
import { HttpError } from "./errors.js";

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

// Shared by explicit page creation and workspace initialization. Call these in
// the caller's transaction; opening a nested transaction would wait on itself.
export async function lockBoardActor(tx: Prisma.TransactionClient, ownerId: string) {
  // Serialize actor mutations while allowing foreign-key KEY SHARE checks in
  // board-locked sharing transactions. FOR UPDATE would invert that lock order.
  const actors = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM users WHERE id = ${ownerId}::uuid FOR NO KEY UPDATE
  `;
  if (!actors[0]) throw new HttpError(401, "UNAUTHENTICATED", "Sign in required");
}

export async function createBlankPage(tx: Prisma.TransactionClient, title: string, ownerId: string): Promise<BoardMetadata> {
  const row = await tx.board.create({ data: { id: randomUUID(), title, ownerId }, select: metadataSelect });
  await tx.$executeRaw`
    INSERT INTO board_documents (board_id, schema_version, revision, content, updated_at)
    SELECT id, 1, 1, '{"objects":[]}'::jsonb, updated_at FROM boards WHERE id = ${row.id}::uuid
  `;
  return toMetadata(row);
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
    async createPage(input, ownerId) {
      // The HTTP boundary normalizes both title and UUID before this hash.
      const payloadHash = createHash("sha256").update(JSON.stringify({
        version: 1, title: input.title, initializeDocument: input.initializeDocument,
      })).digest("hex");
      return prisma.$transaction(async (tx) => {
        // Serialize creations by actor across connections/processes. No network
        // work occurs here; M4 can reuse this lock for workspace initialization.
        await lockBoardActor(tx, ownerId);
        const key = { actorId_requestId: { actorId: ownerId, requestId: input.requestId } };
        const receipt = await tx.boardCreationReceipt.findUnique({ where: key });
        if (receipt) {
          if (receipt.payloadHash !== payloadHash) {
            throw new HttpError(409, "CREATION_REQUEST_CONFLICT", "This creation request was already used with a different payload");
          }
          const expired = await tx.$queryRaw<{ expired: boolean }[]>`
            SELECT expires_at <= clock_timestamp() AS expired FROM board_creation_receipts
            WHERE actor_id = ${ownerId}::uuid AND request_id = ${input.requestId}::uuid
          `;
          if (expired[0].expired) throw new HttpError(410, "CREATION_REQUEST_EXPIRED", "This creation request has expired");
          if (!receipt.boardId) throw new HttpError(410, "CREATION_DESTINATION_GONE", "The page created by this request was deleted");
          const access = await lockBoardAccess(tx, receipt.boardId, ownerId, "read");
          if (!access) {
            // A concurrent deletion may have cleared the FK while the board lock
            // was pending. Access revocation must reveal no board metadata.
            const current = await tx.boardCreationReceipt.findUnique({ where: key });
            if (!current?.boardId) throw new HttpError(410, "CREATION_DESTINATION_GONE", "The page created by this request was deleted");
            throw new HttpError(404, "BOARD_NOT_FOUND", "Board not found");
          }
          const row = await tx.board.findUniqueOrThrow({ where: { id: receipt.boardId }, select: metadataSelect });
          return { board: toMetadata({ ...row, role: access.role }), creation: {
            requestId: input.requestId, documentRevision: 1, replayed: true, expiresAt: receipt.expiresAt.getTime(),
          } };
        }
        const board = await createBlankPage(tx, input.title, ownerId);
        const created = await tx.boardCreationReceipt.create({ data: {
          actorId: ownerId, requestId: input.requestId, payloadHash, boardId: board.id, documentRevision: 1,
        } });
        return { board, creation: {
          requestId: input.requestId, documentRevision: 1, replayed: false, expiresAt: created.expiresAt.getTime(),
        } };
      });
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
