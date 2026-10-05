import { createDecipheriv } from "node:crypto";
import { copyFile, mkdtemp, open, readFile, rm, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HEADER, encryptionKey, encryptedSummary } from "./backup.mjs";
import { postgresTool, queryTarget } from "./backup-tools.mjs";

const emptyTarget = `SELECT count(*) FROM (
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
 UNION ALL SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname NOT LIKE 'pg_%'
 UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
 UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
 UNION ALL SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql'
) objects`;

async function decryptInto(path, key, output) {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    if (size < HEADER.length + 12 + 16 + 5) throw new Error("Encrypted archive is truncated");
    const prefix = Buffer.alloc(20), tag = Buffer.alloc(16);
    await file.read(prefix, 0, 20, 0); await file.read(tag, 0, 16, size - 16);
    if (!prefix.subarray(0, 8).equals(HEADER)) throw new Error("Unsupported encrypted archive format");
    const decipher = createDecipheriv("aes-256-gcm", key, prefix.subarray(8));
    decipher.setAAD(HEADER); decipher.setAuthTag(tag);
    await pipeline(file.createReadStream({ start: 20, end: size - 17, autoClose: false }), decipher, output);
  } finally { await file.close(); }
}
export async function restore(env = process.env) {
  const key = encryptionKey(env);
  if (!env.RESTORE_DATABASE_URL || env.RESTORE_EMPTY_TARGET !== "YES") throw new Error("Set RESTORE_DATABASE_URL explicitly and RESTORE_EMPTY_TARGET=YES for an empty target");
  if (!env.BACKUP_FILE) throw new Error("Set BACKUP_FILE to the encrypted archive");
  // Snapshot ciphertext privately so all validation/restore passes see the same bytes.
  const parent = resolve(tmpdir()), temporary = await mkdtemp(join(parent, "scribble-restore-"));
  if (!temporary.startsWith(`${parent}${sep}`)) throw new Error("Unsafe restore temporary path");
  const archive = join(temporary, "archive.enc"); let tool;
  try {
    await chmod(temporary, 0o700);
    await copyFile(resolve(env.BACKUP_FILE), archive, constants.COPYFILE_EXCL); await chmod(archive, 0o600);
    const manifest = JSON.parse(await readFile(`${resolve(env.BACKUP_FILE)}.manifest.json`, "utf8"));
    const summary = await encryptedSummary(archive);
    if (manifest.version !== 1 || manifest.format !== "postgres-custom" || manifest.encryption !== "aes-256-gcm" || manifest.sha256 !== summary.sha256 || manifest.bytes !== summary.bytes) throw new Error("Encrypted backup manifest does not match the archive");
    let prefix = Buffer.alloc(0);
    await decryptInto(archive, key, new Writable({ write(chunk, encoding, callback) { if (prefix.length < 5) prefix = Buffer.concat([prefix, chunk]).subarray(0, 5); callback(); } }));
    if (prefix.toString("ascii") !== "PGDMP") throw new Error("Backup is not a PostgreSQL custom archive");
    tool = await postgresTool("pg_restore", ["--list"], null, env);
    tool.child.stdout.resume();
    await decryptInto(archive, key, tool.child.stdin); await tool.finished;
    // Archive integrity is checked before any target connection or write.
    if (await queryTarget(env.RESTORE_DATABASE_URL, emptyTarget, env) !== "0") throw new Error("Restore refused: target database is not empty");
    tool = await postgresTool("pg_restore", ["--no-password", "--dbname", decodeURIComponent(new URL(env.RESTORE_DATABASE_URL).pathname.slice(1)), "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl"], env.RESTORE_DATABASE_URL, env);
    tool.child.stdout.resume();
    await decryptInto(archive, key, tool.child.stdin); await tool.finished;
    return summary;
  } catch (error) { tool?.child.kill(); throw error; }
  finally { key.fill(0); await rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  restore().then(() => console.log("Database restored into the explicitly configured empty target")).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
