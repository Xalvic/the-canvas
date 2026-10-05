import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, open, link, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { postgresTool } from "./backup-tools.mjs";

export const HEADER = Buffer.from("SCRBLB01");
export function encryptionKey(env = process.env) {
  if (!/^[0-9a-fA-F]{64}$/.test(env.BACKUP_ENCRYPTION_KEY || "")) throw new Error("Set BACKUP_ENCRYPTION_KEY to a securely generated 32-byte hexadecimal key");
  return Buffer.from(env.BACKUP_ENCRYPTION_KEY, "hex");
}
export async function backup(env = process.env) {
  const key = encryptionKey(env);
  const connection = env.DIRECT_DATABASE_URL || env.DATABASE_URL;
  if (!connection) throw new Error("Set DIRECT_DATABASE_URL for the backup source");
  if (!env.BACKUP_FILE) throw new Error("Set BACKUP_FILE to an explicit encrypted output path");
  const destination = resolve(env.BACKUP_FILE), temporary = `${destination}.${randomBytes(8).toString("hex")}.partial`;
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  // Never replace a prior backup or its manifest.
  for (const path of [destination, `${destination}.manifest.json`]) {
    const exists = await open(path, "r").then(async (file) => { await file.close(); return true; }, (error) => { if (error.code === "ENOENT") return false; throw error; });
    if (exists) throw new Error("Backup output already exists");
  }
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(HEADER);
  let tool;
  try {
    await writeFile(temporary, Buffer.concat([HEADER, nonce]), { flag: "wx", mode: 0o600 });
    tool = await postgresTool("pg_dump", ["--no-password", "--format=custom", "--no-owner", "--no-acl"], connection, env);
    tool.child.stdin.end();
    await pipeline(tool.child.stdout, cipher, createWriteStream(temporary, { flags: "a", mode: 0o600 }));
    await tool.finished;
    const file = await open(temporary, "a");
    try { await file.write(cipher.getAuthTag()); await file.sync(); } finally { await file.close(); }
    const summary = await encryptedSummary(temporary);
    await link(temporary, destination); // Atomic exclusive creation, including concurrent scheduled runs.
    await unlink(temporary);
    await chmod(destination, 0o600);
    await writeFile(`${destination}.manifest.json`, JSON.stringify({ version: 1, format: "postgres-custom", encryption: "aes-256-gcm", createdAt: new Date().toISOString(), postgresToolsMajor: 18, ...summary }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    return summary;
  } catch (error) {
    tool?.child.kill();
    await unlink(temporary).catch(() => {});
    throw error;
  } finally { key.fill(0); }
}
export async function encryptedSummary(path) {
  const hash = createHash("sha256"); let bytes = 0;
  const file = await open(path, "r");
  try { for await (const chunk of file.createReadStream()) { hash.update(chunk); bytes += chunk.length; } }
  finally { await file.close(); }
  return { sha256: hash.digest("hex"), bytes };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  backup().then((summary) => console.log(`Encrypted database backup completed (${summary.bytes} bytes)`)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
