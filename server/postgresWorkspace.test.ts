import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticatedApp, seedTestOwner, TEST_OWNER_ID } from "./testFixtures/authenticatedApp.js";
import { documentInput } from "./testFixtures/document.js";
import { migrateDatabase } from "./migrations.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPostgresDocumentStore } from "./postgresDocuments.js";
import { createPostgresWorkspaceStore } from "./postgresWorkspace.js";
import { createPrismaClient } from "./prisma.js";
import type { PrismaClient } from "./generated/prisma/client.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("real PostgreSQL workspace lifecycle", () => {
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let schema: string, pool: pg.Pool, prisma: PrismaClient;
  const processes = new Set<ChildProcess>();
  beforeEach(async () => {
    schema = `scribble_workspace_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    await migrateDatabase(pool); await seedTestOwner(pool); prisma = createPrismaClient(pool, schema);
  });
  afterEach(async () => {
    for (const child of processes) await stopProcess(child);
    await prisma?.$disconnect(); await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); vi.restoreAllMocks();
  });
  afterAll(async () => { await admin.end(); });
  function app(userId = TEST_OWNER_ID, client = prisma) {
    return createAuthenticatedApp(createPostgresBoardStore(client), createPostgresDocumentStore(client), userId, createPostgresWorkspaceStore(client));
  }
  const input = (createInitialPage = true, requestId: string = randomUUID()) => ({ requestId, createInitialPage });
  async function initialize(api: ReturnType<typeof app> | string = app(), body = input()) {
    return (await request(api).post("/api/workspace/initialize").send(body).expect(200)).body;
  }
  async function counts() {
    return { boards: await prisma.board.count(), documents: await prisma.boardDocument.count(), states: await prisma.workspaceState.count(), receipts: await prisma.workspaceInitializationReceipt.count() };
  }
  async function actor() {
    const id = randomUUID();
    await pool.query("INSERT INTO users(id,google_subject,email) VALUES($1::uuid,$1::uuid::text,'second@example.com')", [id]); return id;
  }
  async function startProcess() {
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./testFixtures/workspaceServer.ts", import.meta.url))], {
      env: { ...process.env, TEST_DATABASE_URL: databaseUrl, TEST_WORKSPACE_SCHEMA: schema }, stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true,
    });
    processes.add(child);
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Workspace fixture startup timed out")), 15_000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Workspace fixture exited before startup")); });
      child.once("message", (message) => {
        clearTimeout(timer);
        if (typeof message === "object" && message !== null && "port" in message && typeof message.port === "number") resolve(message.port);
        else reject(new Error("Invalid workspace fixture startup response"));
      });
    });
    return { child, url: `http://127.0.0.1:${port}` };
  }
  async function stopProcess(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) { processes.delete(child); return; }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill(), 5000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
      if (child.connected) child.send("stop"); else child.kill();
    }); processes.delete(child);
  }

  it("reads an uninitialized account without creating any rows or pages", async () => {
    await request(app()).get("/api/workspace").expect(200, { workspace: { initialized: false, lastOpenedBoardId: null } });
    expect(await counts()).toEqual({ boards: 0, documents: 0, states: 0, receipts: 0 });
  });
  it("creates one atomic blank revision-one page and never rewrites later content/title on replay", async () => {
    const api = app(), body = input(), result = await initialize(api, body), id = result.board.id;
    expect(result.workspace).toEqual({ initialized: true, lastOpenedBoardId: null });
    expect(result.initialization).toEqual({ requestId: body.requestId, replayed: false, initializedNow: true });
    expect(result.board).toMatchObject({ title: "Untitled", role: "owner" });
    expect((await request(api).get(`/api/boards/${id}/document`).expect(200)).body.document).toMatchObject({ schemaVersion: 1, revision: 1, content: { objects: [] } });
    await request(api).put(`/api/boards/${id}/document`).send(documentInput(0)).expect(409);
    const saved = (await request(api).put(`/api/boards/${id}/document`).send(documentInput(1)).expect(200)).body.document;
    await request(api).patch(`/api/boards/${id}`).send({ title: "Later edit" }).expect(200);
    await pool.query("UPDATE workspace_initialization_receipts SET created_at=clock_timestamp()-interval '100 days'");
    const replay = await initialize(api, { ...body, requestId: body.requestId.toUpperCase() });
    expect(replay.board).toMatchObject({ id, title: "Later edit" });
    expect(replay.initialization).toMatchObject({ replayed: true, initializedNow: false });
    expect((await request(api).get(`/api/boards/${id}/document`).expect(200)).body.document).toEqual(saved);
    expect(await counts()).toEqual({ boards: 1, documents: 1, states: 1, receipts: 1 });
  });
  it.each([false, true])("serializes different initialization intents across independent clients (mixed import mode: %s)", async (mixedImportMode) => {
    const otherPool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` }), other = createPrismaClient(otherPool, schema);
    try {
      const apis = [app(), app(TEST_OWNER_ID, other)];
      const results = await Promise.all(Array.from({ length: 12 }, (_, index) => initialize(apis[index % 2], input(!mixedImportMode || index % 2 !== 0))));
      expect(results.filter((result) => result.initialization.initializedNow)).toHaveLength(1);
      expect(new Set(results.map((result) => result.board?.id ?? null)).size).toBe(1);
      const pageCount = results.find((result) => result.initialization.initializedNow)!.board ? 1 : 0;
      expect(await counts()).toEqual({ boards: pageCount, documents: pageCount, states: 1, receipts: 12 });
    } finally { await other.$disconnect(); await otherPool.end(); }
  });
  it("deduplicates concurrent identical requests and conflicts on a reused mode", async () => {
    const api = app(), body = input();
    const results = await Promise.all(Array.from({ length: 8 }, () => initialize(api, body)));
    expect(results.filter((result) => !result.initialization.replayed)).toHaveLength(1);
    expect(new Set(results.map((result) => result.board.id)).size).toBe(1);
    expect((await request(api).post("/api/workspace/initialize").send({ ...body, createInitialPage: false }).expect(409)).body.error.code).toBe("WORKSPACE_INITIALIZATION_CONFLICT");
    expect(await counts()).toEqual({ boards: 1, documents: 1, states: 1, receipts: 1 });
  });
  it("handles concurrent conflicting payloads without partially applying the loser", async () => {
    const api = app(), body = input(false);
    const results = await Promise.all([request(api).post("/api/workspace/initialize").send(body), request(api).post("/api/workspace/initialize").send({ ...body, createInitialPage: true })]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const winner = results.find((result) => result.status === 200)!;
    expect(await counts()).toEqual({ boards: winner.body.board ? 1 : 0, documents: winner.body.board ? 1 : 0, states: 1, receipts: 1 });
  });
  it("initializes import mode without a blank page and never creates one on a later mode/request", async () => {
    const api = app(), body = input(false);
    expect((await initialize(api, body)).board).toBeNull();
    expect((await initialize(api)).board).toBeNull();
    expect(await counts()).toEqual({ boards: 0, documents: 0, states: 1, receipts: 2 });
    const created = (await request(api).post("/api/boards").send({ title: "Imported", requestId: randomUUID(), initializeDocument: true }).expect(201)).body;
    expect((await initialize(api, body)).board.id).toBe(created.board.id);
    expect(await counts()).toEqual({ boards: 1, documents: 1, states: 1, receipts: 2 });
  });
  it("preserves existing owned/shared pages, prefers owned fallback and honors last-opened viewer pages", async () => {
    const other = await actor(), api = app(), boards = createPostgresBoardStore(prisma);
    const shared = await boards.create("Shared older", other), owned = await boards.create("Owned", TEST_OWNER_ID);
    await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'viewer')", [shared.id, TEST_OWNER_ID]);
    expect((await initialize(api)).board).toEqual(owned);
    await request(api).patch("/api/workspace").send({ lastOpenedBoardId: shared.id }).expect(200, { workspace: { initialized: true, lastOpenedBoardId: shared.id } });
    expect((await initialize(api)).board).toEqual({ ...shared, role: "viewer" });
    expect(await counts()).toEqual({ boards: 2, documents: 0, states: 1, receipts: 2 });
  });
  it("does not create a first page for a shared-only user", async () => {
    const other = await actor(), board = await createPostgresBoardStore(prisma).create("Shared only", other);
    await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'editor')", [board.id, TEST_OWNER_ID]);
    expect((await initialize()).board).toEqual({ ...board, role: "editor" });
    expect(await counts()).toEqual({ boards: 1, documents: 0, states: 1, receipts: 1 });
  });
  it("excludes ownerless pages, unaccepted invitations and inaccessible account pages", async () => {
    const other = await actor(), otherBoard = await createPostgresBoardStore(prisma).create("Private", other);
    await pool.query("INSERT INTO boards(id,title) VALUES($1,'Ownerless')", [randomUUID()]);
    await pool.query("INSERT INTO board_invitations(id,board_id,email,role) VALUES($1,$2,'owner@example.com','viewer')", [randomUUID(), otherBoard.id]);
    const result = await initialize(); expect(result.board.title).toBe("Untitled");
    expect((await prisma.board.findUniqueOrThrow({ where: { id: otherBoard.id } })).title).toBe("Private");
    expect(await counts()).toEqual({ boards: 3, documents: 1, states: 1, receipts: 1 });
  });
  it("isolates matching request IDs and last-opened preferences by account", async () => {
    const other = await actor(), body = input(), first = await initialize(app(), body), second = await initialize(app(other), body);
    expect(first.board.id).not.toBe(second.board.id);
    await request(app()).patch("/api/workspace").send({ lastOpenedBoardId: first.board.id }).expect(200);
    await request(app(other)).get("/api/workspace").expect(200, { workspace: { initialized: true, lastOpenedBoardId: null } });
    await request(app(other)).patch("/api/workspace").send({ lastOpenedBoardId: first.board.id }).expect(404);
    expect(await counts()).toEqual({ boards: 2, documents: 2, states: 2, receipts: 2 });
  });
  it("allows preferences before initialization and validates inaccessible targets without mutating state", async () => {
    const api = app(), board = await createPostgresBoardStore(prisma).create("Already opened", TEST_OWNER_ID);
    await request(api).patch("/api/workspace").send({ lastOpenedBoardId: board.id }).expect(200, { workspace: { initialized: false, lastOpenedBoardId: board.id } });
    await request(api).patch("/api/workspace").send({ lastOpenedBoardId: randomUUID() }).expect(404);
    await request(api).get("/api/workspace").expect(200, { workspace: { initialized: false, lastOpenedBoardId: board.id } });
    expect((await initialize(api)).board.id).toBe(board.id);
    await request(api).patch("/api/workspace").send({ lastOpenedBoardId: null }).expect(200, { workspace: { initialized: true, lastOpenedBoardId: null } });
    expect(await prisma.boardDocument.count()).toBe(0);
  });
  it("masks revoked last-opened pages on reads/replays and falls back without changing GET storage", async () => {
    const api = app(), other = await actor(), boards = createPostgresBoardStore(prisma), shared = await boards.create("Shared", other);
    await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'viewer')", [shared.id, TEST_OWNER_ID]);
    const body = input(); await initialize(api, body);
    await request(api).patch("/api/workspace").send({ lastOpenedBoardId: shared.id }).expect(200);
    const fallback = await boards.create("Fallback", TEST_OWNER_ID);
    await pool.query("DELETE FROM board_members WHERE board_id=$1", [shared.id]);
    await request(api).get("/api/workspace").expect(200, { workspace: { initialized: true, lastOpenedBoardId: null } });
    expect((await prisma.workspaceState.findUniqueOrThrow({ where: { userId: TEST_OWNER_ID } })).lastOpenedBoardId).toBe(shared.id);
    expect((await initialize(api, body)).board).toEqual(fallback);
    await request(api).patch("/api/workspace").send({ lastOpenedBoardId: shared.id }).expect(404);
    await boards.delete(fallback.id, TEST_OWNER_ID);
    expect((await initialize(api)).board).toBeNull(); expect(await prisma.board.count()).toBe(1);
  });
  it("clears deleted last-page references, falls back, and preserves intentional final emptiness", async () => {
    const api = app(), body = input(), first = await initialize(api, body), boards = createPostgresBoardStore(prisma);
    const second = await boards.create("Second", TEST_OWNER_ID);
    await request(api).patch("/api/workspace").send({ lastOpenedBoardId: first.board.id }).expect(200);
    await request(api).delete(`/api/boards/${first.board.id}`).expect(204);
    expect((await prisma.workspaceState.findUniqueOrThrow({ where: { userId: TEST_OWNER_ID } })).lastOpenedBoardId).toBeNull();
    expect((await initialize(api, body)).board).toEqual(second);
    await request(api).delete(`/api/boards/${second.id}`).expect(204);
    expect((await initialize(api, body)).board).toBeNull(); expect((await initialize(api)).board).toBeNull();
    expect(await counts()).toEqual({ boards: 0, documents: 0, states: 1, receipts: 2 });
  });
  it.each(["workspace_states", "workspace_initialization_receipts", "board_documents"])("rolls back the entire first initialization on %s failure and safely retries", async (table) => {
    const api = app(), body = input();
    await pool.query(`CREATE FUNCTION reject_workspace() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected workspace failure'; END $$;
      CREATE TRIGGER reject_workspace BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_workspace()`);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await request(api).post("/api/workspace/initialize").send(body).expect(500);
    expect(await counts()).toEqual({ boards: 0, documents: 0, states: 0, receipts: 0 });
    await pool.query(`DROP TRIGGER reject_workspace ON ${table}; DROP FUNCTION reject_workspace()`);
    await initialize(api, body); expect(await counts()).toEqual({ boards: 1, documents: 1, states: 1, receipts: 1 });
  });
  it("shares the explicit-creation actor lock and observes a page committed while initialization waits", async () => {
    const blocker = await pool.connect(), boardId = randomUUID();
    try {
      await blocker.query("BEGIN"); await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [TEST_OWNER_ID]);
      const pending = initialize(app());
      await vi.waitFor(async () => {
        const locks = await admin.query("SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%SELECT id FROM users WHERE id =%' AND pid<>pg_backend_pid()");
        expect(locks.rows[0].waiting).toBeGreaterThan(0);
      }, { timeout: 5000 });
      await blocker.query("INSERT INTO boards(id,title,owner_id) VALUES($1,'Committed explicit page',$2)", [boardId, TEST_OWNER_ID]);
      await blocker.query("INSERT INTO board_documents(board_id,schema_version,revision,content) VALUES($1,1,1,'{\"objects\":[]}')", [boardId]);
      await blocker.query("COMMIT"); expect((await pending).board.id).toBe(boardId);
      expect(await counts()).toEqual({ boards: 1, documents: 1, states: 1, receipts: 1 });
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  });
  it("allows sharing foreign-key checks while initialization holds the actor lock and waits on a board", async () => {
    const other = await actor(), board = await createPostgresBoardStore(prisma).create("Shared", other);
    await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'viewer')", [board.id, TEST_OWNER_ID]);
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN"); await blocker.query("SELECT id FROM boards WHERE id=$1 FOR UPDATE", [board.id]);
      const pending = initialize(app());
      await vi.waitFor(async () => {
        const locks = await admin.query("SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%LIMIT 1 FOR SHARE OF b%' AND pid<>pg_backend_pid()");
        expect(locks.rows[0].waiting).toBeGreaterThan(0);
      }, { timeout: 5000 });
      await blocker.query("DELETE FROM board_members WHERE board_id=$1 AND user_id=$2", [board.id, TEST_OWNER_ID]);
      // Same FK check/lock order as invitation acceptance; it must not wait on
      // the actor lock held by the request waiting for our parent board.
      await blocker.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'editor')", [board.id, TEST_OWNER_ID]);
      await blocker.query("COMMIT"); expect((await pending).board).toEqual({ ...board, role: "editor" });
      expect(await prisma.board.count()).toBe(1);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  }, 15_000);

  it("resolves concurrent crossed revoked preferences into each account's accessible fallback", async () => {
    const other = await actor(), boards = createPostgresBoardStore(prisma);
    const owned = await boards.create("Owned", TEST_OWNER_ID), second = await boards.create("Second", other);
    await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'viewer'),($3,$4,'viewer')", [owned.id, other, second.id, TEST_OWNER_ID]);
    await request(app()).patch("/api/workspace").send({ lastOpenedBoardId: second.id }).expect(200);
    await request(app(other)).patch("/api/workspace").send({ lastOpenedBoardId: owned.id }).expect(200);
    await pool.query("DELETE FROM board_members");
    const results = await Promise.all([initialize(app()), initialize(app(other))]);
    expect(results.map((result) => result.board.id)).toEqual([owned.id, second.id]);
    expect(results.map((result) => result.workspace.lastOpenedBoardId)).toEqual([null, null]);
    expect(await counts()).toEqual({ boards: 2, documents: 0, states: 2, receipts: 2 });
  });

  it("serializes separate API processes, survives ignored responses/restart and never resurrects final deletion", async () => {
    const first = await startProcess(), second = await startProcess(), body = input();
    const [, current] = await Promise.all([
      request(first.url).post("/api/workspace/initialize").send(body).expect(200).then(() => undefined),
      initialize(second.url),
    ]);
    // Discard the first response body: its destination is unknown to that caller.
    expect(await counts()).toEqual({ boards: 1, documents: 1, states: 1, receipts: 2 });
    await request(first.url).patch("/api/workspace").send({ lastOpenedBoardId: current.board.id }).expect(200);
    await stopProcess(first.child); await stopProcess(second.child);
    const restarted = await startProcess(), replay = await initialize(restarted.url, body);
    expect(replay.initialization).toMatchObject({ replayed: true, initializedNow: false });
    expect(replay.workspace.lastOpenedBoardId).toBe(current.board.id);
    await request(restarted.url).delete(`/api/boards/${current.board.id}`).expect(204);
    await stopProcess(restarted.child);
    const again = await startProcess(); expect((await initialize(again.url, body)).board).toBeNull();
    expect((await initialize(again.url)).board).toBeNull();
    expect(await counts()).toEqual({ boards: 0, documents: 0, states: 1, receipts: 3 });
  }, 40_000);
});
