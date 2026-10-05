import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { backup } from "./backup.mjs";

try {
  if (!process.env.BACKUP_DIRECTORY) throw new Error("Set BACKUP_DIRECTORY to a protected backup directory");
  const name = `scribble-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.enc`;
  await backup({ ...process.env, BACKUP_FILE: join(resolve(process.env.BACKUP_DIRECTORY), name) });
  console.log("Scheduled encrypted database backup completed");
} catch {
  console.error("Scheduled database backup failed; inspect configuration and database availability locally");
  process.exitCode = 1;
}
