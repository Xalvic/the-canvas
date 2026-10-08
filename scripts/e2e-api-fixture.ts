// Standalone integration-test server. It never imports production credentials or
// connects to ImageKit; all durable app state lives in one disposable DB schema.
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import express from "express";
import pg from "pg";
import { z } from "zod";
import { createApp } from "../server/app.js";
import { hashToken, randomToken, SESSION_COOKIE } from "../server/auth.js";
import { errorHandler } from "../server/errors.js";
import { createImageAssetService } from "../server/imageAssets.js";
import type { ImageStorage } from "../server/imageKit.js";
import { migrateDatabase } from "../server/migrations.js";
import { createPostgresAssetStore } from "../server/postgresAssets.js";
import { createPostgresAuthStore } from "../server/postgresAuth.js";
import { createPostgresBoardStore } from "../server/postgresBoards.js";
import { createPostgresCollaborationStore } from "../server/postgresCollaboration.js";
import { createPostgresDocumentStore } from "../server/postgresDocuments.js";
import { createPostgresSharingStore } from "../server/postgresSharing.js";
import { createPostgresWorkspaceStore } from "../server/postgresWorkspace.js";
import { createPostgresShareLinkStore } from "../server/postgresShareLinks.js";
import { createPrismaClient } from "../server/prisma.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const controlToken = process.env.SCRIBBLE_FIXTURE_TOKEN;
if (!databaseUrl || !controlToken || process.env.SCRIBBLE_E2E_FIXTURE !== "1") {
  throw new Error("Use playwright.integration.config.ts to start this isolated fixture");
}
const address = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(address.hostname) || address.port !== "5434") {
  throw new Error("The integration fixture requires Docker PostgreSQL on loopback port 5434");
}
const port = Number(process.env.API_PORT ?? 4301);
const frontendUrl = "http://127.0.0.1:4174/scribble/";
const schema = `scribble_browser_test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, max: 1 });
const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema, max: 5 });
const prisma = createPrismaClient(pool, schema);
const files = new Map<string, { buffer: Buffer; mimeType: string; fileId: string; filePath: string; size: number }>();
let failUploads = 0, failSigns = 0, failImages = 0, uploadDelayMs = 0;
let uploadCalls = 0, signCalls = 0, imageCalls = 0;
let signatureVersion = 0;
let signedTtlSeconds = 300;
let dropOperationResponses = 0;
const storage: ImageStorage = {
  pathFor: ({ boardId, assetId, extension }) => `/fixture/${boardId}/${assetId}.${extension}`,
  async upload(buffer, target) {
    uploadCalls++;
    if (uploadDelayMs) await new Promise((resolve) => setTimeout(resolve, uploadDelayMs));
    if (failUploads > 0) { failUploads--; throw new Error("Controlled provider upload failure"); }
    const filePath = this.pathFor(target), fileId = `fixture-${target.assetId}`;
    const file = { buffer, mimeType: target.mimeType, fileId, filePath, size: buffer.length };
    files.set(filePath, file);
    return file;
  },
  sign(filePath, expiresAtUnixSeconds) {
    signCalls++;
    if (failSigns > 0) { failSigns--; throw new Error("Controlled provider signing failure"); }
    const expiry = Math.min(expiresAtUnixSeconds, Math.floor(Date.now() / 1000) + signedTtlSeconds);
    const path = `/api/__fixture/image?path=${encodeURIComponent(filePath)}&expires=${expiry}&version=${signatureVersion}`;
    const signature = createHmac("sha256", controlToken).update(path).digest("hex");
    return new URL(`${path}&signature=${signature}`, frontendUrl).href;
  },
  async delete(fileId) { for (const [path, file] of files) if (file.fileId === fileId) files.delete(path); },
  async find(filePath) { return files.get(filePath) ?? null; },
};

let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
let stopping = false;
async function stop(closeServer = true) {
  if (stopping) return;
  stopping = true;
  // Stop accepting requests before dropping only the fixture-owned schema.
  if (closeServer) await new Promise<void>((resolve) => {
    if (!server) { resolve(); return; }
    server.close(() => resolve());
    server.closeIdleConnections();
  });
  await prisma.$disconnect();
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}

try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await migrateDatabase(pool);
  const authStore = createPostgresAuthStore(prisma);
  const fixture = express();
  const controls = express.Router();
  controls.use((req, res, next) => {
    if (!req.socket.remoteAddress?.match(/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/) || req.get("X-Scribble-Fixture") !== controlToken) {
      res.status(403).end(); return;
    }
    next();
  });
  controls.use(express.json({ limit: "16kb" }));
  controls.post("/session", async (req, res) => {
    const { subject } = z.object({ subject: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) }).parse(req.body);
    const token = randomToken();
    const session = await authStore.signIn({ subject: `fixture-${subject}`, email: `${subject}@example.com`, displayName: subject }, hashToken(token));
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: false, path: "/api" });
    res.json({ user: session.user });
  });
  controls.post("/membership", async (req, res) => {
    const { boardId, userId, role } = z.object({ boardId: z.uuid(), userId: z.uuid(), role: z.enum(["editor", "viewer"]).nullable() }).parse(req.body);
    if (role) await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(board_id,user_id) DO UPDATE SET role=$3", [boardId, userId, role]);
    else await pool.query("DELETE FROM board_members WHERE board_id=$1 AND user_id=$2", [boardId, userId]);
    res.status(204).end();
  });
  controls.post("/provider", (req, res) => {
    const input = z.object({ failUploads: z.number().int().min(0).max(5).optional(), failSigns: z.number().int().min(0).max(5).optional(), failImages: z.number().int().min(0).max(5).optional(), uploadDelayMs: z.number().int().min(0).max(5000).optional(), signedTtlSeconds: z.number().int().min(2).max(300).optional(), expireSignatures: z.boolean().optional() }).strict().parse(req.body);
    failUploads = input.failUploads ?? 0; failSigns = input.failSigns ?? 0; failImages = input.failImages ?? 0; uploadDelayMs = input.uploadDelayMs ?? 0;
    signedTtlSeconds = input.signedTtlSeconds ?? 300;
    if (input.expireSignatures) signatureVersion++;
    res.status(204).end();
  });
  controls.post("/network", (req, res) => {
    const input = z.object({ dropOperationResponses: z.number().int().min(0).max(1) }).strict().parse(req.body);
    dropOperationResponses = input.dropOperationResponses;
    res.status(204).end();
  });
  controls.get("/state/:boardId", async (req, res) => {
    const id = z.uuid().parse(req.params.boardId);
    const [document, assets, receipts] = await Promise.all([
      pool.query("SELECT revision,content FROM board_documents WHERE board_id=$1", [id]),
      pool.query("SELECT id,board_id,status,last_referenced_at FROM board_assets WHERE scope_board_id=$1 ORDER BY created_at", [id]),
      pool.query("SELECT actor_id,operation_id,applied_revision FROM board_operation_receipts WHERE board_id=$1 ORDER BY created_at", [id]),
    ]);
    res.json({ document: document.rows[0] ?? null, assets: assets.rows, receipts: receipts.rows, provider: { uploadCalls, signCalls, imageCalls } });
  });
  controls.post("/shutdown", async (_req, res) => {
    // Test requests are complete. Acknowledge only after PostgreSQL teardown,
    // otherwise Playwright's Windows process cleanup could interrupt DROP.
    await stop(false);
    res.status(204).end();
    server!.close(() => process.exit(0));
    server!.closeIdleConnections();
  });
  fixture.get("/api/__fixture/image", (req, res) => {
    imageCalls++;
    const { path, expires, version, signature } = req.query;
    if (typeof path !== "string" || typeof expires !== "string" || typeof version !== "string" || typeof signature !== "string") { res.status(403).end(); return; }
    const signed = `/api/__fixture/image?path=${encodeURIComponent(path)}&expires=${expires}&version=${version}`;
    const expected = createHmac("sha256", controlToken).update(signed).digest("hex");
    if (expected !== signature || Number(expires) <= Date.now() / 1000 || Number(version) !== signatureVersion || failImages > 0) {
      if (failImages > 0) failImages--;
      res.status(403).end(); return;
    }
    const file = files.get(path);
    if (!file) { res.status(404).end(); return; }
    res.set("Cache-Control", "no-store").type(file.mimeType).send(file.buffer);
  });
  fixture.use("/api/__fixture", controls);
  fixture.use((req, res, next) => {
    if (req.method === "POST" && /^\/api\/boards\/[^/]+\/operations$/.test(req.path)) {
      const json = res.json.bind(res);
      res.json = (body) => {
        // Lose only a successful real API response after PostgreSQL committed.
        // The browser must recover/replay using its durable operation marker.
        if (dropOperationResponses > 0 && res.statusCode === 200) {
          dropOperationResponses--;
          res.socket?.destroy();
          return res;
        }
        return json(body);
      };
    }
    next();
  });
  const assets = createImageAssetService(createPostgresAssetStore(prisma), storage);
  const originalRead = assets.read;
  assets.read = async (boardId, assetId, userId) => {
    const signed = await originalRead(boardId, assetId, userId);
    // The controlled provider can shorten TTL for real-timer refresh coverage.
    // Authorization, DB budgets and original signing all still use the service.
    return { ...signed, expiresAt: Number(new URL(signed.url).searchParams.get("expires")) * 1000 };
  };
  fixture.use(createApp(createPostgresBoardStore(prisma), createPostgresDocumentStore(prisma), {
    store: authStore, provider: {
      // Controlled OAuth identity only. Exercise the real auth router/store/cookies
      // without contacting Google or reading production credentials.
      authorizationUrl: ({ state }) => `${frontendUrl.replace("/scribble/", "/api/auth/google/callback")}?state=${state}&code=${randomUUID()}`,
      verifyCode: async (code) => ({ subject: `fixture-oauth-${code}`, email: `oauth-${code}@example.com`, displayName: "OAuth fixture" }),
    }, frontendUrl, secureCookies: false,
  }, createPostgresSharingStore(prisma), assets, createPostgresCollaborationStore(prisma), undefined, createPostgresWorkspaceStore(prisma),
    process.env.SCRIBBLE_E2E_SHARE_LINKS === "1" ? createPostgresShareLinkStore(prisma, randomBytes(32)) : undefined));
  fixture.use(errorHandler);
  server = fixture.listen(port, "127.0.0.1", () => console.log(`Isolated browser API ready on ${port}; schema ${schema}`));
  server.on("error", (error) => { console.error(error); void stop().then(() => process.exit(1)); });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void stop().then(() => process.exit(0)); });
} catch (error) {
  await stop();
  throw error;
}
