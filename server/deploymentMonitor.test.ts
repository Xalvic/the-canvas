import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
// The deployment utilities run directly on Node and do not enter either build.
// @ts-expect-error JavaScript deployment utility has no generated declaration.
import { monitor } from "../scripts/production-monitor.mjs";

async function fixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "scribble-monitor-test-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function archive(directory: string, createdAt: string, data = Buffer.alloc(60, 5)) {
  const path = join(directory, "scribble-test.enc");
  await writeFile(path, data);
  await writeFile(`${path}.manifest.json`, JSON.stringify({ version: 1, format: "postgres-custom", encryption: "aes-256-gcm", createdAt, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") }));
  return path;
}
const ready = async () => new Response('{"status":"ready"}', { headers: { "Content-Type": "application/json" } });
const env = (directory: string) => ({ MONITOR_PUBLIC_ORIGIN: "https://scribble.example", BACKUP_DIRECTORY: directory });

describe("production readiness and encrypted backup monitoring", () => {
  it("accepts a recent archive with the exact manifest size and digest", async () => fixture(async (directory) => {
    await archive(directory, new Date().toISOString());
    await expect(monitor(env(directory), ready)).resolves.toBeUndefined();
  }));
  it("rejects stale backups even after touching their file and rejects future timestamps", async () => fixture(async (directory) => {
    const path = await archive(directory, new Date(Date.now() - 40 * 3600_000).toISOString());
    await utimes(path, new Date(), new Date());
    await expect(monitor(env(directory), ready)).rejects.toThrow("No recent");
    await archive(directory, new Date(Date.now() + 24 * 3600_000).toISOString());
    await expect(monitor(env(directory), ready)).rejects.toThrow("No recent");
  }));
  it("rejects corrupted ciphertext and malformed manifests", async () => fixture(async (directory) => {
    const path = await archive(directory, new Date().toISOString());
    await writeFile(path, Buffer.alloc(60, 9));
    await expect(monitor(env(directory), ready)).rejects.toThrow("integrity");
    await writeFile(`${path}.manifest.json`, "{}");
    await expect(monitor(env(directory), ready)).rejects.toThrow("No recent");
  }));
  it("fails on redirects/unavailable database and never treats liveness as readiness", async () => fixture(async (directory) => {
    await archive(directory, new Date().toISOString());
    await expect(monitor(env(directory), async () => new Response(null, { status: 503 }))).rejects.toThrow("readiness");
    await expect(monitor(env(directory), async () => new Response('{"status":"ok"}'))).rejects.toThrow("unexpected");
  }));
});
