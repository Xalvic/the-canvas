import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import pg from "pg";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "./prisma.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { migrateDatabase } from "./migrations.js";
import { createPostgresAssetStore } from "./postgresAssets.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPostgresDocumentStore } from "./postgresDocuments.js";
import { createImageAssetService } from "./imageAssets.js";
import type { StoredImage } from "./imageKit.js";
import { createAuthenticatedApp, seedTestOwner, TEST_OWNER_ID } from "./testFixtures/authenticatedApp.js";
import { createControlledImageStorage } from "./testFixtures/controlledImageStorage.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("real API/PostgreSQL retry-safe image uploads", () => {
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  const processes = new Set<ChildProcess>();
  let schema: string, pool: pg.Pool, prisma: PrismaClient, provider: Server, providerUrl: string, boardId: string;
  let files: Map<string, StoredImage>, uploads: number, finds: number;
  let failFind: boolean, failUpload: boolean, loseResponse: boolean, holdUpload: (() => Promise<void>) | undefined;
  beforeEach(async () => {
    schema = `scribble_upload_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 5 });
    await migrateDatabase(pool); await seedTestOwner(pool); prisma = createPrismaClient(pool, schema);
    boardId = (await createPostgresBoardStore(prisma).create("Upload destination", TEST_OWNER_ID)).id;
    files = new Map(); uploads = 0; finds = 0; failFind = false; failUpload = false; loseResponse = false; holdUpload = undefined;
    const app = express();
    app.use(express.raw({ type: "application/octet-stream", limit: "5mb" }));
    app.get("/file", (req, res) => { finds++; if (failFind) { res.sendStatus(503); return; } res.json(files.get(String(req.query.path)) ?? null); });
    app.post("/file", async (req, res) => {
      uploads++;
      if (failUpload) { res.sendStatus(503); return; }
      const path = String(req.query.path);
      if (files.has(path)) { res.sendStatus(409); return; }
      const file = { fileId: randomUUID(), filePath: path, size: (req.body as Buffer).length };
      files.set(path, file);
      if (holdUpload) await holdUpload();
      if (loseResponse) { failFind = true; res.sendStatus(503); return; }
      res.json(file);
    });
    app.delete("/file/:id", (req, res) => { for (const [path, file] of files) if (file.fileId === req.params.id) files.delete(path); res.sendStatus(204); });
    provider = await new Promise<Server>((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
    const address = provider.address(); if (!address || typeof address === "string") throw new Error("Invalid provider fixture");
    providerUrl = `http://127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    for (const child of processes) await stopProcess(child);
    provider?.closeAllConnections();
    if (provider) await new Promise<void>((resolve) => provider.close(() => resolve()));
    await prisma?.$disconnect(); await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); vi.restoreAllMocks();
  });
  afterAll(async () => { await admin.end(); });
  const png = (color = "#ee9933") => sharp({ create: { width: 2, height: 2, channels: 3, background: color } }).png().toBuffer();
  function app(userId = TEST_OWNER_ID, client = prisma) {
    return createAuthenticatedApp(createPostgresBoardStore(client), createPostgresDocumentStore(client), userId, undefined,
      createImageAssetService(createPostgresAssetStore(client), createControlledImageStorage(providerUrl)));
  }
  function post(api: ReturnType<typeof app> | string, buffer: Buffer, requestId: string, destination = boardId) {
    return request(api).post(`/api/boards/${destination}/assets`).set("Content-Type", "image/png").set("X-Scribble-Upload-Request", requestId).send(buffer);
  }
  function status(api: ReturnType<typeof app> | string, requestId: string, destination = boardId) {
    return request(api).get(`/api/boards/${destination}/asset-uploads/${requestId}`);
  }
  async function expireLease() { await pool.query("UPDATE board_assets SET upload_lease_until=clock_timestamp()-interval '1 second' WHERE upload_request_id IS NOT NULL"); }
  async function actor(role?: "editor" | "viewer") {
    const id = randomUUID();
    await pool.query("INSERT INTO users(id,google_subject,email) VALUES($1::uuid,$1::uuid::text,$2)", [id, `${id}@example.com`]);
    if (role) await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,$3)", [boardId, id, role]);
    return id;
  }
  async function startProcess() {
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./testFixtures/assetUploadServer.ts", import.meta.url))], {
      env: { ...process.env, TEST_DATABASE_URL: databaseUrl, TEST_ASSET_UPLOAD_SCHEMA: schema, TEST_IMAGE_PROVIDER_URL: providerUrl },
      stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true,
    });
    processes.add(child);
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Upload fixture startup timed out")), 15_000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Upload fixture exited before startup")); });
      child.once("message", (message) => {
        clearTimeout(timer);
        if (typeof message === "object" && message !== null && "port" in message && typeof message.port === "number") resolve(message.port);
        else reject(new Error("Invalid upload fixture startup response"));
      });
    });
    return { child, url: `http://127.0.0.1:${port}` };
  }
  async function stopProcess(child: ChildProcess, kill = false) {
    if (child.exitCode !== null || child.signalCode !== null) { processes.delete(child); return; }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill(), 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      if (!kill && child.connected) child.send("stop"); else child.kill();
    }); processes.delete(child);
  }

  it("replays one ready asset, compares raw content, returns public identities and keeps document saves/history assets usable", async () => {
    const api = app(), id = randomUUID(), buffer = await png();
    const first = await post(api, buffer, id, boardId.toUpperCase()).expect(200);
    expect(first.headers.location).toBe(`/api/boards/${boardId}/asset-uploads/${id}`);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.body.upload).toMatchObject({ requestId: id, boardId, state: "ready", canRetry: false, retryAfterMs: null });
    expect(JSON.stringify(first.body)).not.toMatch(/filePath|fileId|lease|hash|uploader/);
    expect((await post(api, buffer, id.toUpperCase()).expect(200)).body).toEqual(first.body);
    expect((await status(api, id).expect(200)).body).toEqual(first.body);
    await post(api, await png("#112233"), id).expect(409);
    // Appended source bytes normalize to the same image, but still conflict.
    expect((await post(api, Buffer.concat([buffer, Buffer.from("different original")]), id).expect(409)).body.error.code).toBe("ASSET_UPLOAD_REQUEST_CONFLICT");
    const assetId = first.body.upload.assetId;
    const object = { id: "image-1", type: "image", assetId, x: 0, y: 0, width: 2, height: 2, originalWidth: 2, originalHeight: 2, zIndex: 1, createdAt: 1, updatedAt: 1 };
    await request(api).put(`/api/boards/${boardId}/document`).send({ schemaVersion: 1, expectedRevision: 0, content: { objects: [object] } }).expect(201);
    await request(api).put(`/api/boards/${boardId}/document`).send({ schemaVersion: 1, expectedRevision: 1, content: { objects: [] } }).expect(200);
    await pool.query("UPDATE board_assets SET created_at=clock_timestamp()-interval '100 days', updated_at=clock_timestamp()-interval '100 days'");
    expect(await createPostgresAssetStore(prisma).claimAbandoned(20)).toEqual([]);
    expect((await post(api, buffer, id).expect(200)).body.upload.assetId).toBe(assetId);
    expect(await prisma.boardAsset.count()).toBe(1); expect(files.size).toBe(1); expect(uploads).toBe(1);
    expect(await prisma.assetRequestBudget.count()).toBe(0);
  });

  it("reconciles a lost provider response by original path without another write or quota reservation", async () => {
    loseResponse = true;
    const api = app(), id = randomUUID(), buffer = await png();
    const pending = await post(api, buffer, id).expect(202);
    expect(pending.headers["retry-after"]).toBe("5");
    expect(pending.body.upload).toMatchObject({ state: "pending", canRetry: true, asset: null });
    const before = await prisma.boardAsset.findMany();
    expect(before[0]).toMatchObject({ status: "pending", uploadAttempts: 1, providerFileId: null });
    failFind = false; loseResponse = false;
    const calls = finds;
    await status(api, id).expect(200); expect(finds).toBe(calls); // Durable cooldown.
    await expireLease();
    const ready = await status(app(), id).expect(200);
    expect(ready.body.upload).toMatchObject({ state: "ready", assetId: pending.body.upload.assetId });
    expect((await post(app(), buffer, id).expect(200)).body).toEqual(ready.body);
    expect(uploads).toBe(1); expect(files.size).toBe(1); expect(await prisma.boardAsset.count()).toBe(1);
    expect((await prisma.boardAsset.findMany())[0].byteSize).toBe(before[0].byteSize);
  });

  it("never uploads or releases reserved bytes when provider lookup is unavailable", async () => {
    failFind = true;
    const id = randomUUID(), api = app(), buffer = await png();
    const result = await post(api, buffer, id).expect(202);
    expect(result.body.upload.state).toBe("pending"); expect(uploads).toBe(0);
    await expireLease(); await status(api, id).expect(200);
    expect(uploads).toBe(0); expect((await prisma.boardAsset.findMany())[0].status).toBe("pending");
    failFind = false; await expireLease();
    const noBytes = await status(api, id).expect(200); expect(noBytes.body.upload.state).toBe("pending"); expect(uploads).toBe(0);
    await expireLease(); await post(api, buffer, id).expect(200);
    expect(uploads).toBe(1); expect(await prisma.boardAsset.count()).toBe(1);
  });

  it("reconciles an existing-path upload rejection after a temporarily empty provider lookup", async () => {
    loseResponse = true;
    const id = randomUUID(), buffer = await png(); await post(app(), buffer, id).expect(202);
    failFind = false; loseResponse = false; await expireLease();
    const storage = createControlledImageStorage(providerUrl);
    vi.spyOn(storage, "find").mockResolvedValueOnce(null);
    const api = createAuthenticatedApp(createPostgresBoardStore(prisma), undefined, undefined, undefined,
      createImageAssetService(createPostgresAssetStore(prisma), storage));
    expect((await post(api, buffer, id).expect(200)).body.upload.state).toBe("ready");
    expect(uploads).toBe(2); expect(files.size).toBe(1); expect(await prisma.boardAsset.count()).toBe(1);
    expect((await prisma.boardAsset.findMany())[0].uploadAttempts).toBe(2);
  });

  it.each(["path", "size"] as const)("rejects mismatched reconciled provider %s metadata while retaining its reservation", async (mismatch) => {
    loseResponse = true;
    const id = randomUUID(), buffer = await png(); await post(app(), buffer, id).expect(202);
    failFind = false; loseResponse = false; await expireLease();
    const [path, file] = [...files][0];
    files.set(path, { ...file, ...(mismatch === "path" ? { filePath: "/wrong/file.png" } : { size: file.size + 1 }) });
    expect((await status(app(), id).expect(502)).body.error.code).toBe("ASSET_PROVIDER_MISMATCH");
    expect((await prisma.boardAsset.findMany())[0]).toMatchObject({ status: "pending", providerFileId: null });
    expect(uploads).toBe(1); expect(await prisma.boardAsset.count()).toBe(1);
  });

  it("bounds actual provider writes to three attempts while retaining uncertain quota and allowing later read-only reconciliation", async () => {
    failUpload = true;
    const id = randomUUID(), api = app(), buffer = await png();
    for (let attempt = 0; attempt < 3; attempt++) { await expireLease(); await post(api, buffer, id).expect(202); }
    await expireLease();
    const exhausted = await post(api, buffer, id).expect(202);
    expect(exhausted.body.upload).toMatchObject({ state: "pending", canRetry: false });
    expect(uploads).toBe(3); expect(await prisma.boardAsset.count()).toBe(1);
    const row = (await prisma.boardAsset.findMany())[0]; expect(row).toMatchObject({ status: "pending", uploadAttempts: 3 });
    // A delayed earlier write can still appear; status may finish it without bytes.
    files.set(row.providerFilePath, { fileId: "delayed-file", filePath: row.providerFilePath, size: row.byteSize });
    await expireLease(); expect((await status(api, id).expect(200)).body.upload.state).toBe("ready");
    expect(uploads).toBe(3);
  });

  it("fences stale lease owners and excludes active/recent reconciliation from abandoned cleanup", async () => {
    const store = createPostgresAssetStore(prisma), id = randomUUID(), assetId = randomUUID();
    const input = { id: assetId, byteSize: 20, width: 2, height: 2, mimeType: "image/png", filePath: `/scribble/test/${boardId}/${assetId}.png` };
    const first = await store.reserveUpload(boardId, TEST_OWNER_ID, input, id, "a".repeat(64));
    expect(await store.beginUpload(assetId, TEST_OWNER_ID, first.leaseToken!)).toBe(true);
    await pool.query("UPDATE board_assets SET created_at=clock_timestamp()-interval '2 days', updated_at=clock_timestamp()-interval '2 days'");
    expect(await store.claimAbandoned(20)).toEqual([]);
    await expireLease();
    const second = await store.claimUpload(boardId, TEST_OWNER_ID, id);
    expect(second.leaseToken).not.toBe(first.leaseToken);
    await store.releaseUpload(assetId, first.leaseToken!);
    expect((await prisma.boardAsset.findUniqueOrThrow({ where: { id: assetId } })).uploadLeaseToken).toBe(second.leaseToken);
    await expect(store.finalize(assetId, TEST_OWNER_ID, { fileId: "late-file", filePath: input.filePath, size: 20 }, first.leaseToken!)).rejects.toMatchObject({ code: "ASSET_UPLOAD_LEASE_LOST" });
    await expect(store.beginUpload(assetId, TEST_OWNER_ID, first.leaseToken!)).rejects.toMatchObject({ code: "ASSET_UPLOAD_LEASE_LOST" });
    await expect(store.finalize(assetId, TEST_OWNER_ID, { fileId: "unsafe-file", filePath: input.filePath, size: 20 })).rejects.toMatchObject({ code: "ASSET_UPLOAD_LEASE_LOST" });
    expect(await store.claimAbandoned(20)).toEqual([]); // Recently reconciled.
    await store.finalize(assetId, TEST_OWNER_ID, { fileId: "current-file", filePath: input.filePath, size: 20 }, second.leaseToken!);
    expect((await prisma.boardAsset.findMany())[0].providerFileId).toBe("current-file");
  });

  it.each(["viewer", "removed", "deleted"] as const)("rechecks %s access on ready replay and status without provider calls or new quota", async (change) => {
    const editor = await actor("editor"), api = app(editor), id = randomUUID(), buffer = await png();
    await post(api, buffer, id).expect(200);
    if (change === "viewer") await pool.query("UPDATE board_members SET role='viewer' WHERE board_id=$1 AND user_id=$2", [boardId, editor]);
    else if (change === "removed") await pool.query("DELETE FROM board_members WHERE board_id=$1 AND user_id=$2", [boardId, editor]);
    else await createPostgresBoardStore(prisma).delete(boardId, TEST_OWNER_ID);
    const calls = finds;
    await post(api, buffer, id).expect(change === "viewer" ? 403 : 404);
    await status(api, id).expect(change === "viewer" ? 403 : 404);
    expect(finds).toBe(calls); expect(uploads).toBe(1); expect(await prisma.boardAsset.count()).toBe(1);
  });

  it("rechecks revocation after provider I/O and keeps its file/reservation for authorized reconciliation", async () => {
    const editor = await actor("editor"), api = app(editor), id = randomUUID(), buffer = await png();
    holdUpload = async () => { await pool.query("UPDATE board_members SET role='viewer' WHERE board_id=$1 AND user_id=$2", [boardId, editor]); };
    await post(api, buffer, id).expect(403);
    expect((await prisma.boardAsset.findMany())[0].status).toBe("pending"); expect(files.size).toBe(1);
    await status(api, id).expect(403);
    await pool.query("UPDATE board_members SET role='editor' WHERE board_id=$1 AND user_id=$2", [boardId, editor]);
    await expireLease(); expect((await status(api, id).expect(200)).body.upload.state).toBe("ready"); expect(uploads).toBe(1);
  });

  it("scopes request identities by actor and board, rejects stranger/viewer inspection, and hides missing requests", async () => {
    const editor = await actor("editor"), viewer = await actor("viewer"), stranger = await actor();
    const api = app(), id = randomUUID(), buffer = await png();
    await post(api, buffer, id).expect(200);
    await status(app(editor), id).expect(404);
    await status(app(viewer), id).expect(403); await status(app(stranger), id).expect(404);
    await status(api, randomUUID()).expect(404);
    await post(app(editor), buffer, id).expect(200);
    const other = (await createPostgresBoardStore(prisma).create("Other destination", TEST_OWNER_ID)).id;
    await status(api, id, other).expect(404); await post(api, buffer, id, other).expect(200);
    expect(await prisma.boardAsset.count()).toBe(3); expect(files.size).toBe(3); expect(uploads).toBe(3);
  });

  it("deduplicates concurrent requests across independent database clients and returns pending while the original write is active", async () => {
    const otherPool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` }), other = createPrismaClient(otherPool, schema);
    let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
    holdUpload = () => wait;
    try {
      const api = app(), api2 = app(TEST_OWNER_ID, other), id = randomUUID(), buffer = await png();
      const first = post(api, buffer, id).then((result) => result);
      await vi.waitFor(() => expect(files.size).toBe(1));
      expect((await post(api2, buffer, id).expect(202)).body.upload.state).toBe("pending");
      const calls = finds; await status(api2, id).expect(200); expect(finds).toBe(calls);
      release(); expect((await first).status).toBe(200);
      expect((await post(api2, buffer, id).expect(200)).body.upload.state).toBe("ready");
      expect(uploads).toBe(1); expect(await prisma.boardAsset.count()).toBe(1);
    } finally { release(); await other.$disconnect(); await otherPool.end(); }
  });

  it("replays a ready upload even at full hourly quota while new identities remain rate limited", async () => {
    const api = app(), buffer = await png(), id = randomUUID(); await post(api, buffer, id).expect(200);
    await pool.query(`INSERT INTO board_assets(id,board_id,scope_board_id,uploader_id,byte_size,mime_type,width,height,provider_file_path)
      SELECT gen_random_uuid(),$1,$1,$2,20,'image/png',2,2,'/fixture/'||gen_random_uuid() FROM generate_series(1,9)`, [boardId, TEST_OWNER_ID]);
    expect((await post(app(), buffer, id).expect(200)).body.upload.state).toBe("ready");
    expect((await post(app(), buffer, randomUUID()).expect(429)).body.error.code).toBe("ASSET_UPLOAD_RATE_LIMIT");
    expect(await prisma.boardAsset.count()).toBe(10); expect(uploads).toBe(1); expect(files.size).toBe(1);
    // Replay/status issue no signed URL and consume no issuance/bandwidth budget.
    await status(api, id).expect(200); expect(await prisma.assetRequestBudget.count()).toBe(0);
  });

  it("keeps failed/deleting request identities terminal, releases storage only after confirmed deletion, and preserves legacy uploads", async () => {
    loseResponse = true;
    const api = app(), id = randomUUID(), buffer = await png(); await post(api, buffer, id).expect(202);
    const row = (await prisma.boardAsset.findMany())[0];
    failFind = false; loseResponse = false;
    await pool.query("UPDATE board_assets SET created_at=clock_timestamp()-interval '2 days', updated_at=clock_timestamp()-interval '2 days', upload_lease_until=clock_timestamp()-interval '1 second'");
    const service = createImageAssetService(createPostgresAssetStore(prisma), createControlledImageStorage(providerUrl));
    expect(await service.cleanup()).toEqual({ claimed: 1, deleted: 1, deferred: 0 }); expect(files.size).toBe(0);
    expect((await prisma.boardAsset.findMany())[0]).toMatchObject({ id: row.id, status: "failed", uploadRequestId: id });
    expect((await status(api, id).expect(200)).body.upload).toMatchObject({ state: "failed", canRetry: false, asset: null, assetId: row.id });
    expect((await post(api, buffer, id).expect(410)).body.error.code).toBe("ASSET_UPLOAD_EXPIRED");
    expect(await prisma.boardAsset.count()).toBe(1); expect(uploads).toBe(1);
    const legacy = await request(api).post(`/api/boards/${boardId}/assets`).set("Content-Type", "image/png").send(buffer).expect(201);
    expect(legacy.body.asset.id).not.toBe(row.id); expect(legacy.body.upload).toBeUndefined(); expect(uploads).toBe(2);
  });

  it("retains the reservation on finalization rollback and later reconciles the original file", async () => {
    await pool.query("CREATE FUNCTION fail_finalization() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='ready' THEN RAISE EXCEPTION 'injected finalization failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_finalization BEFORE UPDATE ON board_assets FOR EACH ROW EXECUTE FUNCTION fail_finalization()");
    const api = app(), id = randomUUID(), buffer = await png();
    await post(api, buffer, id).expect(202);
    expect((await prisma.boardAsset.findMany())[0]).toMatchObject({ status: "pending", providerFileId: null, uploadAttempts: 1 });
    await pool.query("DROP TRIGGER fail_finalization ON board_assets; DROP FUNCTION fail_finalization()");
    await expireLease(); expect((await status(api, id).expect(200)).body.upload.state).toBe("ready");
    expect(uploads).toBe(1); expect(await prisma.boardAsset.count()).toBe(1);
  });

  it("rolls back a failed reservation before provider I/O and allows the same unchanged identity after recovery", async () => {
    await pool.query("CREATE FUNCTION fail_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected reservation failure'; END $$; CREATE TRIGGER fail_reservation BEFORE INSERT ON board_assets FOR EACH ROW EXECUTE FUNCTION fail_reservation()");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const api = app(), id = randomUUID(), buffer = await png(); await post(api, buffer, id).expect(500);
    expect(await prisma.boardAsset.count()).toBe(0); expect(finds).toBe(0); expect(uploads).toBe(0);
    await pool.query("DROP TRIGGER fail_reservation ON board_assets; DROP FUNCTION fail_reservation()");
    await post(api, buffer, id).expect(200); expect(await prisma.boardAsset.count()).toBe(1);
  });

  it("upgrades version 10 atomically with safe legacy defaults, rolls back conflicts and enforces identity constraints", async () => {
    await pool.query("ALTER TABLE board_assets DROP COLUMN upload_request_id, DROP COLUMN upload_content_hash, DROP COLUMN upload_lease_token, DROP COLUMN upload_lease_until, DROP COLUMN upload_attempts; DELETE FROM schema_migrations WHERE version=11");
    const id = randomUUID();
    await pool.query("INSERT INTO board_assets(id,board_id,scope_board_id,uploader_id,status,byte_size,mime_type,width,height,provider_file_id,provider_file_path,last_referenced_at) VALUES($1,$2,$2,$3,'ready',20,'image/png',2,2,'legacy-file','/legacy/path.png',clock_timestamp())", [id, boardId, TEST_OWNER_ID]);
    const before = (await pool.query("SELECT to_jsonb(t) AS row FROM board_assets t")).rows;
    const ledger = (await pool.query("SELECT * FROM schema_migrations ORDER BY version")).rows;
    await pool.query("CREATE INDEX board_assets_upload_request_key ON board_assets(id)");
    await expect(migrateDatabase(pool)).rejects.toMatchObject({ code: "42P07" });
    expect((await pool.query("SELECT to_jsonb(t) AS row FROM board_assets t")).rows).toEqual(before);
    expect((await pool.query("SELECT * FROM schema_migrations ORDER BY version")).rows).toEqual(ledger);
    await pool.query("DROP INDEX board_assets_upload_request_key"); await Promise.all([migrateDatabase(pool), migrateDatabase(pool)]);
    const after = (await pool.query("SELECT to_jsonb(t) - ARRAY['upload_request_id','upload_content_hash','upload_lease_token','upload_lease_until','upload_attempts'] AS row FROM board_assets t")).rows;
    expect(after).toEqual(before);
    expect(await prisma.boardAsset.findUniqueOrThrow({ where: { id } })).toMatchObject({ uploadRequestId: null, uploadContentHash: null, uploadLeaseToken: null, uploadLeaseUntil: null, uploadAttempts: 0, status: "ready", providerFileId: "legacy-file" });
    await expect(pool.query("UPDATE board_assets SET upload_request_id=$2 WHERE id=$1", [id, randomUUID()])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE board_assets SET upload_attempts=1 WHERE id=$1", [id])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE board_assets SET upload_request_id=$2, upload_content_hash='BAD' WHERE id=$1", [id, randomUUID()])).rejects.toMatchObject({ code: "23514" });
    await pool.query("UPDATE board_assets SET upload_request_id=$2, upload_content_hash=$3 WHERE id=$1", [id, randomUUID(), "b".repeat(64)]);
    await expect(pool.query("UPDATE board_assets SET upload_attempts=4 WHERE id=$1", [id])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE board_assets SET upload_lease_token=$2 WHERE id=$1", [id, randomUUID()])).rejects.toMatchObject({ code: "23514" });
  });

  it("keeps SQL and Prisma aligned in a disposable schema", () => {
    const url = new URL(databaseUrl!); url.searchParams.set("schema", schema);
    const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"], {
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", windowsHide: true,
    });
    expect(result.status, result.stdout).toBe(0);
  }, 30_000);

  it("deduplicates across actual concurrent API processes and reconciles an ignored ready response after restart", async () => {
    const first = await startProcess(), second = await startProcess(), id = randomUUID(), buffer = await png();
    const results = await Promise.all([post(first.url, buffer, id), post(second.url, buffer, id)]);
    expect(results.map((result) => result.status)).toContain(200);
    expect(results.every((result) => [200, 202].includes(result.status))).toBe(true);
    expect(await prisma.boardAsset.count()).toBe(1); expect(files.size).toBe(1); expect(uploads).toBe(1);
    // Discard both response bodies. The persisted request UUID is sufficient.
    await stopProcess(first.child); await stopProcess(second.child);
    const restarted = await startProcess();
    const ready = await status(restarted.url, id).expect(200);
    expect(ready.body.upload.state).toBe("ready");
    expect((await post(restarted.url, buffer, id).expect(200)).body).toEqual(ready.body);
    expect(uploads).toBe(1);
  }, 30_000);

  it("recovers a committed provider write after killing the API before it receives the provider response", async () => {
    let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; }); holdUpload = () => wait;
    const first = await startProcess(), id = randomUUID(), buffer = await png();
    const pending = post(first.url, buffer, id).then((result) => result, () => null);
    await vi.waitFor(() => expect(files.size).toBe(1), { timeout: 10_000 });
    await stopProcess(first.child, true); release(); await pending;
    expect((await prisma.boardAsset.findMany())[0]).toMatchObject({ status: "pending", uploadAttempts: 1 });
    const restarted = await startProcess(); const calls = finds;
    expect((await status(restarted.url, id).expect(200)).body.upload.state).toBe("pending"); expect(finds).toBe(calls);
    await expireLease();
    expect((await status(restarted.url, id).expect(200)).body.upload.state).toBe("ready");
    await post(restarted.url, buffer, id).expect(200);
    expect(uploads).toBe(1); expect(files.size).toBe(1); expect(await prisma.boardAsset.count()).toBe(1);
  }, 30_000);
});
