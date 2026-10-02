import type { Pool } from "pg";
import { canvasDocumentSchema } from "./contracts/canvasDocument.js";
import type { BoardDocument, BoardDocumentStore } from "./documents.js";
import { HttpError } from "./errors.js";

type DocumentRow = {
  board_id: string;
  schema_version: number;
  revision: number;
  content: unknown;
  updated_at: Date;
};
type ReadRow = { board_exists: string } & (DocumentRow | { [Key in keyof DocumentRow]: null });
const columns = "board_id, schema_version, revision, content, updated_at";

function toDocument(row: DocumentRow): BoardDocument {
  const parsed = canvasDocumentSchema.safeParse({ schemaVersion: row.schema_version, content: row.content });
  if (!parsed.success) {
    throw new HttpError(500, "INVALID_STORED_DOCUMENT", "The saved document has an unsupported or invalid format");
  }
  return { ...parsed.data, boardId: row.board_id, revision: row.revision, updatedAt: row.updated_at.getTime() };
}

export function createPostgresDocumentStore(pool: Pool): BoardDocumentStore {
  return {
    async get(boardId) {
      // One statement gives a consistent distinction between missing board/content.
      const result = await pool.query<ReadRow>(
        `SELECT b.id AS board_exists, d.board_id, d.schema_version, d.revision, d.content, d.updated_at
         FROM boards b LEFT JOIN board_documents d ON d.board_id = b.id WHERE b.id = $1`,
        [boardId],
      );
      const row = result.rows[0];
      if (!row) return { status: "board-not-found" };
      if (row.board_id === null) return { status: "document-not-found" };
      return { status: "found", document: toDocument(row) };
    },

    async save(boardId, input) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // All saves lock the parent first, matching board rename/delete locking.
        const board = await client.query("SELECT id FROM boards WHERE id = $1 FOR UPDATE", [boardId]);
        if (board.rowCount === 0) {
          await client.query("ROLLBACK");
          return { status: "board-not-found" };
        }

        const values = [boardId, input.schemaVersion, JSON.stringify(input.content)];
        const result = input.expectedRevision === 0
          ? await client.query<DocumentRow>(
            `INSERT INTO board_documents (board_id, schema_version, revision, content, updated_at)
             VALUES ($1, $2, 1, $3::jsonb,
               (SELECT GREATEST(clock_timestamp(), updated_at) FROM boards WHERE id = $1))
             ON CONFLICT (board_id) DO NOTHING RETURNING ${columns}`,
            values,
          )
          : await client.query<DocumentRow>(
            `UPDATE board_documents SET schema_version = $2, revision = revision + 1, content = $3::jsonb,
               updated_at = GREATEST(clock_timestamp(), updated_at,
                 (SELECT b.updated_at FROM boards b WHERE b.id = $1))
             WHERE board_id = $1 AND revision = $4 RETURNING ${columns}`,
            [...values, input.expectedRevision],
          );

        const row = result.rows[0];
        if (!row) {
          const current = await client.query<{ revision: number }>("SELECT revision FROM board_documents WHERE board_id = $1", [boardId]);
          await client.query("ROLLBACK");
          return { status: "conflict", currentRevision: current.rows[0]?.revision ?? 0 };
        }

        // Copy the actual SQL timestamp, without losing sub-millisecond precision.
        await client.query(
          "UPDATE boards SET updated_at = (SELECT updated_at FROM board_documents WHERE board_id = $1) WHERE id = $1",
          [boardId],
        );
        const document = toDocument(row);
        await client.query("COMMIT");
        return { status: "saved", created: input.expectedRevision === 0, document };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
