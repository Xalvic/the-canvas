import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "./prisma.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { migrateDatabase } from "./migrations.js";
import { createPostgresAssetStore } from "./postgresAssets.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPostgresDocumentStore } from "./postgresDocuments.js";
import type { AssetReservationInput } from "./assets.js";
import type { SaveDocumentInput } from "./documents.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("real PostgreSQL cloud image assets", () => {
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let schema: string, pool: pg.Pool, prisma: PrismaClient;
  beforeEach(async () => {
    schema = `scribble_asset_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema, max: 5 });
    await migrateDatabase(pool);
    prisma = createPrismaClient(pool, schema);
  });
  afterEach(async () => { await prisma?.$disconnect(); await pool?.end(); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); });
  afterAll(async () => { await admin.end(); });

  function input(byteSize = 20): AssetReservationInput {
    const id = randomUUID();
    return { id, byteSize, mimeType: "image/png", width: 2, height: 2, filePath: `/scribble/dev/${id}.png` };
  }
  async function setup() {
    const owner = randomUUID(), editor = randomUUID(), viewer = randomUUID(), stranger = randomUUID();
    for (const user of [owner, editor, viewer, stranger]) await pool.query("INSERT INTO users(id,google_subject,email) VALUES($1::uuid,$1::uuid::text,$2)", [user, `${user}@example.com`]);
    const boards = createPostgresBoardStore(prisma), assets = createPostgresAssetStore(prisma), documents = createPostgresDocumentStore(prisma);
    const board = await boards.create("Cloud images", owner), other = await boards.create("Other board", owner);
    await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'editor'),($1,$3,'viewer')", [board.id, editor, viewer]);
    async function ready(boardId = board.id, user = owner, byteSize = 20) {
      const pending = await assets.reserve(boardId, user, input(byteSize));
      return assets.finalize(pending.id, user, { fileId: `provider-${pending.id}`, filePath: pending.filePath, size: pending.byteSize });
    }
    return { owner, editor, viewer, stranger, boards, assets, documents, board, other, ready };
  }
  function document(assetId?: string, expectedRevision = 0): SaveDocumentInput {
    return { schemaVersion: 1, expectedRevision, content: { objects: assetId ? [{
      id: "image-1", type: "image", assetId, x: 0, y: 0, width: 2, height: 2, originalWidth: 2, originalHeight: 2,
      zIndex: 1, createdAt: 1, updatedAt: 1,
    }] : [] } };
  }
  async function state() {
    return { boards: (await pool.query("SELECT * FROM boards ORDER BY id")).rows,
      documents: (await pool.query("SELECT * FROM board_documents ORDER BY board_id")).rows,
      assets: (await pool.query("SELECT * FROM board_assets ORDER BY id")).rows };
  }
  async function seedAttempts(boardId: string | null, scopeBoardId: string, uploaderId: string, count: number, size: number, age: string) {
    await pool.query(`INSERT INTO board_assets(id,board_id,scope_board_id,uploader_id,byte_size,mime_type,width,height,provider_file_path,created_at)
      SELECT gen_random_uuid(),$1,$2,$3,$4,'image/png',2,2,'/scribble/dev/seed-'||gen_random_uuid(),clock_timestamp()-$6::interval
      FROM generate_series(1,$5::int)`, [boardId, scopeBoardId, uploaderId, size, count, age]);
  }
  async function budget(kind: "read" | "bandwidth", userId: string, requests: number, bytes: number) {
    await pool.query(`INSERT INTO asset_request_budgets(bucket,request_count,byte_count,expires_at)
      VALUES(CASE WHEN $1='read' THEN 'read:'||$2||':'||to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD-HH24')
        ELSE 'bandwidth:'||to_char(now() AT TIME ZONE 'UTC','YYYY-MM') END,$3,$4,now()+interval '1 month')`, [kind, userId, requests, bytes]);
  }

  it("migrates existing boards/documents unchanged and retries a failed asset migration atomically", async () => {
    const { owner, board, documents } = await setup();
    await documents.save(board.id, document(), owner);
    const before = await state();
    await pool.query("DROP TABLE board_assets, asset_request_budgets; DELETE FROM schema_migrations WHERE version IN (6,11); CREATE TABLE asset_request_budgets(marker text)");
    await expect(migrateDatabase(pool)).rejects.toMatchObject({ code: "42P07" });
    expect((await pool.query("SELECT to_regclass('board_assets') AS assets")).rows[0].assets).toBeNull();
    expect((await pool.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map(({ version }) => version)).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 12]);
    await pool.query("DROP TABLE asset_request_budgets"); await migrateDatabase(pool); await migrateDatabase(pool);
    expect(await state()).toEqual(before);
  });

  it("requires owner/editor upload access and keeps viewer/stranger attempts from reserving storage", async () => {
    const { owner, editor, viewer, stranger, assets, board } = await setup();
    await assets.assertCanUpload(board.id, owner); await assets.assertCanUpload(board.id, editor);
    await expect(assets.assertCanUpload(board.id, viewer)).rejects.toMatchObject({ status: 403, code: "BOARD_FORBIDDEN" });
    await expect(assets.reserve(board.id, viewer, input())).rejects.toMatchObject({ status: 403 });
    await expect(assets.reserve(board.id, stranger, input())).rejects.toMatchObject({ status: 404 });
    expect(await prisma.boardAsset.count()).toBe(0);
    expect(await assets.reserve(board.id, editor, input())).toMatchObject({ boardId: board.id, uploaderId: editor, status: "pending", fileId: null });
  });

  it("enforces storage shape constraints in PostgreSQL as well as the application", async () => {
    const { owner, board } = await setup();
    for (const values of [
      { byteSize: 0 }, { byteSize: 5242881 }, { mimeType: "image/svg+xml" }, { width: 4097 }, { height: 0 },
    ]) {
      const base = input();
      await expect(prisma.boardAsset.create({ data: {
        id: base.id, boardId: board.id, scopeBoardId: board.id, uploaderId: owner,
        byteSize: base.byteSize, mimeType: base.mimeType, width: base.width, height: base.height, providerFilePath: base.filePath, ...values,
      } })).rejects.toThrow();
    }
    const base = input();
    await expect(prisma.boardAsset.create({ data: {
      id: base.id, boardId: board.id, scopeBoardId: randomUUID(), uploaderId: owner, byteSize: 20,
      mimeType: "image/png", width: 2, height: 2, providerFilePath: base.filePath,
    } })).rejects.toThrow();
    expect(await prisma.boardAsset.count()).toBe(0);
  });

  it.each(["viewer", "removed", "deleted"] as const)("rechecks current access before finalizing an uploaded file after %s change", async (change) => {
    const { owner, editor, assets, boards, board } = await setup();
    const pending = await assets.reserve(board.id, editor, input());
    if (change === "viewer") await pool.query("UPDATE board_members SET role='viewer' WHERE board_id=$1 AND user_id=$2", [board.id, editor]);
    else if (change === "removed") await pool.query("DELETE FROM board_members WHERE board_id=$1 AND user_id=$2", [board.id, editor]);
    else await boards.delete(board.id, owner);
    await expect(assets.finalize(pending.id, editor, { fileId: "uploaded-file", filePath: pending.filePath, size: 20 })).rejects.toMatchObject({ status: change === "viewer" ? 403 : 404 });
    const durable = await prisma.boardAsset.findUniqueOrThrow({ where: { id: pending.id } });
    expect(durable.status).toBe("pending");
    expect(durable.providerFilePath).toBe(pending.filePath);
    expect(durable.boardId).toBe(change === "deleted" ? null : board.id);
    expect(durable.scopeBoardId).toBe(board.id);
  });

  it("rejects provider metadata mismatches and prevents another uploader from finalizing", async () => {
    const { owner, editor, assets, board } = await setup();
    const pending = await assets.reserve(board.id, owner, input());
    await expect(assets.finalize(pending.id, editor, { fileId: "provider", filePath: pending.filePath, size: 20 })).rejects.toMatchObject({ status: 404 });
    for (const file of [{ fileId: "provider", filePath: pending.filePath, size: 21 }, { fileId: "provider", filePath: "/another.png", size: 20 }]) {
      await expect(assets.finalize(pending.id, owner, file)).rejects.toMatchObject({ status: 502, code: "ASSET_PROVIDER_MISMATCH" });
    }
    expect((await prisma.boardAsset.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("pending");
  });

  it("allows current owner/editor/viewer reads but rejects unready, cross-board and revoked reads before charging budgets", async () => {
    const { owner, editor, viewer, stranger, assets, board, other, ready } = await setup();
    const asset = await ready(), pending = await assets.reserve(board.id, owner, input());
    for (const user of [owner, editor, viewer]) expect((await assets.getForRead(board.id, asset.id, user)).id).toBe(asset.id);
    const before = await prisma.assetRequestBudget.findMany({ orderBy: { bucket: "asc" } });
    await expect(assets.getForRead(board.id, asset.id, stranger)).rejects.toMatchObject({ status: 404, code: "BOARD_NOT_FOUND" });
    await expect(assets.getForRead(board.id, pending.id, owner)).rejects.toMatchObject({ status: 404, code: "ASSET_NOT_FOUND" });
    await expect(assets.getForRead(other.id, asset.id, owner)).rejects.toMatchObject({ status: 404, code: "ASSET_NOT_FOUND" });
    await pool.query("DELETE FROM board_members WHERE board_id=$1 AND user_id=$2", [board.id, viewer]);
    await expect(assets.getForRead(board.id, asset.id, viewer)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.assetRequestBudget.findMany({ orderBy: { bucket: "asc" } })).toEqual(before);
  });

  it("round-trips ready image references and retains them after removal and board deletion", async () => {
    const { owner, assets, boards, documents, board, ready } = await setup(); const asset = await ready();
    expect((await documents.save(board.id, document(asset.id), owner)).status).toBe("saved");
    expect(await documents.get(board.id, owner)).toMatchObject({ status: "found", document: { revision: 1, content: { objects: [{ assetId: asset.id }] } } });
    await documents.save(board.id, document(undefined, 1), owner);
    await pool.query("UPDATE board_assets SET created_at=clock_timestamp()-interval '2 days'");
    expect(await assets.claimAbandoned(20)).toEqual([]);
    await boards.delete(board.id, owner);
    expect(await assets.claimAbandoned(20)).toEqual([]);
    expect(await prisma.boardAsset.findUnique({ where: { id: asset.id } })).toMatchObject({ boardId: null, scopeBoardId: board.id, status: "ready", lastReferencedAt: expect.any(Date) });
  });

  it("rejects pending, missing and cross-board save references without changing documents, metadata or retention", async () => {
    const { owner, assets, documents, board, other, ready } = await setup();
    await documents.save(board.id, document(), owner);
    const pending = await assets.reserve(board.id, owner, input()), crossBoard = await ready(other.id);
    const before = await state();
    for (const id of [pending.id, crossBoard.id, randomUUID()]) await expect(documents.save(board.id, document(id, 1), owner)).rejects.toMatchObject({ status: 422, code: "INVALID_ASSET_REFERENCE" });
    expect(await state()).toEqual(before);
  });

  it("never retains assets from stale saves and rolls retention back on database save failure", async () => {
    const { owner, documents, board, ready } = await setup();
    await documents.save(board.id, document(), owner); const asset = await ready();
    const before = await state();
    expect(await documents.save(board.id, document(asset.id, 0), owner)).toEqual({ status: "conflict", currentRevision: 1 });
    expect(await state()).toEqual(before);
    await pool.query("CREATE FUNCTION fail_asset_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional save failure'; END $$; CREATE TRIGGER fail_asset_save BEFORE UPDATE ON board_documents FOR EACH ROW EXECUTE FUNCTION fail_asset_save()");
    await expect(documents.save(board.id, document(asset.id, 1), owner)).rejects.toThrow("intentional save failure");
    expect(await state()).toEqual(before);
  });

  it("cleans unfinished uploads while retaining ready draft/undo assets, including deleted boards", async () => {
    const { owner, assets, boards, board, other, ready } = await setup();
    const uploaded = await ready(), pending = await assets.reserve(other.id, owner, input()), fresh = await ready();
    await pool.query("UPDATE board_assets SET created_at=clock_timestamp()-interval '2 days' WHERE id=ANY($1::uuid[])", [[uploaded.id, pending.id]]);
    await boards.delete(other.id, owner);
    const claimed = await assets.claimAbandoned(20);
    expect(claimed.map(({ id }) => id)).toEqual([pending.id]);
    expect(claimed.find(({ id }) => id === pending.id)).toMatchObject({ boardId: null, scopeBoardId: other.id, filePath: pending.filePath, status: "deleting" });
    expect(await assets.claimAbandoned(20)).toEqual([]);
    expect((await prisma.boardAsset.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("ready");
    await assets.finishDelete(uploaded.id);
    expect((await prisma.boardAsset.findUniqueOrThrow({ where: { id: uploaded.id } })).status).toBe("ready");
    await pool.query("UPDATE board_assets SET updated_at=clock_timestamp()-interval '16 minutes' WHERE id=$1", [pending.id]);
    expect((await assets.claimAbandoned(20)).map(({ id }) => id)).toEqual([pending.id]);
    await assets.finishDelete(fresh.id);
    expect((await prisma.boardAsset.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("ready");
    expect((await prisma.boardAsset.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("deleting");
    expect((await prisma.board.findUniqueOrThrow({ where: { id: board.id } })).title).toBe("Cloud images");
  });

  it("serializes concurrent global reservations so pending uploads cannot overspend storage", async () => {
    const { owner, assets, board, other } = await setup();
    await seedAttempts(null, randomUUID(), owner, 400, 4_990_000, "2 days");
    const results = await Promise.allSettled([assets.reserve(board.id, owner, input(3_000_000)), assets.reserve(other.id, owner, input(3_000_000))]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({ reason: { status: 507, code: "ASSET_STORAGE_LIMIT" } });
    expect((await pool.query("SELECT SUM(byte_size)::bigint AS bytes FROM board_assets WHERE status<>'failed'")).rows[0].bytes).toBe("1999000000");
  });

  it.each(["bytes", "count"] as const)("enforces the per-board %s storage limit", async (limit) => {
    const { owner, assets, board } = await setup();
    await seedAttempts(board.id, board.id, owner, limit === "bytes" ? 20 : 100, limit === "bytes" ? 5 * 1024 * 1024 : 20, "2 days");
    await expect(assets.reserve(board.id, owner, input())).rejects.toMatchObject({ status: 507, code: "ASSET_STORAGE_LIMIT" });
  });

  it("counts failed attempts for upload quotas and serializes the last hourly slot", async () => {
    const { owner, assets, board, other } = await setup();
    await seedAttempts(board.id, board.id, owner, 9, 20, "1 minute");
    await pool.query("UPDATE board_assets SET status='failed'");
    const results = await Promise.allSettled([assets.reserve(board.id, owner, input()), assets.reserve(other.id, owner, input())]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({ reason: { status: 429, code: "ASSET_UPLOAD_RATE_LIMIT" } });
  });

  it("counts pending bytes toward a rolling daily uploader budget", async () => {
    const { owner, assets, board } = await setup();
    await seedAttempts(board.id, board.id, owner, 10, 5 * 1024 * 1024, "2 hours");
    await expect(assets.reserve(board.id, owner, input())).rejects.toMatchObject({ status: 429, code: "ASSET_UPLOAD_RATE_LIMIT" });
  });

  it("serializes signing budgets and rolls every counter back when the monthly budget refuses a URL", async () => {
    const { owner, viewer, assets, board, ready } = await setup(); const asset = await ready();
    await budget("read", owner, 1499, 1499 * 20);
    const results = await Promise.allSettled([assets.getForRead(board.id, asset.id, owner), assets.getForRead(board.id, asset.id, owner)]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({ reason: { status: 429, code: "ASSET_SIGN_RATE_LIMIT" } });
    await pool.query("UPDATE asset_request_budgets SET byte_count=10000000000 WHERE bucket LIKE 'bandwidth:%'");
    const before = await prisma.assetRequestBudget.findMany({ orderBy: { bucket: "asc" } });
    await expect(assets.getForRead(board.id, asset.id, viewer)).rejects.toMatchObject({ status: 429, code: "ASSET_BANDWIDTH_BUDGET" });
    expect(await prisma.assetRequestBudget.findMany({ orderBy: { bucket: "asc" } })).toEqual(before);
  });

  it("rechecks a pending candidate after concurrent finalization acquires the shared parent lock", async () => {
    const { owner, assets, documents, board } = await setup(); const asset = await assets.reserve(board.id, owner, input());
    await pool.query("UPDATE board_assets SET created_at=clock_timestamp()-interval '2 days'");
    const lock = await pool.connect();
    try {
      await lock.query("BEGIN"); await lock.query("SELECT id FROM boards WHERE id=$1 FOR UPDATE", [board.id]);
      await lock.query("UPDATE board_assets SET status='ready', provider_file_id=$2 WHERE id=$1", [asset.id, `provider-${asset.id}`]);
      const cleanup = assets.claimAbandoned(20);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await admin.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock') AS waiting", [schema])).rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true); await lock.query("COMMIT");
      expect(await cleanup).toEqual([]);
      expect((await documents.save(board.id, document(asset.id), owner)).status).toBe("saved");
    } finally { await lock.query("ROLLBACK"); lock.release(); }
  });
});
