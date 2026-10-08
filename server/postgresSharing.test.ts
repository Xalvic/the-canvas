import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { beforeEach, afterEach, afterAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createPrismaClient } from "./prisma.js";
import { migrateDatabase } from "./migrations.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPostgresDocumentStore } from "./postgresDocuments.js";
import { createPostgresAuthStore } from "./postgresAuth.js";
import { createPostgresSharingStore } from "./postgresSharing.js";
import { hashToken, randomToken, SESSION_COOKIE } from "./auth.js";
import { documentInput } from "./testFixtures/document.js";
import type { PrismaClient } from "./generated/prisma/client.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("real PostgreSQL sharing and roles", () => {
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let schema: string, pool: pg.Pool, prisma: PrismaClient;
  beforeEach(async () => {
    schema = `scribble_sharing_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema, max: 5 });
    await migrateDatabase(pool);
    prisma = createPrismaClient(pool, schema);
  });
  afterEach(async () => { await prisma?.$disconnect(); await pool?.end(); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); });
  afterAll(async () => { await admin.end(); });

  async function setup() {
    const auth = createPostgresAuthStore(prisma), boards = createPostgresBoardStore(prisma), documents = createPostgresDocumentStore(prisma), sharing = createPostgresSharingStore(prisma);
    async function account(subject: string) {
      const token = randomToken();
      const session = await auth.signIn({ subject, email: `${subject}@example.com`, displayName: subject }, hashToken(token));
      return { ...session.user, cookie: `${SESSION_COOKIE}=${token}` };
    }
    const owner = await account("owner"), editor = await account("editor"), viewer = await account("viewer"), stranger = await account("stranger");
    const board = await boards.create("Shared drawing", owner.id);
    await documents.save(board.id, documentInput(), owner.id);
    const app = createApp(boards, documents, { store: auth, provider: null, frontendUrl: "http://127.0.0.1:5173/scribble/", secureCookies: false }, sharing);
    async function grant(person: typeof editor, role: "editor" | "viewer") {
      const invite = await sharing.invite(board.id, owner.id, { email: person.email, role });
      await sharing.accept(invite.id, person.id, person.email);
    }
    return { app, boards, documents, sharing, owner, editor, viewer, stranger, board, grant };
  }

  it("rolls a failed sharing migration back and safely retries with existing content intact", async () => {
    const { board, owner, documents } = await setup();
    const before = await documents.get(board.id, owner.id);
    await pool.query("DROP TABLE board_share_link_grants, board_share_link_receipts, board_share_links, workspace_initialization_receipts, workspace_states, board_creation_receipts, api_request_budgets, board_operation_receipts, board_assets, asset_request_budgets, board_invitations, board_members; DELETE FROM schema_migrations WHERE version >= 5; CREATE TABLE board_invitations (sentinel text)");
    await expect(migrateDatabase(pool)).rejects.toThrow();
    expect((await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map((row) => row.version)).toEqual([1, 2, 3, 4]);
    expect((await pool.query("SELECT to_regclass('board_members') AS members")).rows[0].members).toBeNull();
    await pool.query("DROP TABLE board_invitations"); await migrateDatabase(pool);
    expect(await documents.get(board.id, owner.id)).toEqual(before);
    expect(await prisma.boardMember.count()).toBe(0);
  });

  it("keeps an invitation private and grants access only after explicit acceptance by its verified email", async () => {
    const { app, boards, owner, editor, stranger, board } = await setup();
    const created = await request(app).post(`/api/boards/${board.id}/invitations`).set("Cookie", owner.cookie).set("X-Scribble-Request", "1").send({ email: "  EDITOR@example.com  ", role: "editor" }).expect(201);
    const invite = created.body.invitation;
    expect(invite).toMatchObject({ email: editor.email, role: "editor", expiresAt: expect.any(Number) });
    expect((await request(app).get("/api/invitations").set("Cookie", editor.cookie).expect(200)).body.invitations).toEqual([{ ...invite, boardId: board.id, boardTitle: board.title, ownerEmail: owner.email }]);
    expect((await request(app).get("/api/invitations").set("Cookie", stranger.cookie).expect(200)).body.invitations).toEqual([]);
    await request(app).get(`/api/boards/${board.id}/document`).set("Cookie", editor.cookie).expect(404);
    await request(app).post(`/api/invitations/${invite.id}/accept`).set("Cookie", stranger.cookie).set("X-Scribble-Request", "1").expect(404);
    const accepted = await request(app).post(`/api/invitations/${invite.id}/accept`).set("Cookie", editor.cookie).set("X-Scribble-Request", "1").expect(200);
    expect(accepted.body.board).toEqual({ ...board, updatedAt: expect.any(Number), role: "editor" });
    expect((await boards.list(editor.id)).map((item) => item.role)).toEqual(["editor"]);
    await request(app).post(`/api/invitations/${invite.id}/accept`).set("Cookie", editor.cookie).set("X-Scribble-Request", "1").expect(404);
    expect((await request(app).get("/api/invitations").set("Cookie", editor.cookie)).body.invitations).toEqual([]);
  });

  it("allows editors to read, rename and save while retaining atomic revision conflicts", async () => {
    const { app, owner, editor, board, grant } = await setup();
    await grant(editor, "editor");
    const url = `/api/boards/${board.id}`;
    expect((await request(app).get(url).set("Cookie", editor.cookie).expect(200)).body.board.role).toBe("editor");
    expect((await request(app).get(`${url}/document`).set("Cookie", editor.cookie).expect(200)).body.document.role).toBe("editor");
    await request(app).patch(url).set("Cookie", editor.cookie).set("X-Scribble-Request", "1").send({ title: "Editor rename" }).expect(200);
    const results = await Promise.all([owner, editor].map((person) => request(app).put(`${url}/document`).set("Cookie", person.cookie).set("X-Scribble-Request", "1").send(documentInput(1, person.email))));
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.status === 409)!.body.error.details.currentRevision).toBe(2);
  });

  it.each(["editor", "viewer"] as const)("forbids %s from deleting or managing sharing on a readable board", async (role) => {
    const { app, owner, editor, board, grant } = await setup();
    await grant(editor, role);
    const url = `/api/boards/${board.id}`;
    const calls = [
      ["delete", url, {}], ["get", `${url}/sharing`, {}],
      ["post", `${url}/invitations`, { email: "someone@example.com", role: "viewer" }],
      ["delete", `${url}/invitations/${randomUUID()}`, {}],
      ["patch", `${url}/members/${owner.id}`, { role: "editor" }],
      ["delete", `${url}/members/${owner.id}`, {}],
    ] as const;
    for (const [method, path, body] of calls) {
      const response = await request(app)[method](path).set("Cookie", editor.cookie).set("X-Scribble-Request", "1").send(body).expect(403);
      expect(response.body.error.code).toBe("BOARD_FORBIDDEN");
    }
  });

  it("blocks viewer writes before revision disclosure and leaves every durable row unchanged", async () => {
    const { app, viewer, board, grant } = await setup(); await grant(viewer, "viewer");
    const before = (await pool.query("SELECT row_to_json(b) AS board, row_to_json(d) AS document FROM boards b JOIN board_documents d ON d.board_id = b.id")).rows;
    const url = `/api/boards/${board.id}`;
    await request(app).get(url).set("Cookie", viewer.cookie).expect(200);
    for (const [method, path, body] of [["patch", url, { title: "Forbidden" }], ["put", `${url}/document`, documentInput(0)]] as const) {
      const result = await request(app)[method](path).set("Cookie", viewer.cookie).set("X-Scribble-Request", "1").send(body).expect(403);
      expect(result.body.error).toEqual({ code: "BOARD_FORBIDDEN", message: "This board is read-only" });
    }
    expect((await pool.query("SELECT row_to_json(b) AS board, row_to_json(d) AS document FROM boards b JOIN board_documents d ON d.board_id = b.id")).rows).toEqual(before);
  });

  it("supports role changes and revocation without changing ownership or removing board content", async () => {
    const { app, owner, editor, board, grant } = await setup(); await grant(editor, "editor");
    const url = `/api/boards/${board.id}`;
    const members = (await request(app).get(`${url}/sharing`).set("Cookie", owner.cookie).expect(200)).body.members;
    expect(members).toEqual([{ userId: editor.id, email: editor.email, displayName: "editor", role: "editor" }]);
    await request(app).patch(`${url}/members/${editor.id}`).set("Cookie", owner.cookie).set("X-Scribble-Request", "1").send({ role: "viewer" }).expect(204);
    expect((await request(app).get(url).set("Cookie", editor.cookie)).body.board.role).toBe("viewer");
    await request(app).put(`${url}/document`).set("Cookie", editor.cookie).set("X-Scribble-Request", "1").send(documentInput(1)).expect(403);
    await request(app).delete(`${url}/members/${editor.id}`).set("Cookie", owner.cookie).set("X-Scribble-Request", "1").expect(204);
    await request(app).get(url).set("Cookie", editor.cookie).expect(404);
    await request(app).put(`${url}/document`).set("Cookie", editor.cookie).set("X-Scribble-Request", "1").send(documentInput(1)).expect(404);
    expect((await request(app).get("/api/boards").set("Cookie", editor.cookie)).body.boards).toEqual([]);
    expect((await pool.query("SELECT owner_id FROM boards WHERE id=$1", [board.id])).rows[0].owner_id).toBe(owner.id);
    expect((await pool.query("SELECT revision FROM board_documents WHERE board_id=$1", [board.id])).rows[0].revision).toBe(1);
  });

  it("never allows changing/removing the owner, invalid roles or self-invitation", async () => {
    const { app, owner, board } = await setup(); const url = `/api/boards/${board.id}`;
    await request(app).post(`${url}/invitations`).set("Cookie", owner.cookie).set("X-Scribble-Request", "1").send({ email: owner.email, role: "viewer" }).expect(400);
    for (const body of [{ email: "viewer@example.com", role: "owner" }, { email: "invalid", role: "viewer" }, { email: "viewer@example.com", role: "viewer", userId: owner.id }]) {
      await request(app).post(`${url}/invitations`).set("Cookie", owner.cookie).set("X-Scribble-Request", "1").send(body).expect(400);
    }
    await request(app).patch(`${url}/members/${owner.id}`).set("Cookie", owner.cookie).set("X-Scribble-Request", "1").send({ role: "viewer" }).expect(400);
    await request(app).delete(`${url}/members/${owner.id}`).set("Cookie", owner.cookie).set("X-Scribble-Request", "1").expect(400);
  });

  it("requires authentication and origin protection on invitation and membership routes", async () => {
    const { app, owner, editor, board, sharing } = await setup();
    const invite = await sharing.invite(board.id, owner.id, { email: editor.email, role: "viewer" });
    await request(app).get("/api/invitations").expect(401);
    await request(app).post(`/api/invitations/${invite.id}/accept`).expect(401);
    await request(app).post(`/api/invitations/${invite.id}/accept`).set("Cookie", editor.cookie).expect(403);
    await request(app).post(`/api/invitations/${invite.id}/accept`).set("Cookie", editor.cookie).set("X-Scribble-Request", "1").set("Origin", "https://hostile.example").expect(403);
    await request(app).delete(`/api/invitations/${invite.id}`).set("Cookie", editor.cookie).expect(403);
    await request(app).post(`/api/boards/${board.id}/invitations`).set("Cookie", owner.cookie).send({ email: editor.email, role: "editor" }).expect(403);
    await request(app).patch(`/api/boards/${board.id}/members/${editor.id}`).set("Cookie", owner.cookie).send({ role: "viewer" }).expect(403);
  });

  it("lets the addressed recipient decline and the owner cancel, with no membership grant", async () => {
    const { sharing, owner, editor, stranger, board } = await setup();
    let invite = await sharing.invite(board.id, owner.id, { email: editor.email, role: "viewer" });
    await expect(sharing.decline(invite.id, stranger.id, stranger.email)).rejects.toMatchObject({ status: 404 });
    await sharing.decline(invite.id, editor.id, editor.email);
    await expect(sharing.accept(invite.id, editor.id, editor.email)).rejects.toMatchObject({ status: 404 });
    invite = await sharing.invite(board.id, owner.id, { email: editor.email, role: "editor" });
    await sharing.cancel(board.id, owner.id, invite.id);
    await expect(sharing.accept(invite.id, editor.id, editor.email)).rejects.toMatchObject({ status: 404 });
    expect((await pool.query("SELECT * FROM board_members")).rows).toEqual([]);
  });

  it("expires invites using the database clock and safely renews a pending invitation", async () => {
    const { sharing, owner, editor, board } = await setup();
    const invite = await sharing.invite(board.id, owner.id, { email: editor.email, role: "viewer" });
    await pool.query("UPDATE board_invitations SET created_at=clock_timestamp()-interval '10 days', expires_at=clock_timestamp()-interval '1 day'");
    expect(await sharing.incoming(editor.id, editor.email)).toEqual([]);
    await expect(sharing.accept(invite.id, editor.id, editor.email)).rejects.toMatchObject({ status: 404 });
    const renewed = await sharing.invite(board.id, owner.id, { email: editor.email, role: "editor" });
    expect(renewed).toMatchObject({ id: invite.id, role: "editor" });
    expect((await sharing.accept(renewed.id, editor.id, editor.email)).role).toBe("editor");
    await expect(sharing.invite(board.id, owner.id, { email: editor.email, role: "viewer" })).rejects.toMatchObject({ status: 409 });
  });

  it("accepts a pending invitation exactly once across concurrent requests", async () => {
    const { sharing, owner, editor, board } = await setup();
    const invite = await sharing.invite(board.id, owner.id, { email: editor.email, role: "editor" });
    const results = await Promise.allSettled([sharing.accept(invite.id, editor.id, editor.email), sharing.accept(invite.id, editor.id, editor.email)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM board_members")).rows[0].count).toBe(1);
  });

  it.each(["viewer", "removed"] as const)("rechecks access after a waiting save observes a %s permission change", async (change) => {
    const { documents, owner, editor, board, grant } = await setup(); await grant(editor, "editor");
    const lock = await pool.connect();
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT id FROM boards WHERE id=$1 FOR UPDATE", [board.id]);
      if (change === "viewer") await lock.query("UPDATE board_members SET role='viewer' WHERE board_id=$1 AND user_id=$2", [board.id, editor.id]);
      else await lock.query("DELETE FROM board_members WHERE board_id=$1 AND user_id=$2", [board.id, editor.id]);
      const pending = documents.save(board.id, documentInput(1, "Forbidden waiting write"), editor.id).catch((error) => error);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await admin.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock') AS waiting", [schema])).rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await lock.query("COMMIT");
      expect(waiting).toBe(true);
      if (change === "viewer") expect(await pending).toMatchObject({ status: 403, code: "BOARD_FORBIDDEN" });
      else expect(await pending).toEqual({ status: "board-not-found" });
      expect((await documents.get(board.id, owner.id)).status).toBe("found");
      expect((await pool.query("SELECT revision FROM board_documents WHERE board_id=$1", [board.id])).rows[0].revision).toBe(1);
    } finally { await lock.query("ROLLBACK"); lock.release(); }
  });

  it("cascades a deleted board's sharing rows without touching another board", async () => {
    const { boards, sharing, owner, editor, viewer, board, grant } = await setup(); await grant(editor, "editor");
    await sharing.invite(board.id, owner.id, { email: viewer.email, role: "viewer" });
    const other = await boards.create("Other board", owner.id);
    const invite = await sharing.invite(other.id, owner.id, { email: viewer.email, role: "editor" });
    await boards.delete(board.id, owner.id);
    expect((await pool.query("SELECT * FROM board_members")).rows).toEqual([]);
    expect((await sharing.get(other.id, owner.id)).invitations).toEqual([invite]);
  });

  it("migrates existing boards/documents without rewriting data and enforces role/email constraints", async () => {
    const { board } = await setup();
    await pool.query("DROP TABLE board_invitations, board_members");
    await pool.query("DELETE FROM schema_migrations WHERE version=5");
    const before = (await pool.query("SELECT row_to_json(b) AS board, row_to_json(d) AS document FROM boards b JOIN board_documents d ON d.board_id=b.id")).rows;
    await migrateDatabase(pool);
    expect((await pool.query("SELECT row_to_json(b) AS board, row_to_json(d) AS document FROM boards b JOIN board_documents d ON d.board_id=b.id")).rows).toEqual(before);
    await expect(pool.query("INSERT INTO board_invitations(id,board_id,email,role) VALUES($1,$2,'UPPER@example.com','viewer')", [randomUUID(), board.id])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("INSERT INTO board_invitations(id,board_id,email,role) VALUES($1,$2,'lower@example.com','owner')", [randomUUID(), board.id])).rejects.toMatchObject({ code: "23514" });
  });
});
