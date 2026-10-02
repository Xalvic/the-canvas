import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

export async function migrateDatabase(pool: Pool) {
  const sql = await readFile(new URL("../db/001_create_boards.sql", import.meta.url), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize migration runners for this database/schema.
    await client.query("SELECT pg_advisory_xact_lock(734621001)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = await client.query("SELECT version FROM schema_migrations WHERE version = 1");
    if (applied.rowCount === 0) {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES (1)");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
