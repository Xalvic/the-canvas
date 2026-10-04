import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthenticatedApp as createApp, seedTestOwner, TEST_OWNER_ID } from "./testFixtures/authenticatedApp.js";
import { migrateDatabase } from "./migrations.js";
import { MAX_DOCUMENT_REVISION } from "./documents.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPostgresDocumentStore } from "./postgresDocuments.js";
import { documentInput } from "./testFixtures/document.js";
import { deserializeCanvasDocument, serializeDocumentSnapshot } from "../src/persistence/canvasDocumentAdapters.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("real PostgreSQL document API", () => {
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let schema: string;
  let pool: pg.Pool;

  beforeEach(async () => {
    schema = `scribble_document_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    await migrateDatabase(pool);
    await seedTestOwner(pool);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  });
  afterAll(async () => { await admin.end(); });

  function app() { return createApp(createPostgresBoardStore(pool), createPostgresDocumentStore(pool)); }
  async function board() { return createPostgresBoardStore(pool).create("Keep the metadata title", TEST_OWNER_ID); }
  async function rows() {
    return {
      boards: (await pool.query("SELECT * FROM boards ORDER BY id")).rows,
      documents: (await pool.query("SELECT * FROM board_documents ORDER BY board_id")).rows,
    };
  }

  it("round trips all non-image fields through HTTP/JSONB/adapters and updates only the metadata timestamp", async () => {
    const api = app();
    const metadata = await board();
    const url = `/api/boards/${metadata.id}/document`;
    const input = documentInput();
    const snapshot = deserializeCanvasDocument({ schemaVersion: input.schemaVersion, content: input.content });
    const first = await request(api).put(url).send(input).expect(201);
    expect(first.body.document).toEqual({ schemaVersion: 1, content: input.content, boardId: metadata.id, revision: 1, updatedAt: expect.any(Number) });
    expect(first.headers.location).toBe(url);
    expect((await request(api).get(url).expect(200)).body).toEqual(first.body);
    // API metadata must be removed explicitly before passing the pure envelope to the adapter.
    const { schemaVersion, content } = first.body.document;
    expect(deserializeCanvasDocument({ schemaVersion, content })).toEqual(snapshot);
    expect(serializeDocumentSnapshot(deserializeCanvasDocument({ schemaVersion, content }))).toEqual({ schemaVersion, content });
    const next = await request(api).put(url).send(documentInput(1, "Updated drawing")).expect(200);
    expect(next.body.document.revision).toBe(2);
    expect((await request(api).get(url).expect(200)).body).toEqual(next.body);
    const after = await createPostgresBoardStore(pool).get(metadata.id, TEST_OWNER_ID);
    expect(after).toEqual({ ...metadata, updatedAt: next.body.document.updatedAt });
    expect(after!.updatedAt).toBeGreaterThanOrEqual(metadata.updatedAt);
    expect((await pool.query("SELECT b.updated_at = d.updated_at AS timestamps_match FROM boards b JOIN board_documents d ON d.board_id = b.id")).rows).toEqual([{ timestamps_match: true }]);
  });

  it("distinguishes a missing board from unsaved content and requires revision zero for the first save", async () => {
    const api = app();
    const metadata = await board();
    const url = `/api/boards/${metadata.id}/document`;
    const missing = `/api/boards/${randomUUID()}/document`;
    expect((await request(api).get(missing).expect(404)).body.error.code).toBe("BOARD_NOT_FOUND");
    expect((await request(api).get(url).expect(404)).body.error.code).toBe("DOCUMENT_NOT_FOUND");
    expect((await request(api).put(missing).send(documentInput()).expect(404)).body.error.code).toBe("BOARD_NOT_FOUND");
    expect((await request(api).put(url).send(documentInput(1)).expect(409)).body.error.details.currentRevision).toBe(0);
    expect((await pool.query("SELECT * FROM board_documents")).rows).toEqual([]);
    expect(await createPostgresBoardStore(pool).get(metadata.id, TEST_OWNER_ID)).toEqual(metadata);
  });

  it("preserves document and metadata on invalid requests, including JSONB-incompatible strings", async () => {
    const api = app();
    const metadata = await board();
    const url = `/api/boards/${metadata.id}/document`;
    await request(api).put(url).send(documentInput()).expect(201);
    const before = await rows();
    const input = documentInput(1);
    const invalid = [
      { ...input, schemaVersion: 2 },
      { ...input, content: { objects: [...input.content.objects, input.content.objects[0]] } },
      { ...input, content: { objects: input.content.objects.slice(0, 1) } },
      { ...input, content: { objects: [{ type: "image", id: "local-image" }] } },
      { ...input, title: "Never rename from a document" },
      documentInput(1, "bad\0title"), documentInput(1, "bad\uD800title"),
    ];
    for (const body of invalid) await request(api).put(url).send(body).expect(400);
    expect(await rows()).toEqual(before);
  });

  it("rejects repeated first saves and stale replacements without changing either row", async () => {
    const api = app();
    const metadata = await board();
    const url = `/api/boards/${metadata.id}/document`;
    await request(api).put(url).send(documentInput()).expect(201);
    const accepted = await request(api).put(url).send(documentInput(1, "Accepted")).expect(200);
    const before = await rows();
    for (const expectedRevision of [0, 1, 3]) {
      const conflict = await request(api).put(url).send(documentInput(expectedRevision, "Rejected")).expect(409);
      expect(conflict.body.error.details.currentRevision).toBe(2);
      expect(await rows()).toEqual(before);
    }
    expect((await request(api).get(url).expect(200)).body).toEqual(accepted.body);
  });

  it("accepts exactly one of two competing first saves", async () => {
    const api = app();
    const metadata = await board();
    const url = `/api/boards/${metadata.id}/document`;
    const results = await Promise.all([request(api).put(url).send(documentInput(0, "A")), request(api).put(url).send(documentInput(0, "B"))]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)!.body.error.details.currentRevision).toBe(1);
    expect((await request(api).get(url).expect(200)).body).toEqual(results.find((result) => result.status === 201)!.body);
    expect((await pool.query("SELECT count(*)::integer AS count FROM board_documents")).rows).toEqual([{ count: 1 }]);
  });

  it("accepts exactly one competing replacement and preserves its content at the new revision", async () => {
    const api = app();
    const metadata = await board();
    const url = `/api/boards/${metadata.id}/document`;
    await request(api).put(url).send(documentInput()).expect(201);
    const results = await Promise.all([request(api).put(url).send(documentInput(1, "A")), request(api).put(url).send(documentInput(1, "B"))]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const accepted = results.find((result) => result.status === 200)!;
    expect(accepted.body.document.revision).toBe(2);
    expect(results.find((result) => result.status === 409)!.body.error.details.currentRevision).toBe(2);
    expect((await request(api).get(url).expect(200)).body).toEqual(accepted.body);
  });

  it.each([false, true])("rolls back document writes when the metadata update fails (replacement: %s)", async (replacement) => {
    const metadata = await board();
    const documents = createPostgresDocumentStore(pool);
    if (replacement) await documents.save(metadata.id, documentInput(), TEST_OWNER_ID);
    const before = await rows();
    // Fault injection is restricted to this newly created test schema.
    await pool.query("CREATE FUNCTION reject_metadata_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test metadata write failure'; END $$");
    await pool.query("CREATE TRIGGER fail_metadata BEFORE UPDATE ON boards FOR EACH ROW EXECUTE FUNCTION reject_metadata_update()");
    await expect(documents.save(metadata.id, documentInput(replacement ? 1 : 0, "Rollback"), TEST_OWNER_ID)).rejects.toMatchObject({ code: "P0001" });
    expect(await rows()).toEqual(before);
    await pool.query("DROP TRIGGER fail_metadata ON boards");
    expect((await documents.save(metadata.id, documentInput(replacement ? 1 : 0), TEST_OWNER_ID)).status).toBe("saved");
  });

  it("loads identical content/revision after every connection and application instance is replaced", async () => {
    const metadata = await board();
    const url = `/api/boards/${metadata.id}/document`;
    const accepted = await request(app()).put(url).send(documentInput()).expect(201);
    await pool.end();
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, connectionTimeoutMillis: 5000 });
    expect((await request(app()).get(url).expect(200)).body).toEqual(accepted.body);
  });

  it("serializes save/delete races without orphaned documents or resurrected boards", async () => {
    const api = app();
    const metadata = await board();
    const url = `/api/boards/${metadata.id}/document`;
    const [deleted, saved] = await Promise.all([request(api).delete(`/api/boards/${metadata.id}`), request(api).put(url).send(documentInput())]);
    expect(deleted.status).toBe(204);
    expect([201, 404]).toContain(saved.status);
    expect((await request(api).get(url).expect(404)).body.error.code).toBe("BOARD_NOT_FOUND");
    expect(await rows()).toEqual({ boards: [], documents: [] });
  });

  it("can refetch a committed snapshot after its response path fails, without writing a duplicate", async () => {
    const metadata = await board();
    const documents = createPostgresDocumentStore(pool);
    const api = createApp(createPostgresBoardStore(pool), {
      get: documents.get,
      async save(id, input, ownerId) {
        await documents.save(id, input, ownerId);
        throw new Error("Simulated response failure after commit");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const url = `/api/boards/${metadata.id}/document`;
    await request(api).put(url).send(documentInput()).expect(500);
    const loaded = await request(api).get(url).expect(200);
    expect(loaded.body.document).toMatchObject({ content: documentInput().content, schemaVersion: 1, revision: 1 });
    const conflict = await request(app()).put(url).send(documentInput()).expect(409);
    expect(conflict.body.error.details.currentRevision).toBe(1);
    expect((await request(app()).get(url).expect(200)).body).toEqual(loaded.body);
  });

  it("rejects unsupported/invalid stored documents instead of returning reduced content", async () => {
    const metadata = await board();
    const url = `/api/boards/${metadata.id}/document`;
    const api = app();
    await request(api).put(url).send(documentInput()).expect(201);
    for (const invalid of [
      { version: 2, content: documentInput().content },
      { version: 1, content: { objects: [{ type: "image", id: "image" }] } },
      { version: 1, content: { objects: documentInput().content.objects.slice(0, 1) } },
    ]) {
      await pool.query("UPDATE board_documents SET schema_version = $2, content = $3::jsonb WHERE board_id = $1", [metadata.id, invalid.version, JSON.stringify(invalid.content)]);
      const before = await rows();
      const result = await request(api).get(url).expect(500);
      expect(result.body.error.code).toBe("INVALID_STORED_DOCUMENT");
      expect(result.body.document).toBeUndefined();
      expect(await rows()).toEqual(before);
    }
  });

  it("keeps timestamps monotonic even when existing metadata/document timestamps are ahead of the clock", async () => {
    const metadata = await board();
    await pool.query("UPDATE boards SET updated_at = '2099-01-01T00:00:00Z' WHERE id = $1", [metadata.id]);
    const api = app();
    const url = `/api/boards/${metadata.id}/document`;
    const first = await request(api).put(url).send(documentInput()).expect(201);
    expect(first.body.document.updatedAt).toBe(Date.parse("2099-01-01T00:00:00Z"));
    await pool.query("UPDATE board_documents SET updated_at = '2100-01-01T00:00:00Z' WHERE board_id = $1", [metadata.id]);
    const next = await request(api).put(url).send(documentInput(1)).expect(200);
    expect(next.body.document.updatedAt).toBe(Date.parse("2100-01-01T00:00:00Z"));
    expect((await createPostgresBoardStore(pool).get(metadata.id, TEST_OWNER_ID))!.updatedAt).toBe(next.body.document.updatedAt);
  });

  it("handles the last representable revision increment and rejects a save that would overflow", async () => {
    const metadata = await board();
    const api = app();
    const url = `/api/boards/${metadata.id}/document`;
    await request(api).put(url).send(documentInput()).expect(201);
    await pool.query("UPDATE board_documents SET revision = $2 WHERE board_id = $1", [metadata.id, MAX_DOCUMENT_REVISION - 1]);
    const accepted = await request(api).put(url).send(documentInput(MAX_DOCUMENT_REVISION - 1)).expect(200);
    expect(accepted.body.document.revision).toBe(MAX_DOCUMENT_REVISION);
    const before = await rows();
    await request(api).put(url).send(documentInput(MAX_DOCUMENT_REVISION)).expect(400);
    expect(await rows()).toEqual(before);
  });
});
