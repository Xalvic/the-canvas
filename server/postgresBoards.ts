import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { BoardMetadata, BoardStore } from "./boards.js";

type BoardRow = { id: string; title: string; created_at: Date; updated_at: Date };
const columns = "id, title, created_at, updated_at";

function toMetadata(row: BoardRow): BoardMetadata {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}

export function createPostgresBoardStore(pool: Pool): BoardStore {
  return {
    async list() {
      const result = await pool.query<BoardRow>(`SELECT ${columns} FROM boards ORDER BY created_at, id`);
      return result.rows.map(toMetadata);
    },
    async get(id) {
      const result = await pool.query<BoardRow>(`SELECT ${columns} FROM boards WHERE id = $1`, [id]);
      return result.rows[0] ? toMetadata(result.rows[0]) : undefined;
    },
    async create(title) {
      const result = await pool.query<BoardRow>(
        `INSERT INTO boards (id, title) VALUES ($1, $2) RETURNING ${columns}`,
        [randomUUID(), title],
      );
      return toMetadata(result.rows[0]);
    },
    async rename(id, title) {
      // One atomic statement; no separate read that can race with another update.
      const result = await pool.query<BoardRow>(
        `UPDATE boards SET title = $2,
         updated_at = CASE WHEN title = $2 THEN updated_at ELSE GREATEST(clock_timestamp(), updated_at) END
         WHERE id = $1 RETURNING ${columns}`,
        [id, title],
      );
      return result.rows[0] ? toMetadata(result.rows[0]) : undefined;
    },
    async delete(id) {
      const result = await pool.query("DELETE FROM boards WHERE id = $1", [id]);
      return result.rowCount === 1;
    },
  };
}
