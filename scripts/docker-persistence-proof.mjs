import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdtemp, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suffix = randomUUID().replaceAll("-", "");
const project = `scribble-proof-${suffix.slice(0, 12)}`;
assert.match(project, /^scribble-proof-[a-f0-9]{12}$/);
assert.notEqual(project, "scribble-local");
const volume = `${project}_postgres-data`;
const envPath = join(root, `.env.docker-proof-${suffix}`);
const temporaryRoot = resolve(tmpdir());
const temporary = await mkdtemp(join(temporaryRoot, "scribble-docker-proof-"));
assert.ok(resolve(temporary).startsWith(`${temporaryRoot}${sep}`));
assert.match(temporary.slice(temporary.lastIndexOf(sep) + 1), /^scribble-docker-proof-/);
const overridePath = join(temporary, "compose.override.yaml");
const appPassword = randomBytes(24).toString("hex");
const adminPassword = randomBytes(24).toString("hex");
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const userId = randomUUID(), boardId = randomUUID();
const execute = promisify(execFile);
const desktopDocker = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "DockerDesktop", "resources", "bin", "docker.exe") : null;
const docker = desktopDocker && await access(desktopDocker).then(() => true, () => false) ? desktopDocker : "docker";
const commandEnv = { ...process.env, PATH: docker === "docker" ? process.env.PATH : `${dirname(docker)}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` };
// Do not let the shell's project-specific settings override disposable credentials.
for (const key of ["POSTGRES_PASSWORD", "SCRIBBLE_DB_PASSWORD", "DATABASE_URL", "API_PORT", "API_HOST", "COMPOSE_PROJECT_NAME"]) delete commandEnv[key];
const composeArgs = ["compose", "--project-name", project, "--env-file", envPath, "--file", join(root, "compose.yaml"), "--file", overridePath, "--profile", "api"];
let stage = "preparing", started = false, checks = 0;
function check(condition, message) { assert.ok(condition, message); checks++; }
async function command(args) {
  try { return (await execute(docker, args, { cwd: root, env: commandEnv, timeout: 180_000, maxBuffer: 5 * 1024 * 1024 })).stdout.trim(); }
  catch (error) {
    let diagnostic = [error.stdout, error.stderr].filter(Boolean).join("\n");
    for (const secret of [appPassword, adminPassword, token, databaseUrl]) diagnostic = diagnostic.replaceAll(secret, "[redacted]");
    throw new Error(`Docker command failed during ${stage}: ${diagnostic.slice(-1500)}`);
  }
}
const compose = (...args) => command([...composeArgs, ...args]);
async function freePort() {
  const server = createServer();
  await new Promise((resolvePort, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolvePort); });
  const port = server.address().port;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  assert.ok(port > 1024 && ![5433, 5434, 3001].includes(port));
  return port;
}
const databasePort = await freePort();
let apiPort = await freePort();
while (apiPort === databasePort) apiPort = await freePort();
const databaseUrl = `postgresql://scribble:${appPassword}@127.0.0.1:${databasePort}/scribble`;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const content = { objects: [{ id: "proof-note", type: "card", title: "Persisted through container recreation", body: "Disposable fixture only", x: 12, y: 34, width: 240, height: 160, zIndex: 1, createdAt: 1, updatedAt: 2 }] };
async function database(run) {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  await client.connect();
  try { return await run(client); } finally { await client.end(); }
}
async function fingerprint() {
  return database(async (client) => {
    const tables = ["schema_migrations", "users", "auth_sessions", "boards", "board_documents"];
    const rows = {};
    for (const table of tables) {
      // These five identifiers are a fixed allowlist; fixture values use parameters.
      rows[table] = (await client.query(`SELECT * FROM ${table}`)).rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  });
}
async function verifyApi(expectedFingerprint, label) {
  const health = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(5000) });
  check(health.ok, `${label}: health failed`);
  const unauthorized = await fetch(`${apiUrl}/api/boards/${boardId}`, { signal: AbortSignal.timeout(5000) });
  check(unauthorized.status === 401, `${label}: authentication was bypassed`);
  for (const [path, key] of [[`/api/boards/${boardId}`, "board"], [`/api/boards/${boardId}/document`, "document"]]) {
    const response = await fetch(`${apiUrl}${path}`, { headers: { Cookie: `scribble_session=${token}` }, signal: AbortSignal.timeout(5000) });
    check(response.ok, `${label}: authenticated read failed`);
    const value = (await response.json())[key];
    if (key === "board") {
      check(value.id === boardId && value.title === "Docker persistence proof" && value.role === "owner", `${label}: board changed`);
    } else {
      check(value.boardId === boardId && value.revision === 7 && value.schemaVersion === 1, `${label}: revision changed`);
      assert.deepEqual(value.content, content); checks++;
    }
  }
  check(await fingerprint() === expectedFingerprint, `${label}: database rows changed`);
  console.log(`Docker proof: ${label} passed`);
}

