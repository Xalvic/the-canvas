import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer } from "node:net";
import pg from "pg";
import { backup, encryptedSummary } from "./backup.mjs";
import { restore } from "./restore.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proof = `scribble-backup-proof-${randomBytes(6).toString("hex")}`;
assert.match(proof, /^scribble-backup-proof-[a-f0-9]{12}$/);
const network = `${proof}-network`, sourceName = `${proof}-source`, targetName = `${proof}-target`;
const resources = [sourceName, targetName];
const password = randomBytes(24).toString("hex"), key = randomBytes(32).toString("hex");
const temporaryParent = resolve(tmpdir()), temporary = await mkdtemp(join(temporaryParent, "scribble-backup-proof-"));
assert.ok(temporary.startsWith(`${temporaryParent}${sep}`));
const execute = promisify(execFile);
const docker = "docker";
const commandEnv = { ...process.env, POSTGRES_PASSWORD: password };
async function command(args) {
  try { return (await execute(docker, args, { env: commandEnv, windowsHide: true, timeout: 120_000, maxBuffer: 1024 * 1024 })).stdout.trim(); }
  catch { throw new Error("Disposable backup proof Docker command failed; diagnostics suppressed"); }
}
async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  assert.ok(![5433, 5434, 3001].includes(port)); return port;
}
const sourcePort = await freePort(); let targetPort = await freePort();
while (sourcePort === targetPort) targetPort = await freePort();
const hostUrl = (port) => `postgresql://restoreproof:${password}@127.0.0.1:${port}/scribble`;
const containerUrl = (name) => `postgresql://restoreproof:${password}@${name}:5432/scribble`;
async function database(port, run) {
  const client = new pg.Client({ connectionString: hostUrl(port), connectionTimeoutMillis: 5000 });
  await client.connect(); try { return await run(client); } finally { await client.end(); }
}
async function fingerprint(port) {
  return database(port, async (client) => {
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map((row) => row.tablename);
    const data = {};
    for (const table of tables) {
      assert.match(table, /^[a-z_]+$/);
      data[table] = (await client.query(`SELECT row_to_json(t)::text AS row FROM "${table}" t ORDER BY row_to_json(t)::text`)).rows.map((row) => row.row);
    }
    return { tables, populatedTables: tables.filter((table) => data[table].length > 0),
      sha256: createHash("sha256").update(JSON.stringify(data)).digest("hex") };
  });
}
let checks = 0;
const env = { ...process.env, BACKUP_DISPOSABLE_TEST: "1", PG_TOOLS_NETWORK: network, BACKUP_FILE: join(temporary, "database.enc"), BACKUP_ENCRYPTION_KEY: key, DIRECT_DATABASE_URL: containerUrl(sourceName), RESTORE_DATABASE_URL: containerUrl(targetName), RESTORE_EMPTY_TARGET: "YES" };
try {
  await command(["network", "create", "--label", `scribble.backup-proof=${proof}`, network]);
  for (const name of resources) {
    await command(["volume", "create", "--label", `scribble.backup-proof=${proof}`, `${name}-data`]);
    const port = name === sourceName ? sourcePort : targetPort;
    await command(["run", "-d", "--name", name, "--label", `scribble.backup-proof=${proof}`, "--network", network, "--publish", `127.0.0.1:${port}:5432`, "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_USER=restoreproof", "--env", "POSTGRES_DB=scribble", "--mount", `type=volume,src=${name}-data,dst=/var/lib/postgresql`, "postgres:18.6-bookworm"]);
    for (let attempt = 0; ; attempt++) {
      try { await database(port, (client) => client.query("SELECT 1")); break; }
      catch { if (attempt >= 40) throw new Error("Disposable database did not become ready"); await new Promise((done) => setTimeout(done, 500)); }
    }
  }
  const ids = Array.from({ length: 7 }, () => randomUUID());
  await database(sourcePort, async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("CREATE TABLE schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      const migrations = (await readdir(join(root, "db"))).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
      for (const name of migrations) {
        await client.query(await readFile(join(root, "db", name), "utf8"));
        await client.query("INSERT INTO schema_migrations(version) VALUES ($1)", [Number(name.split("_")[0])]);
      }
      await client.query("INSERT INTO users(id,google_subject,email,display_name) VALUES ($1,'backup-proof-owner','owner@example.invalid','Owner'),($2,'backup-proof-member','member@example.invalid','Member')", ids.slice(0, 2));
      await client.query("INSERT INTO auth_sessions(token_hash,user_id) VALUES ($1,$2)", ["a".repeat(64), ids[0]]);
      await client.query("INSERT INTO google_auth_flows(state_hash,browser_hash,nonce,code_verifier) VALUES ($1,$2,$3,$4)", ["b".repeat(64), "c".repeat(64), "n".repeat(43), "v".repeat(43)]);
      await client.query("INSERT INTO boards(id,title,owner_id) VALUES ($1,'Encrypted backup proof',$2)", [ids[2], ids[0]]);
      const content = { objects: [{ id: "proof-image", type: "image", assetId: ids[3], mimeType: "image/png", intrinsicWidth: 4, intrinsicHeight: 4, x: 12, y: -34, width: 4, height: 4, zIndex: 1, createdAt: 1, updatedAt: 2 }] };
      await client.query("INSERT INTO board_documents(board_id,schema_version,revision,content) VALUES ($1,1,17,$2::jsonb)", [ids[2], JSON.stringify(content)]);
      await client.query("INSERT INTO board_members(board_id,user_id,role) VALUES ($1,$2,'editor')", [ids[2], ids[1]]);
      await client.query("INSERT INTO board_invitations(id,board_id,email,role) VALUES ($1,$2,'invite@example.invalid','viewer')", [ids[4], ids[2]]);
      await client.query("INSERT INTO board_assets(id,board_id,scope_board_id,uploader_id,status,byte_size,mime_type,width,height,provider_file_id,provider_file_path,last_referenced_at) VALUES ($1,$2,$2,$3,'ready',64,'image/png',4,4,'disposable-provider-id','/scribble/dev/proof.png',clock_timestamp())", [ids[3], ids[2], ids[0]]);
      await client.query("INSERT INTO asset_request_budgets(bucket,request_count,byte_count,expires_at) VALUES ('proof',2,128,clock_timestamp()+interval '1 hour')");
      await client.query("INSERT INTO board_operation_receipts(board_id,actor_id,operation_id,payload_hash,applied_revision) VALUES ($1,$2,$3,$4,17)", [ids[2], ids[0], ids[5], "d".repeat(64)]);
      if (migrations.some((name) => name.startsWith("008_"))) await client.query("INSERT INTO api_request_budgets(bucket,request_count,expires_at) VALUES ($1,3,clock_timestamp()+interval '1 hour')", ["e".repeat(64)]);
      if (migrations.some((name) => name.startsWith("009_"))) await client.query("INSERT INTO board_creation_receipts(actor_id,request_id,payload_hash,board_id,document_revision) VALUES ($1,$2,$3,$4,1)", [ids[0], ids[6], "f".repeat(64), ids[2]]);
      if (migrations.some((name) => name.startsWith("010_"))) {
        await client.query("INSERT INTO workspace_states(user_id,initialized_at,last_opened_board_id) VALUES ($1,clock_timestamp(),$2)", [ids[0], ids[2]]);
        await client.query("INSERT INTO workspace_initialization_receipts(actor_id,request_id,create_initial_page) VALUES ($1,$2,true)", [ids[0], ids[6]]);
      }
      if (migrations.some((name) => name.startsWith("011_"))) await client.query("INSERT INTO board_assets(id,board_id,scope_board_id,uploader_id,status,byte_size,mime_type,width,height,provider_file_path,upload_request_id,upload_content_hash,upload_lease_token,upload_lease_until,upload_attempts) VALUES ($1,$2,$2,$3,'pending',64,'image/png',4,4,'/scribble/dev/pending-proof.png',$4,$5,$6,clock_timestamp()+interval '5 seconds',1)", [randomUUID(), ids[2], ids[0], ids[6], "f".repeat(64), randomUUID()]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
  const original = await fingerprint(sourcePort), empty = await fingerprint(targetPort);
  assert.deepEqual(original.populatedTables, original.tables); checks++;
  await assert.rejects(backup({ ...env, BACKUP_ENCRYPTION_KEY: "too-short" }), /32-byte/); checks++;
  await assert.rejects(backup({ ...env, DIRECT_DATABASE_URL: "postgresql://user:password@unverified.example.invalid/scribble?sslmode=require" }), /verify-full/); checks++;
  await backup(env); checks++;
  await assert.rejects(backup(env), /already exists/); checks++;
  await assert.rejects(restore({ ...env, BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("hex") })); checks++;
  assert.deepEqual(await fingerprint(targetPort), empty); checks++;
  const corrupt = join(temporary, "corrupt.enc"), bytes = await readFile(env.BACKUP_FILE);
  bytes[30] ^= 1; await writeFile(corrupt, bytes);
  const manifest = JSON.parse(await readFile(`${env.BACKUP_FILE}.manifest.json`, "utf8"));
  await writeFile(`${corrupt}.manifest.json`, JSON.stringify({ ...manifest, ...await encryptedSummary(corrupt) }));
  await assert.rejects(restore({ ...env, BACKUP_FILE: corrupt })); checks++;
  assert.deepEqual(await fingerprint(targetPort), empty); checks++;
  await assert.rejects(restore({ ...env, RESTORE_EMPTY_TARGET: undefined }), /explicitly/); checks++;
  await restore(env); checks++;
  assert.deepEqual(await fingerprint(targetPort), original); checks++;
  await assert.rejects(restore(env), /not empty/); checks++;
  assert.deepEqual(await fingerprint(targetPort), original); checks++;
  assert.deepEqual(await fingerprint(sourcePort), original); checks++;
  const files = await readdir(temporary);
  assert.ok(files.every((name) => name.endsWith(".enc") || name.endsWith(".manifest.json"))); checks++;
  console.log(`Backup restore proof passed: ${checks} checks, ${original.tables.length} populated tables, exact source/target fingerprints, source unchanged`);
} finally {
  // Only disposable resources bearing this unique proof label may be removed.
  for (const name of resources) {
    const label = await command(["inspect", "--format", '{{index .Config.Labels "scribble.backup-proof"}}', name]).catch(() => null);
    if (label === proof) await command(["rm", "--force", name]);
    const volume = `${name}-data`;
    const volumeLabel = await command(["volume", "inspect", "--format", '{{index .Labels "scribble.backup-proof"}}', volume]).catch(() => null);
    if (volumeLabel === proof) await command(["volume", "rm", volume]);
  }
  const networkLabel = await command(["network", "inspect", "--format", '{{index .Labels "scribble.backup-proof"}}', network]).catch(() => null);
  if (networkLabel === proof) await command(["network", "rm", network]);
  assert.ok(resolve(temporary).startsWith(`${temporaryParent}${sep}`));
  await rm(temporary, { recursive: true, force: true });
}
