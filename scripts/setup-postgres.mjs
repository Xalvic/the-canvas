import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Project-local Windows setup, using the EDB binaries linked by postgresql.org.
const root = fileURLToPath(new URL("../", import.meta.url));
const local = `${root}.postgres`;
const bin = `${local}/pgsql/bin`;
const data = `${local}/data`;
const envFile = `${root}.env`;
if (process.platform !== "win32") throw new Error("Use an installed PostgreSQL server on this platform; see docs/postgresql.md");
if (existsSync(data) || existsSync(envFile)) throw new Error("Existing data or .env found; setup will not overwrite it. See docs/postgresql.md");

function run(executable, args) {
  const result = spawnSync(executable, args, { stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error("PostgreSQL setup command failed");
}

await mkdir(local, { recursive: true });
if (!existsSync(`${bin}/initdb.exe`)) {
  console.log("Download PostgreSQL Windows binaries from EDB into .postgres, then rerun setup. See docs/postgresql.md.");
  process.exit(1);
}
const adminPassword = randomBytes(24).toString("hex");
const appPassword = randomBytes(24).toString("hex");
const passwordFile = `${local}/init-password`;
await writeFile(passwordFile, adminPassword, { flag: "wx" });
try {
  run(`${bin}/initdb.exe`, ["-D", data, "-U", "postgres", "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C", `--pwfile=${passwordFile}`]);
} finally {
  await unlink(passwordFile);
}
await writeFile(`${local}/admin.env`, `PGPASSWORD=${adminPassword}\n`, { flag: "wx" });
run(`${bin}/pg_ctl.exe`, ["start", "-D", data, "-l", `${local}/server.log`, "-o", "-h 127.0.0.1 -p 5433", "-w"]);
const admin = new pg.Client({ host: "127.0.0.1", port: 5433, user: "postgres", password: adminPassword, database: "postgres" });
try {
  await admin.connect();
  // PostgreSQL quotes the generated password as a literal; it is never printed.
  const role = await admin.query("SELECT format('CREATE ROLE scribble LOGIN PASSWORD %L', $1::text) AS sql", [appPassword]);
  await admin.query(role.rows[0].sql);
  await admin.query("CREATE DATABASE scribble OWNER scribble");
  await writeFile(envFile, `DATABASE_URL=postgresql://scribble:${appPassword}@127.0.0.1:5433/scribble\nAPI_PORT=3001\n`, { flag: "wx" });
  console.log("Local database created. Credentials saved in ignored .env; API role is not a superuser. Run npm run db:migrate.");
} finally {
  await admin.end();
}