try {
  await writeFile(envPath, `POSTGRES_PASSWORD=${adminPassword}\nSCRIBBLE_DB_PASSWORD=${appPassword}\nDATABASE_URL=${databaseUrl}\nAPI_PORT=3001\n`, { flag: "wx", mode: 0o600 });
  // Compose !override replaces ports instead of merging with the user's mappings.
  const quotedEnv = JSON.stringify(envPath.replaceAll("\\", "/"));
  await writeFile(overridePath, `services:\n  postgres:\n    ports: !override ["127.0.0.1:${databasePort}:5432"]\n  api:\n    ports: !override ["127.0.0.1:${apiPort}:3001"]\n    env_file: !override [${quotedEnv}]\n`);
  stage = "configuration validation";
  await compose("config", "--quiet"); checks++;
  await command(["image", "inspect", "scribble-api:local", "--format", "{{.Id}}"]); checks++;
  stage = "initial PostgreSQL startup"; started = true;
  await compose("up", "-d", "--wait", "postgres");
  stage = "explicit SQL migrations";
  await compose("run", "--rm", "api", "migrate");
  await database(async (client) => {
    const versions = (await client.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map((row) => row.version);
    const expectedVersions = (await readdir(join(root, "db"))).filter((name) => /^\d+_.*\.sql$/.test(name)).map((name) => Number(name.split("_")[0])).sort((a, b) => a - b);
    assert.deepEqual(versions, expectedVersions); checks++;
    const role = (await client.query("SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = 'scribble'")).rows[0];
    check(role && !role.rolsuper && !role.rolcreatedb && !role.rolcreaterole, "API role is overprivileged");
    await client.query("BEGIN");
    try {
      await client.query("INSERT INTO users(id, google_subject, email, display_name) VALUES ($1,$2,$3,$4)", [userId, `docker-proof-${suffix}`, "docker-proof@example.invalid", "Docker proof"]);
      await client.query("INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES ($1,$2,clock_timestamp() + interval '1 day')", [tokenHash, userId]);
      await client.query("INSERT INTO boards(id, title, owner_id) VALUES ($1,$2,$3)", [boardId, "Docker persistence proof", userId]);
      await client.query("INSERT INTO board_documents(board_id, schema_version, revision, content) VALUES ($1,1,7,$2::jsonb)", [boardId, JSON.stringify(content)]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  });
  const original = await fingerprint();
  stage = "initial API startup";
  await compose("up", "-d", "--wait", "--no-build", "api");
  await verifyApi(original, "initial authenticated reads");
  stage = "API container restart";
  await compose("restart", "api");
  await compose("up", "-d", "--wait", "--no-build", "api");
  await verifyApi(original, "API restart persistence");
  stage = "PostgreSQL container restart";
  await compose("restart", "postgres");
  await compose("up", "-d", "--wait", "postgres");
  await compose("restart", "api");
  await compose("up", "-d", "--wait", "--no-build", "api");
  await verifyApi(original, "database restart persistence");
  stage = "container recreation with retained disposable volume";
  await compose("down", "--remove-orphans");
  await compose("up", "-d", "--wait", "--no-build", "api");
  await verifyApi(original, "down/up volume persistence");
  console.log(`Docker persistence proof: ${checks} checks passed; disposable API/database verified, existing project untouched`);
} catch (error) {
  console.error(`Docker persistence proof failed during ${stage}; no credentials were logged`);
  if (error instanceof Error && error.message.startsWith("Docker command failed")) console.error(error.message);
  process.exitCode = 1;
} finally {
  if (started) {
    try {
      stage = "disposable cleanup";
      await compose("down", "--remove-orphans");
      const labels = JSON.parse(await command(["volume", "inspect", volume, "--format", "{{json .Labels}}"]));
      assert.equal(labels["com.docker.compose.project"], project);
      assert.equal(labels["com.docker.compose.volume"], "postgres-data");
      assert.equal(volume, `${project}_postgres-data`);
      await command(["volume", "rm", volume]);
      console.log("Docker proof: exact disposable containers/network/volume removed");
    } catch {
      process.exitCode = 1;
      console.error(`Disposable cleanup needs inspection for project ${project}; original scribble-local resources were not targeted`);
    }
  }
  await unlink(envPath).catch(() => undefined);
  assert.ok(resolve(temporary).startsWith(`${temporaryRoot}${sep}`));
  await rm(temporary, { recursive: true, force: true });
}
