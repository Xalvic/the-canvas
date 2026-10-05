import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { migrateDatabase } from "./migrations.js";
import { createPostgresRequestBudgets } from "./productionBudgets.js";
import { createApp } from "./app.js";
import { createPostgresAuthStore } from "./postgresAuth.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPrismaClient } from "./prisma.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { hashToken, randomToken, SESSION_COOKIE } from "./auth.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("real PostgreSQL production admission budgets", () => {
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let schema: string, pool: pg.Pool, prisma: PrismaClient | undefined;
  const secret = "test-private-secret";
  beforeEach(async () => {
    schema = `scribble_production_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 10 });
    await migrateDatabase(pool);
  });
  afterEach(async () => { await prisma?.$disconnect(); prisma = undefined; await pool?.end(); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); });
  afterAll(async () => { await admin.end(); });
  it("atomically limits concurrent workers and persists denial across store/process recreation", async () => {
    const left = createPostgresRequestBudgets(pool, secret), right = createPostgresRequestBudgets(pool, secret);
    const attempts = await Promise.all(Array.from({ length: 30 }, (_, index) => (index % 2 ? left : right).consume("auth-start", "203.0.113.10", 20, 600)));
    expect(attempts.filter((result) => result.allowed)).toHaveLength(20);
    expect(attempts.filter((result) => !result.allowed)).toHaveLength(10);
    const anotherPool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    try { expect(await createPostgresRequestBudgets(anotherPool, secret).consume("auth-start", "203.0.113.10", 20, 600)).toMatchObject({ allowed: false }); }
    finally { await anotherPool.end(); }
    const rows = (await pool.query("SELECT * FROM api_request_budgets")).rows;
    expect(rows[0].request_count).toBe(20);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.10");
    expect(JSON.stringify(rows)).not.toContain("auth-start");
  });
  it("isolates scopes/users and admits a fresh window after DB-clock expiry without extending denied windows", async () => {
    const store = createPostgresRequestBudgets(pool, secret);
    await store.consume("user-read", "alice", 1, 60);
    const before = (await pool.query("SELECT expires_at FROM api_request_budgets")).rows[0].expires_at;
    expect(await store.consume("user-read", "alice", 1, 60)).toMatchObject({ allowed: false });
    expect((await pool.query("SELECT expires_at FROM api_request_budgets")).rows[0].expires_at).toEqual(before);
    expect(await store.consume("user-write", "alice", 1, 60)).toMatchObject({ allowed: true });
    expect(await store.consume("user-read", "bob", 1, 60)).toMatchObject({ allowed: true });
    await pool.query("UPDATE api_request_budgets SET expires_at=clock_timestamp()-interval '1 second'");
    expect(await store.consume("user-read", "alice", 1, 60)).toMatchObject({ allowed: true });
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM api_request_budgets")).rows[0].count).toBe(1);
  });
  it("bounds global cardinality under concurrent new identities, retaining active budgets and pruning expired rows only", async () => {
    const store = createPostgresRequestBudgets(pool, secret, 3);
    const attempts = await Promise.all(Array.from({ length: 10 }, (_, index) => store.consume("ip", String(index), 20, 60)));
    expect(attempts.filter((value) => value.allowed)).toHaveLength(3);
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM api_request_budgets")).rows[0].count).toBe(3);
    const bucket = createHmac("sha256", secret).update(JSON.stringify(["ip", "0"])).digest("hex");
    await pool.query("UPDATE api_request_budgets SET expires_at=clock_timestamp()-interval '1 second' WHERE bucket=$1", [bucket]);
    expect(await store.consume("ip", "replacement", 20, 60)).toMatchObject({ allowed: true });
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM api_request_budgets")).rows[0].count).toBe(3);
  });
  it("enforces SQL hash/count constraints and validates admission policy", async () => {
    await expect(pool.query("INSERT INTO api_request_budgets VALUES('raw IP',1,clock_timestamp())")).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("INSERT INTO api_request_budgets VALUES($1,-1,clock_timestamp())", ["a".repeat(64)])).rejects.toMatchObject({ code: "23514" });
    await expect(createPostgresRequestBudgets(pool, secret).consume("ip", "identity", 0, 60)).rejects.toThrow("Invalid request budget policy");
  });
  it("enforces Google HTTP admission across recreated application instances before creating extra OAuth flows", async () => {
    prisma = createPrismaClient(pool, schema);
    const store = createPostgresAuthStore(prisma);
    function app() {
      return createApp(createPostgresBoardStore(prisma!), undefined, {
        frontendUrl: "https://scribble.example/scribble/", secureCookies: true, store,
        provider: { authorizationUrl: () => "https://accounts.google.com/o/oauth2/v2/auth", verifyCode: async () => ({ subject: "test", email: "owner@example.com", displayName: "Owner" }) },
      }, undefined, undefined, undefined, { proxySecret: secret, budgets: createPostgresRequestBudgets(pool, secret), ready: async () => { await pool.query("SELECT 1"); }, log: () => {} });
    }
    const first = app(), recreated = app();
    for (let index = 0; index < 20; index++) await request(index % 2 ? first : recreated).get("/api/auth/google")
      .set("X-Scribble-Proxy-Secret", secret).set("X-Scribble-Client-IP", "203.0.113.10").expect(302);
    await request(app()).get("/api/auth/google").set("X-Scribble-Proxy-Secret", secret).set("X-Scribble-Client-IP", "203.0.113.10").expect(429);
    expect(await prisma.googleAuthFlow.count()).toBe(20);
    await request(app()).get("/api/auth/google").set("X-Scribble-Proxy-Secret", secret).set("X-Scribble-Client-IP", "203.0.113.11").expect(302);
    expect(await prisma.googleAuthFlow.count()).toBe(21);
    const token = randomToken();
    const session = await store.signIn({ subject: "test-owner", email: "owner@example.com", displayName: "Owner" }, hashToken(token));
    const bucket = createHmac("sha256", secret).update(JSON.stringify(["user-read", session.user.id])).digest("hex");
    await pool.query("INSERT INTO api_request_budgets VALUES($1,1200,clock_timestamp()+interval '60 seconds')", [bucket]);
    await request(app()).get("/api/auth/me").set("Cookie", `${SESSION_COOKIE}=${token}`).set("X-Scribble-Proxy-Secret", secret).set("X-Scribble-Client-IP", "203.0.113.11").expect(429);
    expect(await store.getSession(hashToken(token))).toBeDefined();
  });
});
