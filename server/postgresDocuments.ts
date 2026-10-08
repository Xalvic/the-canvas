import type { PrismaClient } from "./generated/prisma/client.js";
import { cloudDocumentSchema, documentAssetIds } from "./contracts/cloudDocument.js";
import { markDocumentAssets } from "./postgresAssets.js";
import type { BoardDocument, BoardDocumentStore, DocumentSaveResult } from "./documents.js";
import { HttpError } from "./errors.js";
import { boardRoleSql, lockBoardAccess } from "./boardPermissions.js";
import type { BoardRole } from "./boards.js";

type DocumentRow = {
  board_id: string;
  schema_version: number;
  revision: number;
  content: unknown;
  updated_at: Date;
  role?: BoardRole;
};
type ReadRow = { board_exists: string } & (DocumentRow | { [Key in keyof DocumentRow]: null });

function toDocument(row: DocumentRow): BoardDocument {
  const parsed = cloudDocumentSchema.safeParse({ schemaVersion: row.schema_version, content: row.content });
  if (!parsed.success) {
    throw new HttpError(500, "INVALID_STORED_DOCUMENT", "The saved document has an unsupported or invalid format");
  }
  return { ...parsed.data, boardId: row.board_id, revision: row.revision, updatedAt: row.updated_at.getTime(), role: row.role ?? "owner" };
}

export function createPostgresDocumentStore(prisma: PrismaClient): BoardDocumentStore {
  return {
    async get(boardId, ownerId) {
      // One statement gives a consistent distinction between missing board/content.
      const rows = await prisma.$queryRaw<ReadRow[]>`
        SELECT b.id AS board_exists, d.board_id, d.schema_version, d.revision, d.content, d.updated_at, ${boardRoleSql(ownerId)} AS role
        FROM boards b LEFT JOIN board_documents d ON d.board_id = b.id
        LEFT JOIN board_members m ON m.board_id = b.id AND m.user_id = ${ownerId}::uuid
        WHERE b.id = ${boardId}::uuid AND b.owner_id IS NOT NULL
          AND (${boardRoleSql(ownerId)}) IS NOT NULL
      `;
      const row = rows[0];
      if (!row) return { status: "board-not-found" };
      if (row.board_id === null) return { status: "document-not-found" };
      return { status: "found", document: toDocument(row) };
    },

    async save(boardId, input, ownerId) {
      return prisma.$transaction<DocumentSaveResult>(async (tx) => {
        // All saves lock the parent first, matching board rename/delete locking.
        const access = await lockBoardAccess(tx, boardId, ownerId, "edit");
        if (!access) return { status: "board-not-found" };

        // Detect stale saves first, without retaining assets from a rejected save.
        const current = await tx.boardDocument.findUnique({ where: { boardId }, select: { revision: true } });
        if ((current?.revision ?? 0) !== input.expectedRevision) {
          return { status: "conflict", currentRevision: current?.revision ?? 0 };
        }
        await markDocumentAssets(tx, boardId, documentAssetIds(input));

        const content = JSON.stringify(input.content);
        const rows = input.expectedRevision === 0
          ? await tx.$queryRaw<DocumentRow[]>`
            INSERT INTO board_documents (board_id, schema_version, revision, content, updated_at)
            VALUES (${boardId}::uuid, ${input.schemaVersion}, 1, ${content}::jsonb,
              (SELECT GREATEST(clock_timestamp(), updated_at) FROM boards WHERE id = ${boardId}::uuid))
            ON CONFLICT (board_id) DO NOTHING
            RETURNING board_id, schema_version, revision, content, updated_at
          `
          : await tx.$queryRaw<DocumentRow[]>`
            UPDATE board_documents SET schema_version = ${input.schemaVersion}, revision = revision + 1, content = ${content}::jsonb,
               updated_at = GREATEST(clock_timestamp(), updated_at,
                 (SELECT b.updated_at FROM boards b WHERE b.id = ${boardId}::uuid))
            WHERE board_id = ${boardId}::uuid AND revision = ${input.expectedRevision}
            RETURNING board_id, schema_version, revision, content, updated_at
          `;

        const row = rows[0];
        if (!row) {
          const current = await tx.boardDocument.findUnique({ where: { boardId }, select: { revision: true } });
          return { status: "conflict", currentRevision: current?.revision ?? 0 };
        }

        // Copy the actual SQL timestamp, without losing sub-millisecond precision.
        await tx.$executeRaw`
          UPDATE boards SET updated_at = (SELECT updated_at FROM board_documents WHERE board_id = ${boardId}::uuid)
          WHERE id = ${boardId}::uuid
        `;
        const document = toDocument({ ...row, role: access.role });
        return { status: "saved", created: input.expectedRevision === 0, document };
      });
    },
  };
}
