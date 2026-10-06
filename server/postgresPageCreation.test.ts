import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticatedApp, seedTestOwner, TEST_OWNER_ID } from "./testFixtures/authenticatedApp.js";
import { documentInput } from "./testFixtures/document.js";
import { migrateDatabase } from "./migrations.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPostgresDocumentStore } from "./postgresDocuments.js";
import { createPrismaClient } from "./prisma.js";
import type { PrismaClient } from "./generated/prisma/client.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("real PostgreSQL retry-safe page creation", () => {
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let schema: string, pool: pg.Pool, prisma: PrismaClient;
  const processes = new Set<ChildProcess>();

  beforeEach(async () => {
    schema = `scribble_creation_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    await migrateDatabase(pool); await seedTestOwner(pool);
    prisma = createPrismaClient(pool, schema);
  });
  afterEach(async () => {
    for (const child of processes) await stopProcess(child);
    await prisma?.$disconnect(); await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    vi.restoreAllMocks();
  });
  afterAll(async () => { await admin.end(); });

  function app(ownerId = TEST_OWNER_ID, client = prisma) {
    return createAuthenticatedApp(createPostgresBoardStore(client), createPostgresDocumentStore(client), ownerId);
  }
  const input = (title = "Untitled", requestId = randomUUID()) => ({ title, requestId, initializeDocument: true });
  async function counts() {
    return { boards: await prisma.board.count(), documents: await prisma.boardDocument.count(), receipts: await prisma.boardCreationReceipt.count() };
  }
  async function secondActor() {
    const id = randomUUID();
    await pool.query("INSERT INTO users(id,google_subject,email) VALUES($1::uuid,$1::uuid::text,'second@example.com')", [id]);
    return id;
  }
  async function startProcess() {
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./testFixtures/pageCreationServer.ts", import.meta.url))], {
      env: { ...process.env, TEST_DATABASE_URL: databaseUrl, TEST_CREATION_SCHEMA: schema },
      stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true,
    });
    processes.add(child);
    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Creation fixture startup timed out")), 15_000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error("Creation fixture exited before startup")); });
      child.once("message", (message) => {
        clearTimeout(timeout);
        if (typeof message === "object" && message !== null && "port" in message && typeof message.port === "number") resolve(message.port);
        else reject(new Error("Invalid fixture startup response"));
      });
    });
    return { child, url: `http://127.0.0.1:${port}` };
  }
  async function stopProcess(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) { processes.delete(child); return; }
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => child.kill(), 5000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
      if (child.connected) child.send("stop"); else child.kill();
    });
    processes.delete(child);
  }

  it("atomically creates a blank revision-one document and never resets later content/title on replay", async () => {
    const api = app(), body = input("  Ideas  ");
    const created = (await request(api).post("/api/boards").send(body).expect(201)).body;
    expect(created.creation).toMatchObject({ requestId: body.requestId, documentRevision: 1, replayed: false });
    expect(created.creation.expiresAt).toBeGreaterThan(Date.now() + 89 * 86_400_000);
    const url = `/api/boards/${created.board.id}`;
    expect((await request(api).get(`${url}/document`).expect(200)).body.document).toEqual({
      boardId: created.board.id, schemaVersion: 1, revision: 1, content: { objects: [] }, role: "owner", updatedAt: created.board.updatedAt,
    });
    await request(api).put(`${url}/document`).send(documentInput(0)).expect(409);
    const saved = (await request(api).put(`${url}/document`).send(documentInput(1)).expect(200)).body.document;
    const renamed = (await request(api).patch(url).send({ title: "Renamed" }).expect(200)).body.board;
    const replay = (await request(api).post("/api/boards").send({ ...body, title: "Ideas", requestId: body.requestId.toUpperCase() }).expect(200)).body;
    expect(replay).toEqual({ board: renamed, creation: { ...created.creation, replayed: true } });
    expect(saved.revision).toBe(2);
    expect((await request(api).get(`${url}/document`).expect(200)).body.document).toEqual(saved);
    expect(await counts()).toEqual({ boards: 1, documents: 1, receipts: 1 });
  });

  it("serializes concurrent duplicate requests across independent database clients", async () => {
    const otherPool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    const otherPrisma = createPrismaClient(otherPool, schema);
    try {
      const apis = [app(), app(TEST_OWNER_ID, otherPrisma)], body = input();
      const results = await Promise.all(Array.from({ length: 12 }, (_, index) => request(apis[index % 2]).post("/api/boards").send(body)));
      expect(results.filter((result) => result.status === 201)).toHaveLength(1);
      expect(results.filter((result) => result.status === 200)).toHaveLength(11);
      expect(new Set(results.map((result) => result.body.board.id)).size).toBe(1);
      expect(new Set(results.map((result) => result.body.creation.expiresAt)).size).toBe(1);
      expect(await counts()).toEqual({ boards: 1, documents: 1, receipts: 1 });
    } finally { await otherPrisma.$disconnect(); await otherPool.end(); }
  });

  it("rejects payload reuse, including a competing concurrent payload, without changing the winner", async () => {
    const api = app(), first = input("First"), second = { ...first, title: "Second" };
    const results = await Promise.all([request(api).post("/api/boards").send(first), request(api).post("/api/boards").send(second)]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)!.body.error.code).toBe("CREATION_REQUEST_CONFLICT");
    const winner = results.find((result) => result.status === 201)!.body.board;
    expect((await request(api).get(`/api/boards/${winner.id}`).expect(200)).body.board).toEqual(winner);
    expect(await counts()).toEqual({ boards: 1, documents: 1, receipts: 1 });
    await request(api).post("/api/boards").send(input("Third")).expect(201);
    expect(await counts()).toEqual({ boards: 2, documents: 2, receipts: 2 });
  });

  it("keeps identical request IDs isolated by authenticated actor", async () => {
    const other = await secondActor(), body = input("Owner's page");
    const first = (await request(app()).post("/api/boards").send(body).expect(201)).body;
    const second = (await request(app(other)).post("/api/boards").send({ ...body, title: "Other's page" }).expect(201)).body;
    expect(second.board.id).not.toBe(first.board.id);
    expect((await request(app(other)).post("/api/boards").send({ ...body, title: "Other's page" }).expect(200)).body.board).toEqual(second.board);
    await request(app(other)).get(`/api/boards/${first.board.id}`).expect(404);
    expect(await counts()).toEqual({ boards: 2, documents: 2, receipts: 2 });
  });

  it("rechecks current access on replay, including a newly read-only actor and revocation", async () => {
    const other = await secondActor(), api = app(), body = input();
    const { board } = (await request(api).post("/api/boards").send(body).expect(201)).body;
    await pool.query("UPDATE boards SET owner_id=$2 WHERE id=$1", [board.id, other]);
    expect((await request(api).post("/api/boards").send(body).expect(404)).body.error.code).toBe("BOARD_NOT_FOUND");
    await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'viewer')", [board.id, TEST_OWNER_ID]);
    expect((await request(api).post("/api/boards").send(body).expect(200)).body.board.role).toBe("viewer");
    await request(api).put(`/api/boards/${board.id}/document`).send(documentInput(1)).expect(403);
    await pool.query("DELETE FROM board_members WHERE board_id=$1", [board.id]);
    await request(api).post("/api/boards").send(body).expect(404);
    expect(await counts()).toEqual({ boards: 1, documents: 1, receipts: 1 });
  });

  it("retains a deleted destination's identity and never recreates it", async () => {
    const api = app(), body = input();
    const { board } = (await request(api).post("/api/boards").send(body).expect(201)).body;
    await request(api).delete(`/api/boards/${board.id}`).expect(204);
    expect((await request(app()).post("/api/boards").send(body).expect(410)).body.error.code).toBe("CREATION_DESTINATION_GONE");
    expect(await counts()).toEqual({ boards: 0, documents: 0, receipts: 1 });
    expect((await prisma.boardCreationReceipt.findMany())[0].boardId).toBeNull();
    await request(api).post("/api/boards").send({ ...body, title: "Changed" }).expect(409);
  });

  it("returns a terminal expiry without deleting the page or treating an old request as new", async () => {
    const api = app(), body = input();
    await request(api).post("/api/boards").send(body).expect(201);
    await pool.query("UPDATE board_creation_receipts SET created_at=clock_timestamp()-interval '100 days', expires_at=clock_timestamp()-interval '10 days'");
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await request(app()).post("/api/boards").send(body).expect(410)).body.error.code).toBe("CREATION_REQUEST_EXPIRED");
    }
    expect(await counts()).toEqual({ boards: 1, documents: 1, receipts: 1 });
    expect((await request(api).get("/api/boards").expect(200)).body.boards).toHaveLength(1);
  });

  it("rolls back metadata and document if receipt persistence fails, then safely retries the same request", async () => {
    const api = app(), body = input();
    await pool.query(`CREATE FUNCTION reject_creation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt failure'; END $$;
      CREATE TRIGGER reject_creation BEFORE INSERT ON board_creation_receipts FOR EACH ROW EXECUTE FUNCTION reject_creation()`);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await request(api).post("/api/boards").send(body).expect(500);
    expect(await counts()).toEqual({ boards: 0, documents: 0, receipts: 0 });
    await pool.query("DROP TRIGGER reject_creation ON board_creation_receipts; DROP FUNCTION reject_creation()");
    await request(api).post("/api/boards").send(body).expect(201);
    expect(await counts()).toEqual({ boards: 1, documents: 1, receipts: 1 });
  });

  it("preserves legacy metadata-only creation and its revision-zero first save", async () => {
    const api = app();
    const first = (await request(api).post("/api/boards").send({ title: "Legacy" }).expect(201)).body;
    const second = (await request(api).post("/api/boards").send({ title: "Legacy" }).expect(201)).body;
    expect(first.creation).toBeUndefined(); expect(second.board.id).not.toBe(first.board.id);
    const url = `/api/boards/${first.board.id}`;
    expect((await request(api).get(`${url}/document`).expect(404)).body.error.code).toBe("DOCUMENT_NOT_FOUND");
    expect((await request(api).put(`${url}/document`).send(documentInput(0)).expect(201)).body.document.revision).toBe(1);
    expect(await counts()).toEqual({ boards: 2, documents: 1, receipts: 0 });
  });

  it("keeps Prisma mappings aligned with the SQL-owned schema without a separate migration history", () => {
    const url = new URL(databaseUrl!); url.searchParams.set("schema", schema);
    const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"], {
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", windowsHide: true,
    });
    expect(result.status, result.stdout).toBe(0);
  }, 30_000);

  it("reconciles an ignored creation response after an actual API process restart", async () => {
    const first = await startProcess(), body = input();
    // Discard the response body exactly as a caller with an unknown destination.
    await request(first.url).post("/api/boards").send(body).expect(201);
    await stopProcess(first.child);
    const restarted = await startProcess();
    const replay = (await request(restarted.url).post("/api/boards").send(body).expect(200)).body;
    expect(replay.creation).toMatchObject({ requestId: body.requestId, documentRevision: 1, replayed: true });
    await request(restarted.url).get(`/api/boards/${replay.board.id}/document`).expect(200);
    await request(restarted.url).delete(`/api/boards/${replay.board.id}`).expect(204);
    await stopProcess(restarted.child);
    const again = await startProcess();
    expect((await request(again.url).post("/api/boards").send(body).expect(410)).body.error.code).toBe("CREATION_DESTINATION_GONE");
    expect(await counts()).toEqual({ boards: 0, documents: 0, receipts: 1 });
  }, 30_000);
});
