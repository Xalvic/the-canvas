import { readdir, lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { encryptedSummary } from "./backup.mjs";

export async function monitor(env = process.env, transport = fetch) {
  let origin;
  try {
    origin = new URL(env.MONITOR_PUBLIC_ORIGIN);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error();
  } catch { throw new Error("Set MONITOR_PUBLIC_ORIGIN to the public HTTPS app origin"); }
  const response = await transport(new URL("/ready", origin), { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Production database readiness check failed");
  const body = await response.json();
  if (body.status !== "ready") throw new Error("Production readiness returned an unexpected response");
  if (!env.BACKUP_DIRECTORY) throw new Error("Set BACKUP_DIRECTORY to check encrypted backup freshness");
  const now = Date.now();
  let latest = null;
  for (const name of await readdir(env.BACKUP_DIRECTORY)) {
    if (!/^scribble-.*\.enc$/.test(name)) continue;
    const path = join(env.BACKUP_DIRECTORY, name);
    const file = await lstat(path);
    if (!file.isFile() || file.size < 41) continue;
    const manifestPath = `${path}.manifest.json`;
    const manifestFile = await lstat(manifestPath).catch(() => null);
    if (!manifestFile?.isFile() || manifestFile.size > 4096) continue;
    let manifest;
    try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch { continue; }
    const date = typeof manifest.createdAt === "string" ? Date.parse(manifest.createdAt) : NaN;
    if (manifest.version !== 1 || manifest.format !== "postgres-custom" || manifest.encryption !== "aes-256-gcm" ||
        !/^[a-f0-9]{64}$/.test(manifest.sha256) || manifest.bytes !== file.size || !Number.isFinite(date) || date > now + 300_000) continue;
    if (!latest || date > latest.date) latest = { path, date, manifest };
  }
  if (!latest || now - latest.date > 36 * 60 * 60 * 1000) throw new Error("No recent encrypted database backup is available");
  const summary = await encryptedSummary(latest.path);
  if (summary.bytes !== latest.manifest.bytes || summary.sha256 !== latest.manifest.sha256) throw new Error("The latest encrypted backup failed its integrity check");
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/production-monitor.mjs")) {
  monitor().then(() => console.log("Production readiness and backup freshness checks passed"))
    .catch(() => { console.error("Production monitoring failed; check readiness, timers and backup storage locally"); process.exitCode = 1; });
}
