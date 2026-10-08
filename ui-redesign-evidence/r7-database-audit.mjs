import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';

const target = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5434', 'R7 audit requires local Docker PostgreSQL');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mode = process.argv[2];
const migration = mode?.endsWith('migration');
const file = new URL(migration ? './r7-local-migration.json' : './r7-database-isolation.json', import.meta.url);
try {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const fingerprints = [];
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    const rows = (await pool.query(`SELECT to_jsonb(t) AS row FROM public."${tablename}" t ORDER BY to_jsonb(t)::text`)).rows;
    const columns = (await pool.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [tablename])).rows;
    const constraints = (await pool.query("SELECT conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname=$1 ORDER BY conname", [tablename])).rows;
    const indexes = (await pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname", [tablename])).rows;
    fingerprints.push({ table: tablename, count: rows.length, data: digest(rows), definition: digest({ columns, constraints, indexes }) });
  }
  const ledger = (await pool.query('SELECT version,applied_at FROM public.schema_migrations ORDER BY version')).rows;
  const disposableSchemas = (await pool.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'scribble%test%' OR nspname LIKE 'scribble%fixture%' ORDER BY nspname")).rows;
  const snapshot = { fingerprints, ledger, disposableSchemas };
  if (mode === 'before' || mode === 'before-migration') {
    await writeFile(file, JSON.stringify({ before: snapshot }, null, 2) + '\n', { flag: 'wx' });
  } else {
    assert.ok(mode === 'after' || mode === 'after-migration', 'Use before/after or before-migration/after-migration');
    const evidence = JSON.parse(await readFile(file, 'utf8'));
    evidence.after = snapshot;
    if (migration) {
      const changes = evidence.before.fingerprints.filter((before) => before.table !== 'schema_migrations' && digest(before) !== digest(fingerprints.find((after) => after.table === before.table)));
      const added = fingerprints.filter((after) => !evidence.before.fingerprints.some((before) => before.table === after.table));
      evidence.existingDataPreserved = changes.length === 0 && digest(evidence.before.ledger) === digest(ledger.filter((row) => row.version !== 12));
      evidence.addedTables = added.map((table) => table.table);
      evidence.additiveMigrationVerified = evidence.existingDataPreserved && added.every((table) => table.count === 0)
        && digest(evidence.addedTables) === digest(['board_share_link_grants', 'board_share_link_receipts', 'board_share_links']) && ledger.at(-1)?.version === 12;
      await writeFile(file, JSON.stringify(evidence, null, 2) + '\n');
      assert.ok(evidence.additiveMigrationVerified, 'Local migration changed existing data or unexpected tables');
    } else {
      evidence.unchanged = digest(evidence.before) === digest(snapshot);
      await writeFile(file, JSON.stringify(evidence, null, 2) + '\n');
      assert.ok(evidence.unchanged, 'Normal database changed during acceptance');
    }
    assert.equal(disposableSchemas.length, 0, 'Disposable schemas remain');
  }
  console.log(JSON.stringify({ mode, tables: fingerprints.length, rows: fingerprints.reduce((sum, table) => sum + table.count, 0), latestMigration: ledger.at(-1)?.version, disposableSchemas: disposableSchemas.length }));
} finally { await pool.end(); }
