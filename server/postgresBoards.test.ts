import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuthenticatedApp as createApp, seedTestOwner, TEST_OWNER_ID } from "./testFixtures/authenticatedApp.js";
import { migrateDatabase } from "./migrations.js";
import { createPostgresBoardStore } from "./postgresBoards.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("real PostgreSQL board persistence", () => {
  const schema = `scribble_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let pool: pg.Pool;

  beforeAll(async () => {
    // Only this newly created, randomly named schema is modified/removed.
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    await migrateDatabase(pool);
    await seedTestOwner(pool);
  });

  afterAll(async () => {
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });

  it("applies migrations repeatedly without resetting data", async () => {
    const store = createPostgresBoardStore(pool);
    const board = await store.create("Migration survivor", TEST_OWNER_ID);
    await Promise.all([migrateDatabase(pool), migrateDatabase(pool)]);
    expect(await store.get(board.id, TEST_OWNER_ID)).toEqual(board);
    expect((await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
    await store.delete(board.id, TEST_OWNER_ID);
  });

  it("persists create/rename/delete through new pools and application instances", async () => {
    const app = createApp(createPostgresBoardStore(pool));
    const created = await request(app).post("/api/boards").send({ title: "  Persistent  " }).expect(201);
    const board = created.body.board;
    expect(board.title).toBe("Persistent");
    const url = `/api/boards/${board.id}`;
    // Close every application database connection, then recreate it as on restart.
    await pool.end();
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    const restarted = createApp(createPostgresBoardStore(pool));
    expect((await request(restarted).get(url).expect(200)).body).toEqual({ board });
    const title = "Robert'); DROP TABLE boards;--";
    const renamed = await request(restarted).patch(url).send({ title }).expect(200);
    expect(renamed.body.board).toMatchObject({ id: board.id, title, createdAt: board.createdAt });
    expect(renamed.body.board.updatedAt).toBeGreaterThanOrEqual(board.updatedAt);
    expect((await request(restarted).patch(url).send({ title }).expect(200)).body).toEqual(renamed.body);
    await request(restarted).patch(url).send({ title: "   " }).expect(400);
    expect((await request(restarted).get(url).expect(200)).body).toEqual(renamed.body);
    const other = await request(restarted).post("/api/boards").send({ title: "Keep me" }).expect(201);
    await request(restarted).delete(url).expect(204);
    await pool.end();
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    const again = createApp(createPostgresBoardStore(pool));
    await request(again).get(url).expect(404);
    await request(again).delete(url).expect(404);
    expect((await request(again).get("/api/boards").expect(200)).body).toEqual({ boards: [other.body.board] });
    await request(again).delete(`/api/boards/${other.body.board.id}`).expect(204);
  });

  it("enforces database constraints even when HTTP validation is bypassed", async () => {
    await expect(pool.query("INSERT INTO boards (id, title) VALUES ($1, $2)", [randomUUID(), ""])).rejects.toMatchObject({ code: "23514" });
    const id = randomUUID();
    await pool.query("INSERT INTO boards (id, title) VALUES ($1, $2)", [id, "Unique ID"]);
    await expect(pool.query("INSERT INTO boards (id, title) VALUES ($1, $2)", [id, "Duplicate"])).rejects.toMatchObject({ code: "23505" });
    await pool.query("DELETE FROM boards WHERE id = $1", [id]);
  });

  it("handles rejected async database operations through the shared error response", async () => {
    const disconnected = new pg.Pool({ connectionString: databaseUrl });
    await disconnected.end();
    const app = createApp(createPostgresBoardStore(disconnected));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await request(app).get("/api/boards").expect(500);
      expect(result.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred" } });
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });
});
