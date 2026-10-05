import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function postgresTool(command, args, connection, env = process.env) {
  const toolEnv = { ...env };
  for (const name of Object.keys(toolEnv)) if (name.startsWith("PG")) delete toolEnv[name];
  if (connection) {
    let url;
    try { url = new URL(connection); } catch { throw new Error("Configure a valid PostgreSQL connection URL"); }
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || url.pathname.length < 2) throw new Error("Configure a valid PostgreSQL connection URL");
    if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(decodeURIComponent(url.pathname.slice(1)))) throw new Error("Backup database names must contain only letters, numbers, underscores or hyphens");
    const proofHost = /^scribble-backup-proof-[a-f0-9]{12}-(source|target)$/.test(url.hostname)
      && env.PG_TOOLS_NETWORK === url.hostname.replace(/-(source|target)$/, "-network")
      && env.BACKUP_DISPOSABLE_TEST === "1";
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || proofHost;
    if (!local && url.searchParams.get("sslmode") !== "verify-full") throw new Error("Remote backup connections require sslmode=verify-full");
    const allowed = new Set(["sslmode", "sslrootcert", "channel_binding", "connect_timeout", "application_name"]);
    for (const key of url.searchParams.keys()) if (!allowed.has(key)) throw new Error("Unsupported backup connection parameter");
    Object.assign(toolEnv, {
      PGHOST: url.hostname.replace(/^\[|\]$/g, ""), PGPORT: url.port || "5432",
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: url.searchParams.get("sslmode") || (local ? "disable" : "verify-full"),
      PGCONNECT_TIMEOUT: "10", PGAPPNAME: "scribble-backup",
    });
    if (toolEnv.PGSSLMODE === "verify-full") toolEnv.PGSSLROOTCERT = url.searchParams.get("sslrootcert") || "system";
    if (url.searchParams.has("channel_binding")) toolEnv.PGCHANNELBINDING = url.searchParams.get("channel_binding");
  }
  let executable = command, commandArgs = args;
  if (env.BACKUP_NATIVE_TOOLS !== "1") {
    const desktop = env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "DockerDesktop", "resources", "bin", "docker.exe") : "";
    executable = desktop && await access(desktop).then(() => true, () => false) ? desktop : "docker";
    commandArgs = ["run", "--rm", "-i", "--log-driver=none", "--entrypoint", command, ...(env.PG_TOOLS_NETWORK ? ["--network", env.PG_TOOLS_NETWORK] : []),
      ...Object.keys(toolEnv).filter((key) => key.startsWith("PG") && key !== "PG_TOOLS_NETWORK").flatMap((key) => ["--env", key]),
      env.PG_TOOLS_IMAGE || "scribble-backups:local", ...args];
    if (executable !== "docker") toolEnv.PATH = `${dirname(executable)};${toolEnv.PATH}`;
  }
  const child = spawn(executable, commandArgs, { env: toolEnv, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  // PostgreSQL diagnostics can include names or row values. Never print them.
  let diagnosticBytes = 0;
  child.stderr.on("data", (value) => { diagnosticBytes += value.length; });
  const finished = new Promise((resolve, reject) => {
    child.on("error", () => reject(new Error(`Unable to start ${command}`)));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed (exit ${code}; ${diagnosticBytes} diagnostic bytes suppressed)`)));
  });
  // Callers may be piping while the command exits. Prevent a transient unhandled rejection.
  finished.catch(() => {});
  return { child, finished };
}

export async function queryTarget(connection, sql, env = process.env) {
  const { child, finished } = await postgresTool("psql", ["--no-psqlrc", "--no-password", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--command", sql], connection, env);
  child.stdin.end();
  const chunks = []; let size = 0;
  for await (const chunk of child.stdout) {
    size += chunk.length;
    if (size > 64 * 1024) { child.kill(); throw new Error("Unexpectedly large database response"); }
    chunks.push(chunk);
  }
  await finished;
  return Buffer.concat(chunks).toString("utf8").trim();
}
