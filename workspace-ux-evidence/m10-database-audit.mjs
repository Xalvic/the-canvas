import pg from 'pg';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const fingerprints = [];
  for (const { tablename } of tables) {
    if (!/^[a-z_]+$/.test(tablename)) throw new Error('Unexpected audit table');
    const rows = (await pool.query(`SELECT to_jsonb(t) AS row FROM public."${tablename}" t ORDER BY to_jsonb(t)::text`)).rows;
    const columns = (await pool.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [tablename])).rows;
    const constraints = (await pool.query("SELECT conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname=$1 ORDER BY conname", [tablename])).rows;
    const indexes = (await pool.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname", [tablename])).rows;
    fingerprints.push({ table: tablename, count: rows.length, data: hash(rows), definition: hash({ columns, constraints, indexes }) });
  }
  const disposableSchemas = (await pool.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'scribble%test%' OR nspname LIKE 'scribble%fixture%' ORDER BY nspname")).rows;
  const snapshot = { fingerprints, disposableSchemas };
  const file = new URL('./m10-database-isolation.json', import.meta.url);
  if (process.argv[2] === 'before') await writeFile(file, JSON.stringify({ before: snapshot }, null, 2) + '\n');
  else {
    const evidence = JSON.parse(await readFile(file, 'utf8'));
    evidence.after = snapshot; evidence.unchanged = hash(evidence.before) === hash(snapshot);
    await writeFile(file, JSON.stringify(evidence, null, 2) + '\n');
    if (!evidence.unchanged) throw new Error('Normal database audit differs');
  }
  console.log(JSON.stringify({ tables: fingerprints.length, rows: fingerprints.reduce((sum, t) => sum + t.count, 0), disposableSchemas: disposableSchemas.length }));
} finally { await pool.end(); }
