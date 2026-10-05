import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const name = `scribble-proxy-log-proof-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
assert.match(name, /^scribble-proxy-log-proof-[a-f0-9]{12}$/);
const parent = resolve(tmpdir()), temporary = await mkdtemp(join(parent, "scribble-proxy-log-proof-"));
assert.ok(temporary.startsWith(`${parent}${sep}`));
const execute = promisify(execFile);
const label = "scribble.proxy-log-proof";
let checks = 0;
async function docker(args) {
  try { return await execute("docker", args, { cwd: root, windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024 }); }
  catch { throw new Error("Disposable Caddy log proof command failed; private diagnostics suppressed"); }
}
const server = createServer();
await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
const port = server.address().port;
await new Promise((done) => server.close(done));
assert.ok(port > 1024 && ![5433, 5434, 3001].includes(port));

try {
  const productionPath = join(root, "deployment", "Caddyfile");
  const production = await readFile(productionPath, "utf8");
  const siteStart = production.indexOf("{$API_ORIGIN_HOST}");
  assert.ok(siteStart > 0 && production.indexOf("{$API_ORIGIN_HOST}", siteStart + 1) === -1, "Expected exactly one production origin site");
  const global = production.slice(0, siteStart);
  assert.ok(global.trim().startsWith("{") && global.includes("format filter"), "Production log filter is missing");
  await docker(["run", "--rm", "--env", "API_ORIGIN_HOST=origin.example.invalid", "--mount", `type=bind,source=${productionPath},target=/etc/caddy/Caddyfile,readonly`, "caddy:2.10.2-alpine", "caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]); checks++;
  const fixturePath = join(temporary, "Caddyfile");
  // Reuse the exact production global filter; only the disposable site changes.
  await writeFile(fixturePath, `${global}\n:8080 {\n  reverse_proxy 127.0.0.1:9\n}\n`, { flag: "wx", mode: 0o600 });
  await docker(["run", "--detach", "--name", name, "--label", `${label}=${name}`, "--publish", `127.0.0.1:${port}:8080`, "--mount", `type=bind,source=${fixturePath},target=/etc/caddy/Caddyfile,readonly`, "caddy:2.10.2-alpine"]);
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(origin, { signal: AbortSignal.timeout(1000) }); ready = true; break;
    } catch { await new Promise((done) => setTimeout(done, 200)); }
  }
  assert.ok(ready, "Disposable Caddy did not become ready"); checks++;
  const markers = Array.from({ length: 4 }, () => `private-fixture-${randomUUID()}`);
  const response = await fetch(`${origin}/api/auth/google/callback?code=${markers[0]}&state=${markers[1]}`, {
    headers: { "X-Scribble-Proxy-Secret": markers[2], Cookie: `scribble_session=${markers[3]}` },
    redirect: "manual", signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 502, "Expected a real reverse-proxy failure"); checks++;
  await response.arrayBuffer();
  // Capture logs privately. Never print request fields, fixture markers or raw logs.
  const captured = await docker(["logs", name]);
  const logText = `${captured.stdout}\n${captured.stderr}`;
  const events = logText.split(/\r?\n/).filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  assert.ok(events.some((event) => event.level === "error" && event.status === 502 && event.logger?.startsWith("http.")), "A real HTTP error log must remain available"); checks++;
  assert.ok(markers.every((marker) => !logText.includes(marker)), "A private fixture marker leaked into Caddy logs"); checks++;
  assert.ok(!events.some((event) => Object.hasOwn(event, "request") || Object.hasOwn(event, "headers")), "Request/header objects leaked into logs"); checks++;
  console.log(`Caddy error-log proof passed: ${checks} checks; real 502 logged without request, OAuth, proxy-secret or cookie data`);
} finally {
  const actualLabel = await docker(["inspect", "--format", `{{index .Config.Labels "${label}"}}`, name]).then((result) => result.stdout.trim()).catch(() => null);
  if (actualLabel === name) await docker(["rm", "--force", name]);
  assert.ok(resolve(temporary).startsWith(`${parent}${sep}`));
  await rm(temporary, { recursive: true, force: true });
}
