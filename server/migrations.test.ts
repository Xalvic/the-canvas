import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrations.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const content = {
  objects: [
    { id: "note-2", type: "card", x: -20.5, y: 10, width: 248, height: 172, zIndex: 3, title: "Second", body: "", createdAt: 10, updatedAt: 20 },
    { id: "note-1", type: "card", x: 100, y: 80, width: 248, height: 172, zIndex: 1, title: "First", body: "Sketch", createdAt: 10, updatedAt: 20 },
  ],
};

describe.skipIf(!databaseUrl)("real PostgreSQL document migration", () => {
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let schema: string;
  let pool: pg.Pool;

  beforeEach(async () => {
    schema = `scribble_migration_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
  });

  afterEach(async () => {
    await pool?.end();
    // The name is generated here; application/portable schemas are never reset.
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });

  afterAll(async () => { await admin.end(); });

  async function installVersionOne() {
    const sql = await readFile(new URL("../db/001_create_boards.sql", import.meta.url), "utf8");
    await pool.query(sql);
    await pool.query("CREATE TABLE schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    await pool.query("INSERT INTO schema_migrations (version) VALUES (1)");
  }

  async function createBoard(title = "Migration survivor") {
    const result = await pool.query("INSERT INTO boards (id, title) VALUES ($1, $2) RETURNING *", [randomUUID(), title]);
    return result.rows[0];
  }

  async function insertDocument(boardId: string, value: unknown = content, schemaVersion: unknown = 1, revision: unknown = 1) {
    return pool.query(
      "INSERT INTO board_documents (board_id, schema_version, revision, content) VALUES ($1, $2, $3, $4::jsonb) RETURNING *",
      [boardId, schemaVersion, revision, JSON.stringify(value)],
    );
  }

  async function expectVersions() {
    expect((await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }, { version: 10 }, { version: 11 }]);
  }

  it("installs all versions on a fresh schema even with concurrent runners", async () => {
    await Promise.all([migrateDatabase(pool), migrateDatabase(pool)]);
    await expectVersions();
    const columns = await pool.query(
      "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'board_documents' ORDER BY ordinal_position",
      [schema],
    );
    expect(columns.rows).toEqual([
      { column_name: "board_id", data_type: "uuid", is_nullable: "NO" },
      { column_name: "schema_version", data_type: "integer", is_nullable: "NO" },
      { column_name: "revision", data_type: "integer", is_nullable: "NO" },
      { column_name: "content", data_type: "jsonb", is_nullable: "NO" },
      { column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO" },
    ]);
  });

  it("upgrades version 1 preserving metadata, creates no document rows, and preserves later saves on rerun", async () => {
    await installVersionOne();
    const board = await createBoard();
    await migrateDatabase(pool);
    await expectVersions();
    expect((await pool.query("SELECT * FROM boards WHERE id = $1", [board.id])).rows).toEqual([{ ...board, owner_id: null }]);
    expect((await pool.query("SELECT * FROM board_documents")).rows).toEqual([]);
    const document = (await insertDocument(board.id)).rows[0];
    expect(document.updated_at).toBeInstanceOf(Date);
    await Promise.all([migrateDatabase(pool), migrateDatabase(pool)]);
    await expectVersions();
    expect((await pool.query("SELECT * FROM board_documents WHERE board_id = $1", [board.id])).rows).toEqual([document]);
    expect((await pool.query("SELECT * FROM boards WHERE id = $1", [board.id])).rows).toEqual([{ ...board, owner_id: null }]);
  });

  it.each([false, true])("rolls back a failed version 2 and can retry (version 1 already installed: %s)", async (existingVersionOne) => {
    let board;
    if (existingVersionOne) {
      await installVersionOne();
      board = await createBoard();
    }
    // A conflicting test table deliberately makes CREATE TABLE fail.
    await pool.query("CREATE TABLE board_documents (marker text)");
    await pool.query("INSERT INTO board_documents (marker) VALUES ('keep me')");
    await expect(migrateDatabase(pool)).rejects.toMatchObject({ code: "42P07" });
    const tables = await pool.query("SELECT to_regclass('boards') IS NOT NULL AS boards_present, to_regclass('schema_migrations') IS NOT NULL AS ledger_present");
    expect(tables.rows).toEqual([{ boards_present: existingVersionOne, ledger_present: existingVersionOne }]);
    expect((await pool.query("SELECT marker FROM board_documents")).rows).toEqual([{ marker: "keep me" }]);
    if (existingVersionOne) {
      expect((await pool.query("SELECT version FROM schema_migrations")).rows).toEqual([{ version: 1 }]);
      expect((await pool.query("SELECT * FROM boards")).rows).toEqual([board]);
    }
    await pool.query("DROP TABLE board_documents");
    await migrateDatabase(pool);
    await expectVersions();
    expect((await pool.query("SELECT * FROM board_documents")).rows).toEqual([]);
  });

  it("requires an existing board, permits only one document, and cascades deletion to its own document", async () => {
    await migrateDatabase(pool);
    const board = await createBoard();
    const other = await createBoard("Keep me");
    await expect(insertDocument(randomUUID())).rejects.toMatchObject({ code: "23503" });
    await insertDocument(board.id);
    await insertDocument(other.id, { objects: [] });
    await expect(insertDocument(board.id)).rejects.toMatchObject({ code: "23505" });
    await pool.query("DELETE FROM boards WHERE id = $1", [board.id]);
    expect((await pool.query("SELECT board_id FROM board_documents ORDER BY board_id")).rows).toEqual([{ board_id: other.id }]);
    expect((await pool.query("SELECT * FROM boards")).rows).toEqual([other]);
  });

  it("upgrades version 8 without changing any existing data and rolls back a failed creation-receipt migration", async () => {
    await migrateDatabase(pool);
    // In this disposable schema only, remove the unused additive table/ledger
    // row to reproduce the actual version-eight upgrade boundary.
    await pool.query("DROP TABLE workspace_initialization_receipts, workspace_states, board_creation_receipts; DELETE FROM schema_migrations WHERE version>=9");
    await pool.query("ALTER TABLE board_assets DROP COLUMN upload_request_id, DROP COLUMN upload_content_hash, DROP COLUMN upload_lease_token, DROP COLUMN upload_lease_until, DROP COLUMN upload_attempts");
    const owner = randomUUID(), member = randomUUID(), board = randomUUID(), asset = randomUUID();
    await pool.query("INSERT INTO users(id,google_subject,email) VALUES($1,'migration-owner','owner@example.com'),($2,'migration-member','member@example.com')", [owner, member]);
    await pool.query("INSERT INTO boards(id,title,owner_id) VALUES($1,'Existing owned board',$2)", [board, owner]);
    await createBoard("Existing ownerless board");
    await insertDocument(board, content, 1, 4);
    await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'editor')", [board, member]);
    await pool.query("INSERT INTO board_invitations(id,board_id,email,role) VALUES($1,$2,'invitee@example.com','viewer')", [randomUUID(), board]);
    await pool.query("INSERT INTO auth_sessions(token_hash,user_id) VALUES($1,$2)", ["a".repeat(64), owner]);
    await pool.query("INSERT INTO google_auth_flows(state_hash,browser_hash,nonce,code_verifier) VALUES($1,$2,$3,$4)", ["b".repeat(64), "c".repeat(64), "d".repeat(43), "e".repeat(43)]);
    await pool.query("INSERT INTO board_assets(id,board_id,scope_board_id,uploader_id,status,byte_size,mime_type,width,height,provider_file_id,provider_file_path,last_referenced_at) VALUES($1,$2,$2,$3,'ready',20,'image/png',2,2,'preserved-provider-id','/preserved-image.png',clock_timestamp())", [asset, board, owner]);
    await pool.query("INSERT INTO board_operation_receipts(board_id,actor_id,operation_id,payload_hash,applied_revision) VALUES($1,$2,$3,$4,4)", [board, owner, randomUUID(), "f".repeat(64)]);
    await pool.query("INSERT INTO asset_request_budgets(bucket,request_count,byte_count,expires_at) VALUES('preserved-budget',2,40,clock_timestamp()+interval '1 day')");
    await pool.query("INSERT INTO api_request_budgets(bucket,request_count,expires_at) VALUES($1,2,clock_timestamp()+interval '1 day')", ["1".repeat(64)]);
    const tables = ["users", "boards", "board_documents", "board_members", "board_invitations", "auth_sessions", "google_auth_flows", "board_assets", "board_operation_receipts", "asset_request_budgets", "api_request_budgets"];
    async function snapshot() {
      return Promise.all(tables.map(async (table) => (await pool.query(`SELECT to_jsonb(t) - ARRAY['upload_request_id','upload_content_hash','upload_lease_token','upload_lease_until','upload_attempts'] AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
    }
    const before = await snapshot();
    const ledger = (await pool.query("SELECT * FROM schema_migrations ORDER BY version")).rows;
    await pool.query("CREATE TABLE board_creation_receipts(marker text); INSERT INTO board_creation_receipts VALUES('keep this conflict')");
    await expect(migrateDatabase(pool)).rejects.toMatchObject({ code: "42P07" });
    expect(await snapshot()).toEqual(before);
    expect((await pool.query("SELECT * FROM schema_migrations ORDER BY version")).rows).toEqual(ledger);
    expect((await pool.query("SELECT * FROM board_creation_receipts")).rows).toEqual([{ marker: "keep this conflict" }]);
    await pool.query("DROP TABLE board_creation_receipts");
    await Promise.all([migrateDatabase(pool), migrateDatabase(pool)]);
    await expectVersions();
    expect(await snapshot()).toEqual(before);
    expect((await pool.query("SELECT * FROM board_creation_receipts")).rows).toEqual([]);
    const constraints = await pool.query("INSERT INTO board_creation_receipts(actor_id,request_id,payload_hash,board_id,document_revision) VALUES($1,$2,$3,$4,1) RETURNING *", [owner, randomUUID(), "2".repeat(64), board]);
    expect(constraints.rows[0].expires_at.getTime() - constraints.rows[0].created_at.getTime()).toBeCloseTo(90 * 86_400_000, -1);
    await expect(pool.query("INSERT INTO board_creation_receipts(actor_id,request_id,payload_hash,document_revision) VALUES($1,$2,$3,2)", [owner, randomUUID(), "2".repeat(64)])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("INSERT INTO board_creation_receipts(actor_id,request_id,payload_hash,document_revision) VALUES($1,$2,'bad',1)", [owner, randomUUID()])).rejects.toMatchObject({ code: "23514" });
  });

  it("upgrades version 9 atomically, preserving creation receipts and enforcing workspace identity/deletion constraints", async () => {
    await migrateDatabase(pool);
    await pool.query("DROP TABLE workspace_initialization_receipts, workspace_states; DELETE FROM schema_migrations WHERE version=10");
    const userId = randomUUID(), boardId = randomUUID(), requestId = randomUUID();
    await pool.query("INSERT INTO users(id,google_subject,email) VALUES($1,'workspace-migration-owner','owner@example.com')", [userId]);
    await pool.query("INSERT INTO boards(id,title,owner_id) VALUES($1,'Existing page',$2)", [boardId, userId]);
    await insertDocument(boardId, content, 1, 3);
    await pool.query("INSERT INTO board_creation_receipts(actor_id,request_id,payload_hash,board_id,document_revision) VALUES($1,$2,$3,$4,1)", [userId, requestId, "a".repeat(64), boardId]);
    const tables = ["users", "boards", "board_documents", "board_creation_receipts", "schema_migrations"];
    const snapshot = () => Promise.all(tables.map(async (table) => (await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
    const before = await snapshot();
    await pool.query("CREATE TABLE workspace_initialization_receipts(marker text); INSERT INTO workspace_initialization_receipts VALUES('preserve conflict')");
    await expect(migrateDatabase(pool)).rejects.toMatchObject({ code: "42P07" });
    expect(await snapshot()).toEqual(before);
    expect((await pool.query("SELECT to_regclass('workspace_states') AS state")).rows).toEqual([{ state: null }]);
    expect((await pool.query("SELECT * FROM workspace_initialization_receipts")).rows).toEqual([{ marker: "preserve conflict" }]);
    await pool.query("DROP TABLE workspace_initialization_receipts");
    await Promise.all([migrateDatabase(pool), migrateDatabase(pool)]); await expectVersions();
    const after = await snapshot(); expect(after.slice(0, -1)).toEqual(before.slice(0, -1));
    expect(after.at(-1)?.filter(({ row }) => row.version !== 10)).toEqual(before.at(-1));
    await expect(pool.query("INSERT INTO workspace_states(user_id) VALUES($1)", [randomUUID()])).rejects.toMatchObject({ code: "23503" });
    await expect(pool.query("INSERT INTO workspace_states(user_id,last_opened_board_id) VALUES($1,$2)", [userId, randomUUID()])).rejects.toMatchObject({ code: "23503" });
    await pool.query("INSERT INTO workspace_states(user_id,initialized_at,last_opened_board_id) VALUES($1,clock_timestamp(),$2)", [userId, boardId]);
    await expect(pool.query("INSERT INTO workspace_states(user_id) VALUES($1)", [userId])).rejects.toMatchObject({ code: "23505" });
    await pool.query("INSERT INTO workspace_initialization_receipts(actor_id,request_id,create_initial_page) VALUES($1,$2,false)", [userId, requestId]);
    await expect(pool.query("INSERT INTO workspace_initialization_receipts(actor_id,request_id,create_initial_page) VALUES($1,$2,true)", [userId, requestId])).rejects.toMatchObject({ code: "23505" });
    await pool.query("DELETE FROM boards WHERE id=$1", [boardId]);
    expect((await pool.query("SELECT initialized_at IS NOT NULL AS initialized,last_opened_board_id FROM workspace_states")).rows).toEqual([{ initialized: true, last_opened_board_id: null }]);
    expect((await pool.query("SELECT count(*)::int AS n FROM workspace_initialization_receipts")).rows).toEqual([{ n: 1 }]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
    expect((await pool.query("SELECT count(*)::int AS n FROM workspace_states UNION ALL SELECT count(*)::int FROM workspace_initialization_receipts")).rows).toEqual([{ n: 0 }, { n: 0 }]);
  });

  it("requires explicit positive integer versions/revisions and non-null timestamps", async () => {
    await migrateDatabase(pool);
    const board = await createBoard();
    const invalid = [
      { version: null, revision: 1, code: "23502" },
      { version: 0, revision: 1, code: "23514" },
      { version: -1, revision: 1, code: "23514" },
      { version: 1, revision: null, code: "23502" },
      { version: 1, revision: 0, code: "23514" },
      { version: 1, revision: -1, code: "23514" },
      { version: "1.5", revision: 1, code: "22P02" },
      { version: 1, revision: "1.5", code: "22P02" },
    ];
    for (const value of invalid) {
      await expect(insertDocument(board.id, content, value.version, value.revision)).rejects.toMatchObject({ code: value.code });
    }
    await expect(pool.query("INSERT INTO board_documents (board_id, content) VALUES ($1, $2::jsonb)", [board.id, JSON.stringify(content)])).rejects.toMatchObject({ code: "23502" });
    await expect(pool.query("INSERT INTO board_documents (board_id, schema_version, revision, content, updated_at) VALUES ($1, 1, 1, $2::jsonb, NULL)", [board.id, JSON.stringify(content)])).rejects.toMatchObject({ code: "23502" });
    // SQL permits future positive format versions; the API validator controls support.
    expect((await insertDocument(board.id, { objects: [] }, 2, 3)).rows[0]).toMatchObject({ schema_version: 2, revision: 3 });
  });

  it("rejects missing/null/non-array JSON shapes on insert/update and preserves valid array order", async () => {
    await migrateDatabase(pool);
    const board = await createBoard();
    for (const value of [null, {}, [], "text", 42, true, { objects: null }, { objects: {} }, { objects: "text" }, { objects: 1 }]) {
      await expect(insertDocument(board.id, value)).rejects.toMatchObject({ code: "23514", constraint: "board_documents_content_shape" });
    }
    await expect(pool.query("INSERT INTO board_documents (board_id, schema_version, revision, content) VALUES ($1, 1, 1, NULL)", [board.id])).rejects.toMatchObject({ code: "23502" });
    await insertDocument(board.id, { objects: [] });
    const updated = await pool.query("UPDATE board_documents SET content = $2::jsonb WHERE board_id = $1 RETURNING content", [board.id, JSON.stringify(content)]);
    expect(updated.rows).toEqual([{ content }]);
    await expect(pool.query("UPDATE board_documents SET content = '{}'::jsonb WHERE board_id = $1", [board.id])).rejects.toMatchObject({ code: "23514" });
    expect((await pool.query("SELECT content FROM board_documents WHERE board_id = $1", [board.id])).rows).toEqual([{ content }]);
  });
});
