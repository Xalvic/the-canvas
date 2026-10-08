import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "./prisma.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { migrateDatabase } from "./migrations.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPostgresDocumentStore } from "./postgresDocuments.js";
import { createPostgresCollaborationStore } from "./postgresCollaboration.js";
import { createPostgresAssetStore } from "./postgresAssets.js";
import { collaborationOperationSchema, type CollaborationOperation, type StoredCanvasObject } from "./contracts/collaboration.js";
import { documentInput } from "./testFixtures/document.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("real PostgreSQL collaboration", () => {
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let schema: string, pool: pg.Pool, prisma: PrismaClient;
  beforeEach(async () => {
    schema = `scribble_collaboration_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema, max: 5 });
    await migrateDatabase(pool);
    prisma = createPrismaClient(pool, schema);
  });
  afterEach(async () => { await prisma?.$disconnect(); await pool?.end(); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); });
  afterAll(async () => { await admin.end(); });
  async function setup(saved = true) {
    const owner = randomUUID(), editor = randomUUID(), viewer = randomUUID(), stranger = randomUUID();
    for (const id of [owner, editor, viewer, stranger]) await pool.query("INSERT INTO users(id,google_subject,email) VALUES($1,$1::uuid::text,$2)", [id, `${id}@example.com`]);
    const boards = createPostgresBoardStore(prisma), documents = createPostgresDocumentStore(prisma), collaboration = createPostgresCollaborationStore(prisma);
    const board = await boards.create("Collaboration", owner);
    await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'editor'),($1,$3,'viewer')", [board.id, editor, viewer]);
    if (saved) await documents.save(board.id, documentInput(), owner);
    return { owner, editor, viewer, stranger, boards, documents, collaboration, board };
  }
  function change(id = "note", title = "Updated"): CollaborationOperation {
    const before = documentInput().content.objects.find((object) => object.id === id)!;
    return collaborationOperationSchema.parse({ operationId: randomUUID(), baseRevision: 1, changes: [{ id, before, after: { ...before, ...(before.type === "card" ? { title } : { x: 999 }) } }] });
  }
  async function state() {
    return { boards: (await pool.query("SELECT * FROM boards ORDER BY id")).rows,
      documents: (await pool.query("SELECT * FROM board_documents ORDER BY board_id")).rows,
      receipts: (await pool.query("SELECT * FROM board_operation_receipts ORDER BY board_id,actor_id,operation_id")).rows,
      assets: (await pool.query("SELECT * FROM board_assets ORDER BY id")).rows };
  }

  it("merges disjoint concurrent actions from the same starting revision", async () => {
    const { collaboration, documents, board, owner, editor } = await setup();
    const results = await Promise.all([collaboration.apply(board.id, change(), owner), collaboration.apply(board.id, change("frame"), editor)]);
    expect(results.map((result) => result!.document.revision).sort()).toEqual([2, 3]);
    const final = await documents.get(board.id, owner);
    expect(final).toMatchObject({ status: "found", document: { revision: 3 } });
    if (final.status !== "found") throw new Error("Missing document");
    expect(final.document.content.objects.find((object) => object.id === "note")).toMatchObject({ title: "Updated" });
    expect(final.document.content.objects.find((object) => object.id === "frame")).toMatchObject({ x: 999 });
    expect(await prisma.boardOperationReceipt.count()).toBe(2);
  });

  it("rejects one competing same-object edit and the entire multi-object action", async () => {
    const { collaboration, board, owner, editor } = await setup();
    const results = await Promise.allSettled([collaboration.apply(board.id, change("note", "A"), owner), collaboration.apply(board.id, change("note", "B"), editor)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { status: 409, code: "COLLABORATION_CONFLICT", details: { currentRevision: 2, conflictingObjectIds: ["note"] } } });
    const before = await state();
    const action = change(); action.changes.push(...change("frame").changes);
    await expect(collaboration.apply(board.id, action, owner)).rejects.toMatchObject({ code: "COLLABORATION_CONFLICT" });
    expect(await state()).toEqual(before);
  });

  it("replays receipts after other edits and an ABA without rewriting any rows", async () => {
    const { collaboration, documents, board, owner, editor } = await setup();
    const operation = change();
    await collaboration.apply(board.id, operation, owner);
    // Another editor restores the same content at a later revision.
    await documents.save(board.id, documentInput(2), editor);
    const before = await state();
    const replay = await createPostgresCollaborationStore(prisma).apply(board.id, operation, owner);
    expect(replay).toMatchObject({ replayed: true, document: { revision: 3 } });
    expect(replay!.document.content.objects.find((object) => object.id === "note")).toMatchObject({ title: "Ideas" });
    expect(await state()).toEqual(before);
    await expect(collaboration.apply(board.id, { ...operation, baseRevision: 3 }, owner)).rejects.toMatchObject({ code: "OPERATION_ID_REUSED", status: 409 });
    expect(await state()).toEqual(before);
  });

  it("deduplicates concurrent retries and scopes operation IDs by actor and board", async () => {
    const { collaboration, board, owner, editor, boards } = await setup();
    const operation = change();
    const results = await Promise.all([collaboration.apply(board.id, operation, owner), collaboration.apply(board.id, operation, owner)]);
    expect(results.map((result) => result!.replayed).sort()).toEqual([false, true]);
    expect(results.every((result) => result!.document.revision === 2)).toBe(true);
    await collaboration.apply(board.id, { ...change("frame"), operationId: operation.operationId }, editor);
    const other = await boards.create("Other", owner);
    await createPostgresDocumentStore(prisma).save(other.id, documentInput(), owner);
    await collaboration.apply(other.id, operation, owner);
    expect(await prisma.boardOperationReceipt.count()).toBe(3);
  });

  it("authorizes viewers/strangers before revealing revisions or replay receipts", async () => {
    const { collaboration, board, owner, viewer, stranger } = await setup();
    const operation = change(); await collaboration.apply(board.id, operation, owner);
    const before = await state();
    await expect(collaboration.apply(board.id, operation, viewer)).rejects.toMatchObject({ status: 403, code: "BOARD_FORBIDDEN" });
    expect(await collaboration.apply(board.id, operation, stranger)).toBeUndefined();
    expect(await collaboration.state(board.id, viewer)).toEqual({ revision: 2, role: "viewer" });
    expect(await collaboration.state(board.id, stranger)).toBeUndefined();
    expect(await state()).toEqual(before);
  });

  it.each(["viewer", "removed"] as const)("rechecks a waiting operation after permission becomes %s", async (role) => {
    const { collaboration, board, editor } = await setup();
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN"); await blocker.query("SELECT id FROM boards WHERE id=$1 FOR UPDATE", [board.id]);
      if (role === "viewer") await blocker.query("UPDATE board_members SET role='viewer' WHERE board_id=$1 AND user_id=$2", [board.id, editor]);
      else await blocker.query("DELETE FROM board_members WHERE board_id=$1 AND user_id=$2", [board.id, editor]);
      const pending = collaboration.apply(board.id, change(), editor).catch((error: unknown) => error);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await admin.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock') AS waiting", [schema])).rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await blocker.query("COMMIT"); expect(waiting).toBe(true);
      if (role === "viewer") expect(await pending).toMatchObject({ status: 403, code: "BOARD_FORBIDDEN" });
      else expect(await pending).toBeUndefined();
      expect(await prisma.boardOperationReceipt.count()).toBe(0);
      expect((await prisma.boardDocument.findUniqueOrThrow({ where: { boardId: board.id } })).revision).toBe(1);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  });

  it("rejects future revisions, invalid assembled connector references, and object-order changes", async () => {
    const { collaboration, board, owner } = await setup();
    const before = await state();
    await expect(collaboration.apply(board.id, { ...change(), baseRevision: 99 }, owner)).rejects.toMatchObject({ code: "COLLABORATION_CONFLICT", details: { currentRevision: 1 } });
    const remove = change(); remove.changes[0].after = null;
    await expect(collaboration.apply(board.id, remove, owner)).rejects.toThrow("connector endpoint");
    const numeric: StoredCanvasObject = { ...documentInput().content.objects.find((object) => object.id === "note")!, id: "1" };
    await expect(collaboration.apply(board.id, { operationId: randomUUID(), baseRevision: 1, changes: [{ id: "1", before: null, after: numeric }] }, owner)).rejects.toThrow("Object ID order");
    expect(await state()).toEqual(before);
  });

  it("creates revision-one content and preserves established snapshot PUT conflicts", async () => {
    const { collaboration, documents, board, owner } = await setup(false);
    const operation = change(); operation.baseRevision = 0; operation.changes[0].before = null;
    expect(await collaboration.apply(board.id, operation, owner)).toMatchObject({ document: { revision: 1 }, replayed: false });
    expect(await documents.save(board.id, documentInput(), owner)).toEqual({ status: "conflict", currentRevision: 1 });
    expect(await documents.save(board.id, documentInput(1), owner)).toMatchObject({ status: "saved", document: { revision: 2 } });
  });

  it("rejects incomplete/cross-board images and protects valid assets only after an atomic commit", async () => {
    const { collaboration, board, owner, boards } = await setup();
    const assets = createPostgresAssetStore(prisma), other = await boards.create("Other", owner);
    const reserve = async (boardId: string) => {
      const id = randomUUID(); return assets.reserve(boardId, owner, { id, byteSize: 20, mimeType: "image/png", width: 2, height: 2, filePath: `/scribble/dev/${id}.png` });
    };
    const pending = await reserve(board.id), foreign = await reserve(other.id), valid = await reserve(board.id);
    const finalize = (asset: typeof valid) => assets.finalize(asset.id, owner, { fileId: `file-${asset.id}`, filePath: asset.filePath, size: 20 });
    await finalize(foreign); await finalize(valid);
    const image = (assetId: string): StoredCanvasObject => ({ id: "image", type: "image", assetId, x: 0, y: 0, width: 2, height: 2, originalWidth: 2, originalHeight: 2, zIndex: 9, createdAt: 1, updatedAt: 1 });
    const operation = (assetId: string): CollaborationOperation => ({ operationId: randomUUID(), baseRevision: 1, changes: [{ id: "image", before: null, after: image(assetId) }] });
    const before = await state();
    for (const id of [pending.id, foreign.id, randomUUID()]) await expect(collaboration.apply(board.id, operation(id), owner)).rejects.toMatchObject({ status: 422, code: "INVALID_ASSET_REFERENCE" });
    expect(await state()).toEqual(before);
    await collaboration.apply(board.id, operation(valid.id), owner);
    expect((await prisma.boardAsset.findUniqueOrThrow({ where: { id: valid.id } })).lastReferencedAt).not.toBeNull();
  });

  it("rolls back document, asset retention, metadata and receipt if the final insert fails", async () => {
    const { collaboration, board, owner } = await setup();
    const assets = createPostgresAssetStore(prisma), id = randomUUID();
    const pending = await assets.reserve(board.id, owner, { id, byteSize: 20, mimeType: "image/png", width: 2, height: 2, filePath: `/scribble/dev/${id}.png` });
    await assets.finalize(id, owner, { fileId: `file-${id}`, filePath: pending.filePath, size: 20 });
    const before = await state();
    await pool.query("CREATE FUNCTION reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt failure'; END $$");
    await pool.query("CREATE TRIGGER fail_receipt BEFORE INSERT ON board_operation_receipts FOR EACH ROW EXECUTE FUNCTION reject_receipt()");
    const after: StoredCanvasObject = { id: "image", type: "image", assetId: id, x: 0, y: 0, width: 2, height: 2, originalWidth: 2, originalHeight: 2, zIndex: 9, createdAt: 1, updatedAt: 1 };
    await expect(collaboration.apply(board.id, { operationId: randomUUID(), baseRevision: 1, changes: [{ id: "image", before: null, after }] }, owner)).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it("persists receipts across connection replacement and cascades only the deleted board", async () => {
    const { collaboration, board, owner, boards } = await setup();
    const operation = change(); await collaboration.apply(board.id, operation, owner);
    const other = await boards.create("Other", owner);
    await createPostgresDocumentStore(prisma).save(other.id, documentInput(), owner);
    await collaboration.apply(other.id, change(), owner);
    await prisma.$disconnect(); await pool.end();
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` }); prisma = createPrismaClient(pool, schema);
    expect(await createPostgresCollaborationStore(prisma).apply(board.id, operation, owner)).toMatchObject({ replayed: true, document: { revision: 2 } });
    await createPostgresBoardStore(prisma).delete(board.id, owner);
    expect((await prisma.boardOperationReceipt.findMany()).map((receipt) => receipt.boardId)).toEqual([other.id]);
  });

  it("enforces the persistent hourly budget without preventing authorized receipt replay", async () => {
    const { collaboration, board, owner } = await setup();
    const accepted = change(); await collaboration.apply(board.id, accepted, owner);
    await pool.query("INSERT INTO board_operation_receipts(board_id,actor_id,operation_id,payload_hash,applied_revision) SELECT $1,$2,gen_random_uuid(),repeat('a',64),1 FROM generate_series(1,3599)", [board.id, owner]);
    const before = await state();
    await expect(collaboration.apply(board.id, change("frame"), owner)).rejects.toMatchObject({ status: 429, code: "COLLABORATION_RATE_LIMIT" });
    expect(await collaboration.apply(board.id, accepted, owner)).toMatchObject({ replayed: true, document: { revision: 2 } });
    expect(await state()).toEqual(before);
  });

  it("migrates receipts without changing boards/documents and rolls a failed migration back", async () => {
    const { board, owner } = await setup();
    const original = await state();
    await pool.query("DROP TABLE board_operation_receipts; DELETE FROM schema_migrations WHERE version=7; CREATE TABLE board_operation_receipts(marker text)");
    await expect(migrateDatabase(pool)).rejects.toMatchObject({ code: "42P07" });
    expect((await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map(({ version }) => version)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
    await pool.query("DROP TABLE board_operation_receipts"); await migrateDatabase(pool); await migrateDatabase(pool);
    expect(await state()).toEqual(original);
    const sql = "INSERT INTO board_operation_receipts(board_id,actor_id,operation_id,payload_hash,applied_revision) VALUES($1,$2,$3,$4,$5)";
    await expect(pool.query(sql, [board.id, owner, randomUUID(), "bad", 1])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(sql, [board.id, owner, randomUUID(), "a".repeat(64), 0])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(sql, [randomUUID(), owner, randomUUID(), "a".repeat(64), 1])).rejects.toMatchObject({ code: "23503" });
  });
});
