import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrations.js";
import { createPostgresAuthStore } from "./postgresAuth.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPostgresDocumentStore } from "./postgresDocuments.js";
import { createApp } from "./app.js";
import { FLOW_COOKIE, SESSION_COOKIE, hashToken, randomToken, type GoogleFlow } from "./auth.js";
import { documentInput } from "./testFixtures/document.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const identity = { subject: "google-account", email: "artist@example.com", displayName: "Artist" };
describe.skipIf(!databaseUrl)("real PostgreSQL Google authentication", () => {
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let schema: string, pool: pg.Pool;
  beforeEach(async () => {
    schema = `scribble_auth_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    await migrateDatabase(pool);
  });
  afterEach(async () => { await pool?.end(); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); });
  afterAll(async () => { await admin.end(); });
  function store() { return createPostgresAuthStore(pool); }
  function flow(): GoogleFlow { return { stateHash: hashToken(randomToken()), browserHash: hashToken(randomToken()), nonce: randomToken(), codeVerifier: randomToken() }; }
  function app() {
    return createApp(createPostgresBoardStore(pool), createPostgresDocumentStore(pool), {
      store: store(), secureCookies: false, frontendUrl: "http://127.0.0.1:5173/scribble/",
      provider: { authorizationUrl: (value) => `https://accounts.google.com/auth?${new URLSearchParams(value)}`, verifyCode: async () => identity },
    });
  }

  it("upgrades version 2 with saved content intact and creates no users/sessions automatically", async () => {
    await pool.query("DROP TABLE google_auth_flows, auth_sessions, users");
    await pool.query("DELETE FROM schema_migrations WHERE version = 3");
    const board = await createPostgresBoardStore(pool).create("Keep this board");
    const saved = await createPostgresDocumentStore(pool).save(board.id, documentInput());
    await migrateDatabase(pool); await migrateDatabase(pool);
    expect((await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
    expect(await createPostgresDocumentStore(pool).get(board.id)).toMatchObject({ status: "found", document: saved.status === "saved" ? saved.document : undefined });
    expect((await pool.query("SELECT * FROM users")).rows).toEqual([]);
    expect((await pool.query("SELECT * FROM auth_sessions")).rows).toEqual([]);
  });

  it("rolls migration 3 back when its last table conflicts, preserving earlier tables and ledger", async () => {
    await pool.query("DROP TABLE google_auth_flows, auth_sessions, users"); await pool.query("DELETE FROM schema_migrations WHERE version = 3");
    await pool.query("CREATE TABLE google_auth_flows (marker text)");
    const board = await createPostgresBoardStore(pool).create("Survivor");
    await expect(migrateDatabase(pool)).rejects.toMatchObject({ code: "42P07" });
    expect((await pool.query("SELECT to_regclass('users') AS users, to_regclass('auth_sessions') AS sessions")).rows).toEqual([{ users: null, sessions: null }]);
    expect((await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows).toEqual([{ version: 1 }, { version: 2 }]);
    expect(await createPostgresBoardStore(pool).get(board.id)).toEqual(board);
    await pool.query("DROP TABLE google_auth_flows"); await migrateDatabase(pool);
  });

  it("consumes a browser-bound OAuth flow once, including simultaneous callbacks", async () => {
    const auth = store(), pending = flow(); await auth.createFlow(pending);
    expect(await auth.consumeFlow(pending.stateHash, hashToken(randomToken()))).toBeUndefined();
    const values = await Promise.all([auth.consumeFlow(pending.stateHash, pending.browserHash), auth.consumeFlow(pending.stateHash, pending.browserHash)]);
    expect(values.filter(Boolean)).toEqual([{ nonce: pending.nonce, codeVerifier: pending.codeVerifier }]);
    expect(await auth.consumeFlow(pending.stateHash, pending.browserHash)).toBeUndefined();
  });

  it("rejects expired flows/sessions using the database clock and cleans them on new creation", async () => {
    const auth = store(), pending = flow(); await auth.createFlow(pending);
    await pool.query("UPDATE google_auth_flows SET created_at = clock_timestamp() - interval '20 minutes', expires_at = clock_timestamp() - interval '1 minute'");
    expect(await auth.consumeFlow(pending.stateHash, pending.browserHash)).toBeUndefined();
    await auth.createFlow(flow()); expect((await pool.query("SELECT count(*)::int AS count FROM google_auth_flows")).rows[0].count).toBe(1);
    const token = hashToken(randomToken()); await auth.signIn(identity, token);
    await pool.query("UPDATE auth_sessions SET created_at = clock_timestamp() - interval '2 days', expires_at = clock_timestamp() - interval '1 day'");
    expect(await auth.getSession(token)).toBeUndefined();
    await auth.signIn(identity, hashToken(randomToken())); expect((await pool.query("SELECT count(*)::int AS count FROM auth_sessions")).rows[0].count).toBe(1);
  });

  it("uses Google subject identity, preserves IDs on email change and never merges by email", async () => {
    const auth = store();
    const first = await auth.signIn(identity, hashToken(randomToken()));
    const next = await auth.signIn({ ...identity, email: "renamed@example.com", displayName: null }, hashToken(randomToken()));
    expect(next.user.id).toBe(first.user.id); expect(next.user.email).toBe("renamed@example.com");
    const other = await auth.signIn({ ...identity, subject: "another-google-account", email: "renamed@example.com" }, hashToken(randomToken()));
    expect(other.user.id).not.toBe(first.user.id);
    expect((await pool.query("SELECT count(*)::int AS count FROM users")).rows[0].count).toBe(2);
  });

  it("serializes competing sign-ins for one Google subject into one user with independent sessions", async () => {
    const auth = store();
    const results = await Promise.all([auth.signIn(identity, hashToken(randomToken())), auth.signIn(identity, hashToken(randomToken()))]);
    expect(results[0].user.id).toBe(results[1].user.id);
    expect((await pool.query("SELECT count(*)::int AS count FROM users")).rows[0].count).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM auth_sessions")).rows[0].count).toBe(2);
  });

  it("rolls back user/profile/session revocation if a new session cannot be inserted", async () => {
    const auth = store(), previous = hashToken(randomToken()); await auth.signIn(identity, previous);
    const before = (await pool.query("SELECT * FROM users")).rows;
    await expect(auth.signIn({ ...identity, email: "changed@example.com" }, "invalid-hash", previous)).rejects.toMatchObject({ code: "23514" });
    expect((await pool.query("SELECT * FROM users")).rows).toEqual(before); expect(await auth.getSession(previous)).toBeDefined();
    await expect(auth.signIn({ ...identity, subject: "new-user" }, "invalid-hash")).rejects.toMatchObject({ code: "23514" });
    expect((await pool.query("SELECT * FROM users")).rows).toEqual(before);
  });

  it("rotates/revokes persisted sessions and cascades only a deleted user's sessions", async () => {
    const auth = store(), old = hashToken(randomToken()), current = hashToken(randomToken());
    const first = await auth.signIn(identity, old); await auth.signIn(identity, current, old);
    expect(await auth.getSession(old)).toBeUndefined(); expect(await auth.getSession(current)).toBeDefined();
    const other = hashToken(randomToken()); await auth.signIn({ ...identity, subject: "other" }, other);
    await pool.query("DELETE FROM users WHERE id = $1", [first.user.id]);
    expect(await auth.getSession(current)).toBeUndefined(); expect(await auth.getSession(other)).toBeDefined();
    await auth.revokeSession(other); await auth.revokeSession(other); expect(await auth.getSession(other)).toBeUndefined();
  });

  it("keeps the HTTP session and pending Google flow after replacing connections/application instances", async () => {
    const agent = request.agent(app());
    const start = await agent.get("/api/auth/google").expect(302);
    const state = new URL(start.headers.location).searchParams.get("state")!;
    const browser = (start.headers["set-cookie"] as unknown as string[]).find((value) => value.startsWith(`${FLOW_COOKIE}=`))!.split(";")[0];
    await pool.end(); pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    const callback = await request(app()).get("/api/auth/google/callback").set("Cookie", browser).query({ state, code: "verified-test-code" }).expect(303);
    const cookie = (callback.headers["set-cookie"] as unknown as string[]).find((value) => value.startsWith(`${SESSION_COOKIE}=`))!.split(";")[0];
    const before = (await request(app()).get("/api/auth/me").set("Cookie", cookie).expect(200)).body;
    await pool.end(); pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    expect((await request(app()).get("/api/auth/me").set("Cookie", cookie).expect(200)).body).toEqual(before);
    await request(app()).post("/api/auth/logout").set("Cookie", cookie).set("X-Scribble-Request", "1").expect(204);
    await request(app()).get("/api/auth/me").set("Cookie", cookie).expect(401);
  });
});
