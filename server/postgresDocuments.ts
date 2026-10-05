import type { PrismaClient } from "./generated/prisma/client.js";
import { canvasDocumentSchema } from "./contracts/canvasDocument.js";
import type { BoardDocument, BoardDocumentStore, DocumentSaveResult } from "./documents.js";
import { HttpError } from "./errors.js";

type DocumentRow = {
  board_id: string;
  schema_version: number;
  revision: number;
  content: unknown;
  updated_at: Date;
};
type ReadRow = { board_exists: string } & (DocumentRow | { [Key in keyof DocumentRow]: null });

function toDocument(row: DocumentRow): BoardDocument {
  const parsed = canvasDocumentSchema.safeParse({ schemaVersion: row.schema_version, content: row.content });
  if (!parsed.success) {
    throw new HttpError(500, "INVALID_STORED_DOCUMENT", "The saved document has an unsupported or invalid format");
  }
  return { ...parsed.data, boardId: row.board_id, revision: row.revision, updatedAt: row.updated_at.getTime() };
}

export function createPostgresDocumentStore(prisma: PrismaClient): BoardDocumentStore {
  return {
    async get(boardId, ownerId) {
      // One statement gives a consistent distinction between missing board/content.
      const rows = await prisma.$queryRaw<ReadRow[]>`
        SELECT b.id AS board_exists, d.board_id, d.schema_version, d.revision, d.content, d.updated_at
        FROM boards b LEFT JOIN board_documents d ON d.board_id = b.id
        WHERE b.id = ${boardId}::uuid AND b.owner_id = ${ownerId}::uuid
      `;
      const row = rows[0];
      if (!row) return { status: "board-not-found" };
      if (row.board_id === null) return { status: "document-not-found" };
      return { status: "found", document: toDocument(row) };
    },

    async save(boardId, input, ownerId) {
      return prisma.$transaction<DocumentSaveResult>(async (tx) => {
        // All saves lock the parent first, matching board rename/delete locking.
        const board = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM boards WHERE id = ${boardId}::uuid AND owner_id = ${ownerId}::uuid FOR UPDATE
        `;
        if (!board[0]) return { status: "board-not-found" };

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
        const document = toDocument(row);
        return { status: "saved", created: input.expectedRevision === 0, document };
      });
    },
  };
}
