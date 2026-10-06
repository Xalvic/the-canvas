import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuthenticatedApp as createApp, seedTestOwner, TEST_OWNER_ID } from "./testFixtures/authenticatedApp.js";
import { migrateDatabase } from "./migrations.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPrismaClient } from "./prisma.js";
import type { PrismaClient } from "./generated/prisma/client.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("real PostgreSQL board persistence", () => {
  const schema = `scribble_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let pool: pg.Pool;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Only this newly created, randomly named schema is modified/removed.
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    await migrateDatabase(pool);
    await seedTestOwner(pool);
    prisma = createPrismaClient(pool, schema);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });

  it("applies migrations repeatedly without resetting data", async () => {
    const store = createPostgresBoardStore(prisma);
    const board = await store.create("Migration survivor", TEST_OWNER_ID);
    await Promise.all([migrateDatabase(pool), migrateDatabase(pool)]);
    expect(await store.get(board.id, TEST_OWNER_ID)).toEqual(board);
    expect((await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }]);
    await store.delete(board.id, TEST_OWNER_ID);
  });

  it("persists create/rename/delete through new pools and application instances", async () => {
    const app = createApp(createPostgresBoardStore(prisma));
    const created = await request(app).post("/api/boards").send({ title: "  Persistent  " }).expect(201);
    const board = created.body.board;
    expect(board.title).toBe("Persistent");
    const url = `/api/boards/${board.id}`;
    // Close every application database connection, then recreate it as on restart.
    await prisma.$disconnect();
    await pool.end();
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    prisma = createPrismaClient(pool, schema);
    const restarted = createApp(createPostgresBoardStore(prisma));
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
    await prisma.$disconnect();
    await pool.end();
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    prisma = createPrismaClient(pool, schema);
    const again = createApp(createPostgresBoardStore(prisma));
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

  it("enforces existing SQL constraints on Prisma creates and leaves the schema/migration ledger intact", async () => {
    const before = (await pool.query("SELECT version, applied_at FROM schema_migrations ORDER BY version")).rows;
    const store = createPostgresBoardStore(prisma);
    for (const title of ["", " untrimmed ", "x".repeat(121)]) {
      await expect(store.create(title, TEST_OWNER_ID)).rejects.toMatchObject({ code: "P2039" });
    }
    expect((await pool.query("SELECT version, applied_at FROM schema_migrations ORDER BY version")).rows).toEqual(before);
    expect((await pool.query("SELECT to_regclass('_prisma_migrations') AS prisma_ledger")).rows).toEqual([{ prisma_ledger: null }]);
  });

  it("adopts an existing SQL row and preserves sub-millisecond timestamps on no-op or future-dated renames", async () => {
    const id = randomUUID();
    await pool.query("INSERT INTO boards (id, title, owner_id, updated_at) VALUES ($1, 'SQL survivor', $2, '2099-01-01T00:00:00.123456Z')", [id, TEST_OWNER_ID]);
    const store = createPostgresBoardStore(prisma);
    const board = await store.get(id, TEST_OWNER_ID);
    expect(board).toMatchObject({ id, title: "SQL survivor", updatedAt: Date.parse("2099-01-01T00:00:00.123456Z") });
    expect(await store.get(id, randomUUID())).toBeUndefined();
    expect(await store.rename(id, "SQL survivor", TEST_OWNER_ID)).toEqual(board);
    expect(await store.rename(id, "Renamed through Prisma", TEST_OWNER_ID)).toEqual({ ...board, title: "Renamed through Prisma" });
    expect((await pool.query("SELECT updated_at = '2099-01-01T00:00:00.123456Z'::timestamptz AS exact_match FROM boards WHERE id = $1", [id])).rows).toEqual([{ exact_match: true }]);
    await store.delete(id, TEST_OWNER_ID);
  });

  it("handles rejected async database operations through the shared error response", async () => {
    const disconnected = new pg.Pool({ connectionString: databaseUrl });
    await disconnected.end();
    const disconnectedPrisma = createPrismaClient(disconnected, schema);
    const app = createApp(createPostgresBoardStore(disconnectedPrisma));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await request(app).get("/api/boards").expect(500);
      expect(result.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred" } });
      expect(log).toHaveBeenCalledOnce();
    } finally {
      await disconnectedPrisma.$disconnect();
      log.mockRestore();
    }
  });
});
