import { readFile } from "node:fs/promises";
import type { Pool } from "pg";

const migrations = [
  { version: 1, file: "001_create_boards.sql" },
  { version: 2, file: "002_create_board_documents.sql" },
  { version: 3, file: "003_create_google_auth.sql" },
  { version: 4, file: "004_add_board_ownership.sql" },
  { version: 5, file: "005_create_board_sharing.sql" },
  { version: 6, file: "006_create_board_assets.sql" },
  { version: 7, file: "007_create_board_operation_receipts.sql" },
  { version: 8, file: "008_create_api_request_budgets.sql" },
  { version: 9, file: "009_create_board_creation_receipts.sql" },
] as const;

export async function migrateDatabase(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize migration runners for this database/schema.
    await client.query("SELECT pg_advisory_xact_lock(734621001)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = await client.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version");
    const appliedVersions = new Set(applied.rows.map(({ version }) => version));
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      const sql = await readFile(new URL(`../db/${migration.file}`, import.meta.url), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration.version]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
