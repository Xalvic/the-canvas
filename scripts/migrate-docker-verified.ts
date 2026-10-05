import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createDatabasePool, loadDatabaseUrl } from "../server/database.js";
import { migrateDatabase } from "../server/migrations.js";

// This proof is deliberately restricted to the normal Docker database. It
// cannot target the portable database or a production URL by mistake.
const url = new URL(loadDatabaseUrl());
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "5434");
assert.equal(url.pathname, "/scribble");
const pool = createDatabasePool(url.href);
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
try {
  const tables = (await pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename")).rows.map((row) => row.tablename);
  async function fingerprint() {
    const snapshots = [];
    let rows = 0;
    for (const table of tables) {
      const data = (await pool.query(`SELECT to_jsonb(t) AS row FROM public.${quote(table)} t ORDER BY to_jsonb(t)::text`)).rows;
      const columns = (await pool.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table])).rows;
      const constraints = (await pool.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY conname", [`public.${quote(table)}`])).rows;
      const indexes = (await pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname", [table])).rows;
      snapshots.push({ table, data, columns, constraints, indexes }); rows += data.length;
    }
    return { digest: hash(snapshots), rows };
  }
  const ledger = (await pool.query("SELECT * FROM schema_migrations ORDER BY version")).rows;
  const before = await fingerprint();
  await migrateDatabase(pool);
  assert.deepEqual(await fingerprint(), before, "Existing database contents or definitions changed");
  const afterLedger = (await pool.query("SELECT * FROM schema_migrations ORDER BY version")).rows;
  for (const row of ledger) assert.deepEqual(afterLedger.find((item) => item.version === row.version), row);
  console.log(JSON.stringify({ existingTablesUnchanged: tables.length, existingRowsUnchanged: before.rows, migrations: afterLedger.map((row) => row.version) }));
} catch {
  console.error("Docker migration verification failed. Inspect migration state locally; no database contents or credentials were logged.");
  process.exitCode = 1;
} finally { await pool.end(); }
