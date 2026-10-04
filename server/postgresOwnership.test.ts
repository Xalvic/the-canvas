import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashToken, randomToken, SESSION_COOKIE } from "./auth.js";
import { migrateDatabase } from "./migrations.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPostgresDocumentStore } from "./postgresDocuments.js";
import { createPostgresAuthStore } from "./postgresAuth.js";
import { documentInput } from "./testFixtures/document.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("real PostgreSQL board ownership", () => {
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let schema: string, pool: pg.Pool;
  beforeEach(async () => {
    schema = `scribble_ownership_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema, connectionTimeoutMillis: 5000 });
    await migrateDatabase(pool);
  });
  afterEach(async () => { await pool?.end(); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); });
  afterAll(async () => { await admin.end(); });

  async function setup() {
    const auth = createPostgresAuthStore(pool), boards = createPostgresBoardStore(pool), documents = createPostgresDocumentStore(pool);
    const firstToken = randomToken(), secondToken = randomToken();
    const first = await auth.signIn({ subject: "ownership-first", email: "first@example.com", displayName: null }, hashToken(firstToken));
    const second = await auth.signIn({ subject: "ownership-second", email: "second@example.com", displayName: null }, hashToken(secondToken));
    const app = createApp(boards, documents, { store: auth, provider: null, frontendUrl: "http://127.0.0.1:5173/scribble/", secureCookies: false });
    return { app, auth, boards, documents, first, second, firstToken, cookie: `${SESSION_COOKIE}=${firstToken}`, otherCookie: `${SESSION_COOKIE}=${secondToken}` };
  }

  it("enforces ownership on every metadata/document path and leaves foreign data unchanged", async () => {
    const { app, boards, documents, first, second, cookie, otherCookie } = await setup();
    const metadata = await boards.create("Owner drawing", first.user.id);
    await boards.create("Other drawing", second.user.id);
    await documents.save(metadata.id, documentInput(), first.user.id);
    const before = (await pool.query("SELECT b.*, d.content, d.revision, d.updated_at AS document_updated_at FROM boards b JOIN board_documents d ON d.board_id = b.id WHERE b.id = $1", [metadata.id])).rows;
    expect((await request(app).get("/api/boards").set("Cookie", otherCookie).expect(200)).body.boards.map((b: { title: string }) => b.title)).toEqual(["Other drawing"]);
    const url = `/api/boards/${metadata.id}`;
    for (const [method, path, body] of [["get", url, {}], ["patch", url, { title: "Stolen" }], ["delete", url, {}], ["get", `${url}/document`, {}], ["put", `${url}/document`, documentInput(0, "Stolen")]] as const) {
      const result = await request(app)[method](path).set("Cookie", otherCookie).set("X-Scribble-Request", "1").send(body).expect(404);
      expect(result.body.error).toEqual({ code: "BOARD_NOT_FOUND", message: "Board not found" });
    }
    expect((await pool.query("SELECT b.*, d.content, d.revision, d.updated_at AS document_updated_at FROM boards b JOIN board_documents d ON d.board_id = b.id WHERE b.id = $1", [metadata.id])).rows).toEqual(before);
    await request(app).put(`${url}/document`).set("Cookie", cookie).set("X-Scribble-Request", "1").send(documentInput(1)).expect(200);
    await request(app).patch(url).set("Cookie", cookie).set("X-Scribble-Request", "1").send({ title: "Renamed" }).expect(200);
    await request(app).delete(url).set("Cookie", cookie).set("X-Scribble-Request", "1").expect(204);
    expect((await pool.query("SELECT * FROM board_documents WHERE board_id = $1", [metadata.id])).rows).toEqual([]);
    expect((await boards.list(second.user.id)).map((b) => b.title)).toEqual(["Other drawing"]);
  });

  it("preserves and hides unowned legacy metadata/documents instead of claiming them", async () => {
    const { app, boards, first, cookie } = await setup();
    const id = randomUUID();
    await pool.query("INSERT INTO boards (id, title) VALUES ($1, 'Legacy proof')", [id]);
    await pool.query("INSERT INTO board_documents (board_id, schema_version, revision, content) VALUES ($1, 1, 1, $2::jsonb)", [id, JSON.stringify(documentInput().content)]);
    expect(await boards.list(first.user.id)).toEqual([]);
    await request(app).get(`/api/boards/${id}/document`).set("Cookie", cookie).expect(404);
    await request(app).put(`/api/boards/${id}/document`).set("Cookie", cookie).set("X-Scribble-Request", "1").send(documentInput(1)).expect(404);
    expect((await pool.query("SELECT title, owner_id FROM boards WHERE id = $1", [id])).rows).toEqual([{ title: "Legacy proof", owner_id: null }]);
    expect((await pool.query("SELECT revision FROM board_documents WHERE board_id = $1", [id])).rows).toEqual([{ revision: 1 }]);
  });

  it("takes the creation owner from a valid session and rejects expired/revoked cookies", async () => {
    const { app, auth, first, firstToken, cookie } = await setup();
    const created = await request(app).post("/api/boards").set("Cookie", cookie).set("X-Scribble-Request", "1").send({ title: "Session owned" }).expect(201);
    expect((await pool.query("SELECT owner_id FROM boards WHERE id = $1", [created.body.board.id])).rows).toEqual([{ owner_id: first.user.id }]);
    await pool.query("UPDATE auth_sessions SET created_at = clock_timestamp() - interval '2 days', expires_at = clock_timestamp() - interval '1 day' WHERE token_hash = $1", [hashToken(firstToken)]);
    await request(app).get("/api/boards").set("Cookie", cookie).expect(401);
    await auth.revokeSession(hashToken(firstToken));
    await request(app).get(`/api/boards/${created.body.board.id}`).set("Cookie", cookie).expect(401);
    expect((await pool.query("SELECT title FROM boards")).rows).toEqual([{ title: "Session owned" }]);
  });

  it("rechecks ownership when a document save waits behind a parent-row update", async () => {
    const { boards, documents, first, second } = await setup();
    const board = await boards.create("Locked owner", first.user.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE boards SET owner_id = $2 WHERE id = $1", [board.id, second.user.id]);
      const pending = documents.save(board.id, documentInput(), first.user.id);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await admin.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock') AS waiting", [schema])).rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await client.query("COMMIT");
      expect(await pending).toEqual({ status: "board-not-found" });
      expect(waiting).toBe(true);
      expect((await pool.query("SELECT * FROM board_documents")).rows).toEqual([]);
      expect((await documents.save(board.id, documentInput(), second.user.id)).status).toBe("saved");
    } finally { await client.query("ROLLBACK"); client.release(); }
  });

  it("enforces the owner foreign key and prevents deleting an owner with boards", async () => {
    const { boards, first } = await setup();
    await expect(boards.create("Missing owner", randomUUID())).rejects.toMatchObject({ code: "23503" });
    const board = await boards.create("Keep owner", first.user.id);
    await expect(pool.query("DELETE FROM users WHERE id = $1", [first.user.id])).rejects.toMatchObject({ code: "23001" });
    expect(await boards.get(board.id, first.user.id)).toEqual(board);
  });
});
