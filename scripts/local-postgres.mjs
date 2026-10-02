import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const command = process.argv[2];
if (!["start", "stop", "status"].includes(command)) throw new Error("Use start, stop, or status");
const executable = fileURLToPath(new URL("../.postgres/pgsql/bin/pg_ctl.exe", import.meta.url));
const data = fileURLToPath(new URL("../.postgres/data", import.meta.url));
const log = fileURLToPath(new URL("../.postgres/server.log", import.meta.url));
if (!existsSync(executable) || !existsSync(data)) {
  console.error("Project-local PostgreSQL is not initialized. See docs/postgresql.md for setup.");
  process.exit(1);
}
const args = [command, "-D", data];
if (command === "start") args.push("-l", log, "-o", "-h 127.0.0.1 -p 5433", "-w");
if (command === "stop") args.push("-m", "fast", "-w");
const result = spawnSync(executable, args, { stdio: "inherit", windowsHide: true });
if (result.error) console.error("Could not run project-local PostgreSQL:", result.error.message);
process.exitCode = result.status ?? 1;
