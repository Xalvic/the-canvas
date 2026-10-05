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
    expect((await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }]);
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
