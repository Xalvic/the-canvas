import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import pg from "pg";
import sharp from "sharp";
import request from "supertest";
import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createPrismaClient } from "./prisma.js";
import { migrateDatabase } from "./migrations.js";
import { createPostgresAuthStore } from "./postgresAuth.js";
import { createPostgresBoardStore } from "./postgresBoards.js";
import { createPostgresDocumentStore } from "./postgresDocuments.js";
import { createPostgresShareLinkStore } from "./postgresShareLinks.js";
import { createPostgresSharingStore } from "./postgresSharing.js";
import { createPostgresWorkspaceStore } from "./postgresWorkspace.js";
import { createPostgresCollaborationStore } from "./postgresCollaboration.js";
import { createPostgresAssetStore } from "./postgresAssets.js";
import { createImageAssetService } from "./imageAssets.js";
import type { ImageStorage } from "./imageKit.js";
import { hashToken, randomToken, SESSION_COOKIE } from "./auth.js";
import { documentInput } from "./testFixtures/document.js";
import type { PrismaClient } from "./generated/prisma/client.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
type Person = { id: string; email: string; cookie: string };
describe.skipIf(!databaseUrl)("real PostgreSQL authenticated reusable links", () => {
  const admin = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let schema: string, pool: pg.Pool, prisma: PrismaClient;
  const processes: ChildProcess[] = [], servers: Server[] = [], controllers: AbortController[] = [];
  beforeEach(async () => {
    schema = `scribble_share_link_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, application_name: schema, max: 10 });
    await migrateDatabase(pool); prisma = createPrismaClient(pool, schema);
  });
  afterEach(async () => {
    controllers.splice(0).forEach((controller) => controller.abort());
    for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
    for (const child of processes.splice(0)) await stopProcess(child);
    await prisma?.$disconnect(); await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    vi.restoreAllMocks();
  });
  afterAll(async () => { await admin.end(); });

  async function setup() {
    const auth = createPostgresAuthStore(prisma), boards = createPostgresBoardStore(prisma), documents = createPostgresDocumentStore(prisma);
    const key = randomBytes(32), links = createPostgresShareLinkStore(prisma, key), sharing = createPostgresSharingStore(prisma);
    const workspace = createPostgresWorkspaceStore(prisma), collaboration = createPostgresCollaborationStore(prisma), assetStore = createPostgresAssetStore(prisma);
    const storage: ImageStorage = {
      pathFor: ({ boardId, assetId }) => `/test/${boardId}/${assetId}.png`,
      upload: async (buffer, target) => ({ fileId: randomUUID(), filePath: storage.pathFor(target), size: buffer.length }),
      find: async () => null, delete: async () => {}, sign: vi.fn(() => "https://assets.example/signed-test-image"),
    };
    const assets = createImageAssetService(assetStore, storage);
    async function account(subject: string) {
      const token = randomToken();
      const session = await auth.signIn({ subject, email: `${subject}@example.com`, displayName: subject }, hashToken(token));
      return { ...session.user, cookie: `${SESSION_COOKIE}=${token}` };
    }
    const owner = await account("owner"), first = await account("first"), second = await account("second"), stranger = await account("stranger");
    const board = await boards.create("Shared drawing", owner.id);
    await documents.save(board.id, documentInput(), owner.id);
    const app = createApp(boards, documents, { store: auth, provider: null, frontendUrl: "http://127.0.0.1:5173/scribble/", secureCookies: false }, sharing, assets, collaboration, undefined, workspace, links);
    const url = `/api/boards/${board.id}`;
    const copy = (expectedVersion = 0, requestId = randomUUID()) => links.copy(board.id, owner.id, { requestId, expectedVersion });
    const patch = (expectedVersion: number, change: { role: "viewer" | "editor" } | { enabled: false }, requestId = randomUUID()) => links.update(board.id, owner.id, { requestId, expectedVersion, ...change });
    const call = (person: Person, method: "get" | "post" | "patch" | "put" | "delete", path: string) => request(app)[method](path).set("Cookie", person.cookie).set("X-Scribble-Request", "1").set("X-Scribble-Account", person.id);
    const operation = () => {
      const before = documentInput().content.objects.find((object) => object.type === "card")!;
      return { operationId: randomUUID(), baseRevision: 1, changes: [{ id: before.id, before, after: { ...before, title: "Edited by link" } }] };
    };
    return { auth, boards, documents, key, links, sharing, workspace, collaboration, assetStore, assets, storage, owner, first, second, stranger, board, app, url, copy, patch, call, operation };
  }

  it("starts disabled without rewriting pages, and GET does not enable access", async () => {
    const { links, board, owner, stranger, call, url } = await setup();
    expect(await links.get(board.id, owner.id)).toEqual({ enabled: false, role: "viewer", generation: 0, version: 0 });
    expect(await prisma.boardShareLink.count()).toBe(0);
    await call(stranger, "get", `${url}/share-link`).expect(404);
    expect((await call(owner, "get", `${url}/share-link`).expect(200)).body.settings.enabled).toBe(false);
    expect(await prisma.boardShareLink.count()).toBe(0);
  });
  it("reuses one active link for multiple accounts and idempotent repeated opens", async () => {
    const { links, board, owner, first, second, stranger, boards, call, url, copy } = await setup();
    const active = await copy();
    expect(active.settings).toEqual({ enabled: true, role: "viewer", generation: 1, version: 1 });
    await call(stranger, "get", url).expect(404);
    const opened = await Promise.all([first, first, second].map((person) => links.open(active.token, person.id)));
    expect(opened.map((item) => item.role)).toEqual(["viewer", "viewer", "viewer"]);
    expect(await prisma.boardShareLinkGrant.count()).toBe(2);
    expect(await prisma.boardMember.count()).toBe(0);
    expect((await boards.list(first.id)).map((item) => item.id)).toEqual([board.id]);
    const copied = await links.copy(board.id, owner.id, { requestId: randomUUID(), expectedVersion: 1 });
    expect(copied.token === active.token).toBe(true);
    const row = await prisma.boardShareLink.findUniqueOrThrow({ where: { boardId: board.id } });
    expect(row.tokenCiphertext?.includes(active.token)).toBe(false);
    expect(row.tokenHash === hashToken(active.token)).toBe(true);
    for (const path of ["/api/boards", url, `${url}/sharing`, "/api/workspace"]) {
      expect(JSON.stringify((await call(owner, "get", path).expect(200)).body).includes(active.token)).toBe(false);
    }
  });
  it("keeps viewer reads, presence and workspace access while denying every write/manage path", async () => {
    const { links, first, second, board, call, url, copy, workspace, operation } = await setup();
    await links.open((await copy()).token, first.id);
    await call(first, "get", url).expect(200); await call(first, "get", `${url}/document`).expect(200);
    await workspace.update({ lastOpenedBoardId: board.id }, first.id);
    expect((await workspace.initialize({ requestId: randomUUID(), createInitialPage: true }, first.id)).board?.id).toBe(board.id);
    expect(await prisma.board.count()).toBe(1);
    await call(first, "post", `${url}/presence`).send({ clientId: randomUUID(), cursor: null, selectedIds: [] }).expect(204);
    for (const [method, path, body] of [
      ["patch", url, { title: "Blocked" }], ["delete", url, {}], ["put", `${url}/document`, documentInput(1)],
      ["post", `${url}/operations`, operation()], ["post", `${url}/share-link/copy`, { requestId: randomUUID(), expectedVersion: 1 }],
      ["patch", `${url}/share-link`, { requestId: randomUUID(), expectedVersion: 1, enabled: false }],
      ["post", `${url}/invitations`, { email: second.email, role: "editor" }],
      ["delete", `${url}/members/${second.id}`, {}],
    ] as const) await call(first, method, path).send(body).expect(403);
    await call(first, "get", `${url}/share-link`).expect(403);
    await call(first, "get", `${url}/sharing`).expect(403);
    await call(first, "post", `${url}/assets`).set("Content-Type", "image/png").send(Buffer.from("invalid image")).expect(403);
    await call(first, "get", `${url}/asset-uploads/${randomUUID()}`).expect(403);
    expect((await prisma.boardDocument.findUniqueOrThrow({ where: { boardId: board.id } })).revision).toBe(1);
  });
  it("allows link editors to rename, save, apply and replay operations without owner actions", async () => {
    const { links, first, board, call, url, copy, patch, operation } = await setup();
    const active = await copy(); await patch(1, { role: "editor" });
    expect((await links.open(active.token, first.id)).role).toBe("editor");
    await call(first, "patch", url).send({ title: "Renamed by editor" }).expect(200);
    const input = operation();
    const applied = await call(first, "post", `${url}/operations`).send(input).expect(200);
    expect(applied.body.replayed).toBe(false);
    expect((await call(first, "post", `${url}/operations`).send(input).expect(200)).body.replayed).toBe(true);
    await call(first, "put", `${url}/document`).send(documentInput(2)).expect(200);
    await call(first, "delete", url).expect(403);
    await patch(2, { role: "viewer" });
    await call(first, "post", `${url}/operations`).send(input).expect(403);
    expect((await prisma.boardDocument.findUniqueOrThrow({ where: { boardId: board.id } })).revision).toBe(3);
  });
  it("revokes all derived resources and preference access while preserving independent members", async () => {
    const { links, sharing, first, second, owner, stranger, board, call, url, boards, documents, workspace, copy, patch, operation } = await setup();
    const active = await copy(); await patch(1, { role: "editor" });
    await links.open(active.token, first.id); await links.open(active.token, second.id);
    const invite = await sharing.invite(board.id, owner.id, { email: second.email, role: "editor" });
    await sharing.accept(invite.id, second.id, second.email);
    const pending = await sharing.invite(board.id, owner.id, { email: stranger.email, role: "viewer" });
    await workspace.update({ lastOpenedBoardId: board.id }, first.id);
    const input = operation(); await call(first, "post", `${url}/operations`).send(input).expect(200);
    await patch(2, { enabled: false });
    for (const path of [url, `${url}/document`, `${url}/assets/${randomUUID()}`, `${url}/asset-uploads/${randomUUID()}`, `${url}/events?clientId=${randomUUID()}`]) await call(first, "get", path).expect(404);
    await call(first, "post", `${url}/operations`).send(input).expect(404);
    await call(first, "post", `${url}/presence`).send({ clientId: randomUUID(), cursor: null, selectedIds: [] }).expect(404);
    await call(first, "put", `${url}/document`).send(documentInput(2)).expect(404);
    await call(first, "post", `${url}/assets`).set("Content-Type", "image/png").send(Buffer.from("invalid")).expect(404);
    expect(await boards.list(first.id)).toEqual([]);
    expect((await workspace.get(first.id)).lastOpenedBoardId).toBeNull();
    await expect(workspace.update({ lastOpenedBoardId: board.id }, first.id)).rejects.toMatchObject({ status: 404 });
    expect((await boards.get(board.id, second.id))?.role).toBe("editor");
    expect((await sharing.accept(pending.id, stranger.id, stranger.email)).role).toBe("viewer");
    expect((await documents.get(board.id, owner.id)).status).toBe("found");
  });
  it("combines independent roles by their greater permission, including removal while link remains active", async () => {
    const { links, sharing, owner, first, board, boards, copy, patch } = await setup();
    const active = await copy();
    const invite = await sharing.invite(board.id, owner.id, { email: first.email, role: "editor" });
    await sharing.accept(invite.id, first.id, first.email);
    expect((await links.open(active.token, first.id)).role).toBe("editor");
    await sharing.updateMember(board.id, owner.id, first.id, "viewer");
    await patch(1, { role: "editor" });
    expect((await boards.get(board.id, first.id))?.role).toBe("editor");
    await sharing.removeMember(board.id, owner.id, first.id);
    expect((await boards.get(board.id, first.id))?.role).toBe("editor");
    await patch(2, { enabled: false });
    expect(await boards.get(board.id, first.id)).toBeUndefined();
  });
  it("issues a fresh generation after Stop, keeping old URLs and grants invalid", async () => {
    const { links, first, board, boards, copy, patch } = await setup();
    const old = await copy(); await links.open(old.token, first.id);
    await patch(1, { enabled: false }); const fresh = await copy(2);
    expect(fresh.token !== old.token).toBe(true); expect(fresh.settings.generation).toBe(2);
    await expect(links.open(old.token, first.id)).rejects.toMatchObject({ code: "SHARE_LINK_UNAVAILABLE" });
    expect(await boards.get(board.id, first.id)).toBeUndefined();
    expect((await links.open(fresh.token, first.id)).role).toBe("viewer");
    expect((await prisma.boardShareLinkGrant.findUniqueOrThrow({ where: { boardId_userId: { boardId: board.id, userId: first.id } } })).generation).toBe(2);
  });
  it("never reveals title or existence for forged, stopped or deleted links", async () => {
    const { links, boards, owner, first, board, copy, patch, call } = await setup();
    const active = await copy();
    const invalid = await call(first, "post", "/api/share-links/open").send({ token: randomToken() }).expect(404);
    await patch(1, { enabled: false });
    const stopped = await call(first, "post", "/api/share-links/open").send({ token: active.token }).expect(404);
    const fresh = await copy(2); await boards.delete(board.id, owner.id);
    const deleted = await call(first, "post", "/api/share-links/open").send({ token: fresh.token }).expect(404);
    expect(invalid.body).toEqual(stopped.body); expect(deleted.body).toEqual(invalid.body);
    expect(JSON.stringify(invalid.body).includes(board.title)).toBe(false);
    await expect(links.open(randomToken(), first.id)).rejects.toMatchObject({ status: 404 });
  });
  it("serializes duplicate/concurrent copies and conflicts with stale independent mutations", async () => {
    const { links, owner, board, copy, patch, first, second } = await setup();
    const requestId = randomUUID();
    const same = await Promise.all([copy(0, requestId), copy(0, requestId)]);
    expect(same[0].token === same[1].token).toBe(true);
    expect(same.map((item) => item.replayed).sort()).toEqual([false, true]);
    const roleRace = await Promise.allSettled([patch(1, { role: "editor" }), patch(1, { enabled: false })]);
    expect(roleRace.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(roleRace.find((item) => item.status === "rejected")).toMatchObject({ reason: { code: "SHARE_LINK_VERSION_CONFLICT" } });
    await expect(copy(0, requestId)).rejects.toMatchObject({ code: "SHARE_LINK_REQUEST_SUPERSEDED" });
    await expect(links.copy(board.id, owner.id, { requestId, expectedVersion: 2 })).rejects.toMatchObject({ code: "SHARE_LINK_REQUEST_CONFLICT" });
    const current = await links.get(board.id, owner.id);
    if (current.enabled) {
      const opened = await Promise.all([first, second].map((person) => links.open(same[0].token, person.id)));
      expect(opened.every((item) => item.role === current.role)).toBe(true);
    }
  });
  it("prevents unknown Copy from re-enabling after Stop, including Stop on an already disabled page", async () => {
    const { copy, patch, links, board, owner } = await setup();
    const requestId = randomUUID(); await copy(0, requestId); await patch(1, { enabled: false });
    await expect(copy(0, requestId)).rejects.toMatchObject({ code: "SHARE_LINK_REQUEST_SUPERSEDED" });
    await expect(copy(1)).rejects.toMatchObject({ code: "SHARE_LINK_VERSION_CONFLICT" });
    await patch(2, { enabled: false });
    await expect(copy(2)).rejects.toMatchObject({ code: "SHARE_LINK_VERSION_CONFLICT" });
    expect((await links.get(board.id, owner.id)).enabled).toBe(false);
  });
  it("reconciles settings responses without downgrading newer permissions", async () => {
    const { links, owner, board, copy, patch } = await setup(); await copy();
    const requestId = randomUUID(); const changed = await patch(1, { role: "editor" }, requestId);
    expect((await patch(1, { role: "editor" }, requestId)).replayed).toBe(true);
    expect(changed.settings.role).toBe("editor");
    await patch(2, { role: "viewer" });
    await expect(patch(1, { role: "editor" }, requestId)).rejects.toMatchObject({ code: "SHARE_LINK_REQUEST_SUPERSEDED" });
    expect((await links.get(board.id, owner.id)).role).toBe("viewer");
  });

  it.each(["role", "stop"] as const)("serializes simultaneous Copy, open and %s intents without restoring stale access", async (change) => {
    const { copy, patch, links, owner, first, board, boards } = await setup();
    const active = await copy();
    const outcomes = await Promise.allSettled([
      copy(1), links.open(active.token, first.id), patch(1, change === "role" ? { role: "editor" } : { enabled: false }),
    ]);
    expect(outcomes[2].status).toBe("fulfilled");
    if (outcomes[0].status === "rejected") expect(outcomes[0].reason).toMatchObject({ code: "SHARE_LINK_VERSION_CONFLICT" });
    const current = await links.get(board.id, owner.id);
    expect(current.version).toBe(2);
    if (change === "stop") {
      expect(current.enabled).toBe(false); expect(await boards.get(board.id, first.id)).toBeUndefined();
      await expect(links.open(active.token, first.id)).rejects.toMatchObject({ code: "SHARE_LINK_UNAVAILABLE" });
    } else {
      expect(current.role).toBe("editor");
      expect((await boards.get(board.id, first.id))?.role).toBe("editor");
    }
  });

  it("keeps account fencing, expiry and logout ahead of link mutation and redemption", async () => {
    const { copy, app, owner, first, stranger, call, url, links, auth, board, boards } = await setup();
    const active = await copy();
    await request(app).post(`${url}/share-link/copy`).set("Cookie", stranger.cookie).set("X-Scribble-Request", "1").set("X-Scribble-Account", owner.id).send({ requestId: randomUUID(), expectedVersion: 1 }).expect(409);
    await request(app).post("/api/share-links/open").set("Cookie", first.cookie).set("X-Scribble-Request", "1").set("X-Scribble-Account", stranger.id).send({ token: active.token }).expect(409);
    expect(await prisma.boardShareLinkGrant.count()).toBe(0);
    expect((await links.open(active.token, owner.id)).role).toBe("owner");
    await links.open(active.token, first.id);
    await call(first, "post", "/api/auth/logout").expect(204);
    await call(first, "get", url).expect(401);
    await call(first, "post", "/api/share-links/open").send({ token: active.token }).expect(401);
    const token = randomToken();
    const session = await auth.signIn({ subject: "first", email: first.email, displayName: "First" }, hashToken(token));
    expect(session.user.id).toBe(first.id);
    expect((await boards.get(board.id, session.user.id))?.role).toBe("viewer");
    await pool.query("UPDATE auth_sessions SET expires_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '1 day' WHERE token_hash=$1", [hashToken(token)]);
    await request(app).post("/api/share-links/open").set("Cookie", `${SESSION_COOKIE}=${token}`).set("X-Scribble-Request", "1").send({ token: active.token }).expect(401);
  });

  it("persists mutation budgets while allowing an authorized unchanged receipt replay", async () => {
    const { copy, board, owner } = await setup();
    const requestId = randomUUID(); await copy(0, requestId);
    await prisma.boardShareLinkReceipt.createMany({ data: Array.from({ length: 299 }, () => ({
      boardId: board.id, actorId: owner.id, requestId: randomUUID(), payloadHash: "a".repeat(64), settingsVersion: 1,
    })) });
    await expect(copy(1)).rejects.toMatchObject({ code: "SHARE_LINK_RATE_LIMIT" });
    expect((await copy(0, requestId)).replayed).toBe(true);
    expect(await prisma.boardShareLinkReceipt.count()).toBe(300);
  });

  it("reconciles a dropped committed Copy after an actual API process restart", async () => {
    const { key, owner, first, board, links } = await setup();
    const requestId = randomUUID(), input = { requestId, expectedVersion: 0 };
    const start = await startProcess(key, true);
    const init = { method: "POST", headers: { Cookie: owner.cookie, "X-Scribble-Request": "1", "X-Scribble-Account": owner.id, "Content-Type": "application/json" }, body: JSON.stringify(input) };
    await expect(fetch(`${start.url}/api/boards/${board.id}/share-link/copy`, init)).rejects.toThrow();
    expect((await links.get(board.id, owner.id)).enabled).toBe(true);
    await stopProcess(start.child);
    const restarted = await startProcess(key);
    const response = await fetch(`${restarted.url}/api/boards/${board.id}/share-link/copy`, init);
    expect(response.status).toBe(200);
    const copied = await response.json(); expect(copied.replayed).toBe(true);
    const again = await fetch(`${restarted.url}/api/boards/${board.id}/share-link/copy`, { ...init, body: JSON.stringify({ requestId: randomUUID(), expectedVersion: 1 }) });
    expect((await again.json()).token === copied.token).toBe(true);
    expect((await links.open(copied.token, first.id)).id).toBe(board.id);
    expect(await prisma.boardShareLink.count()).toBe(1);
  }, 20_000);

  it.each(["viewer", "stopped"] as const)("rechecks a waiting save and redemption after committed %s settings", async (change) => {
    const { copy, patch, links, documents, first, second, board } = await setup();
    const active = await copy(); await patch(1, { role: "editor" }); await links.open(active.token, first.id);
    const lock = await pool.connect();
    try {
      await lock.query("BEGIN"); await lock.query("SELECT id FROM boards WHERE id=$1 FOR UPDATE", [board.id]);
      if (change === "viewer") await lock.query("UPDATE board_share_links SET role='viewer',settings_version=settings_version+1 WHERE board_id=$1", [board.id]);
      else await lock.query("UPDATE board_share_links SET enabled=false,token_hash=NULL,token_ciphertext=NULL,settings_version=settings_version+1 WHERE board_id=$1", [board.id]);
      const write = documents.save(board.id, documentInput(1), first.id).catch((error) => error);
      const open = links.open(active.token, second.id).catch((error) => error);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        waiting = (await admin.query("SELECT count(*)::int >= 2 AS waiting FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [schema])).rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await lock.query("COMMIT"); expect(waiting).toBe(true);
      if (change === "viewer") { expect(await write).toMatchObject({ status: 403 }); expect(await open).toMatchObject({ role: "viewer" }); }
      else { expect(await write).toEqual({ status: "board-not-found" }); expect(await open).toMatchObject({ code: "SHARE_LINK_UNAVAILABLE" }); }
      expect((await prisma.boardDocument.findUniqueOrThrow({ where: { boardId: board.id } })).revision).toBe(1);
    } finally { await lock.query("ROLLBACK"); lock.release(); }
  });

  it("enforces link image reads, upload identity, reconciliation and downgrade limits", async () => {
    const { copy, patch, links, first, second, owner, board, assets, assetStore, storage, call, url } = await setup();
    const active = await copy(); await patch(1, { role: "editor" }); await links.open(active.token, first.id); await links.open(active.token, second.id);
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ee9933" } }).png().toBuffer();
    const requestId = randomUUID();
    const uploaded = await call(first, "post", `${url}/assets`).set("X-Scribble-Upload-Request", requestId).set("Content-Type", "image/png").send(bytes).expect(200);
    const assetId = uploaded.body.upload.asset.id;
    await call(first, "get", `${url}/asset-uploads/${requestId}`).expect(200);
    await call(second, "get", `${url}/asset-uploads/${requestId}`).expect(404);
    await patch(2, { role: "viewer" });
    expect((await call(first, "get", `${url}/assets/${assetId}`).expect(200)).body.asset.url).toBe("https://assets.example/signed-test-image");
    await call(first, "get", `${url}/asset-uploads/${requestId}`).expect(403);
    await expect(assetStore.assertCanUpload(board.id, first.id)).rejects.toMatchObject({ status: 403 });
    await patch(3, { enabled: false });
    const signedBefore = vi.mocked(storage.sign).mock.calls.length;
    await expect(assets.read(board.id, assetId, first.id)).rejects.toMatchObject({ status: 404 });
    expect(vi.mocked(storage.sign).mock.calls.length).toBe(signedBefore);
    expect((await assets.read(board.id, assetId, owner.id)).id).toBe(assetId);
  });

  it("rechecks edit access before finalizing an in-flight image upload", async () => {
    const { copy, patch, links, first, board, assets, storage } = await setup();
    const active = await copy(); await patch(1, { role: "editor" }); await links.open(active.token, first.id);
    const original = storage.upload;
    storage.upload = async (buffer, target) => { await patch(2, { enabled: false }); return original(buffer, target); };
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
    await expect(assets.upload(board.id, first.id, bytes, "image/png")).rejects.toMatchObject({ status: 404 });
    expect(await prisma.boardAsset.count({ where: { status: "ready" } })).toBe(0);
    expect(await prisma.boardAsset.count({ where: { status: "pending" } })).toBe(1);
  });

  it.each(["stop", "session"] as const)("ends a live SSE stream after %s and delivers current roles on downgrade", async (end) => {
    const { app, copy, patch, links, first, auth, board } = await setup();
    const active = await copy(); await patch(1, { role: "editor" }); await links.open(active.token, first.id);
    const server = app.listen(0, "127.0.0.1"); servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No listener");
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/boards/${board.id}/events?clientId=${randomUUID()}`, { headers: { Cookie: first.cookie }, signal: controller.signal });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader(); let buffered = "";
    async function until(fragment: string) {
      const deadline = setTimeout(() => controller.abort(), 3_000);
      try { while (!buffered.includes(fragment)) { const result = await reader.read(); if (result.done) throw new Error("Stream ended too early"); buffered += new TextDecoder().decode(result.value); } }
      finally { clearTimeout(deadline); }
    }
    await until('"role":"editor"'); buffered = "";
    await patch(2, { role: "viewer" }); await until('"role":"viewer"'); buffered = "";
    if (end === "stop") await patch(3, { enabled: false });
    else await auth.revokeSession(hashToken(first.cookie.split("=")[1]));
    await until(`"code":"${end === "stop" ? "BOARD_NOT_FOUND" : "UNAUTHENTICATED"}"`);
    expect((await reader.read()).done).toBe(true);
  }, 10_000);

  it("permits safe Stop and fresh sharing after key loss without exposing material", async () => {
    const { copy, links, key, owner, board } = await setup(); const old = await copy();
    const same = createPostgresShareLinkStore(prisma, key);
    expect((await same.copy(board.id, owner.id, { requestId: randomUUID(), expectedVersion: 1 })).token === old.token).toBe(true);
    const rotated = createPostgresShareLinkStore(prisma, randomBytes(32));
    await expect(rotated.copy(board.id, owner.id, { requestId: randomUUID(), expectedVersion: 1 })).rejects.toMatchObject({ code: "SHARE_LINK_KEY_UNAVAILABLE" });
    await rotated.update(board.id, owner.id, { requestId: randomUUID(), expectedVersion: 1, enabled: false });
    const fresh = await rotated.copy(board.id, owner.id, { requestId: randomUUID(), expectedVersion: 2 });
    expect(fresh.token !== old.token).toBe(true); expect((await links.get(board.id, owner.id)).generation).toBe(2);
  });

  it("preserves all version-11 data and atomically rolls back a failed additive migration", async () => {
    const { board, owner, sharing, first } = await setup();
    await sharing.invite(board.id, owner.id, { email: first.email, role: "editor" });
    await pool.query("DROP TABLE board_share_link_grants,board_share_link_receipts,board_share_links; DELETE FROM schema_migrations WHERE version=12");
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename", [schema])).rows.map((row) => row.tablename as string);
    const snapshot = () => Promise.all(tables.map(async (table) => (await pool.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows));
    const before = await snapshot();
    await pool.query("CREATE TABLE board_share_link_receipts(sentinel text); INSERT INTO board_share_link_receipts VALUES('preserve conflict')");
    await expect(migrateDatabase(pool)).rejects.toMatchObject({ code: "42P07" });
    expect(await snapshot()).toEqual(before);
    expect((await pool.query("SELECT to_regclass('board_share_links') AS present")).rows[0].present).toBeNull();
    await pool.query("DROP TABLE board_share_link_receipts");
    await Promise.all([migrateDatabase(pool), migrateDatabase(pool)]);
    const after = await snapshot();
    // Ledger gains only 12; all inherited application tables retain exact rows.
    for (let index = 0; index < tables.length; index++) if (tables[index] !== "schema_migrations") expect(after[index]).toEqual(before[index]);
    expect(await prisma.boardShareLink.count()).toBe(0);
    expect((await pool.query("SELECT max(version)::int AS version FROM schema_migrations")).rows[0].version).toBe(12);
  });
  it("enforces grant/link constraints and cascades only deleted-page link state", async () => {
    const { copy, links, boards, owner, first, second, board } = await setup();
    const active = await copy(); await links.open(active.token, first.id);
    const other = await boards.create("Keep another page", owner.id);
    const otherLink = await links.copy(other.id, owner.id, { requestId: randomUUID(), expectedVersion: 0 });
    await links.open(otherLink.token, second.id);
    await expect(pool.query("UPDATE board_share_links SET role='owner' WHERE board_id=$1", [board.id])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE board_share_link_grants SET generation=0 WHERE board_id=$1", [board.id])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE board_share_links SET token_hash=NULL WHERE board_id=$1", [board.id])).rejects.toMatchObject({ code: "23514" });
    await boards.delete(board.id, owner.id);
    expect(await prisma.boardShareLink.count()).toBe(1); expect(await prisma.boardShareLinkGrant.count()).toBe(1); expect(await prisma.boardShareLinkReceipt.count()).toBe(1);
    expect((await links.open(otherLink.token, second.id)).id).toBe(other.id);
  });

  async function startProcess(key: Buffer, dropResponse = false) {
    const child = spawn(process.execPath, ["--import", "tsx", "server/testFixtures/shareLinkServer.ts"], {
      cwd: process.cwd(), env: { ...process.env, TEST_DATABASE_URL: databaseUrl, R4_TEST_SCHEMA: schema, SHARE_LINK_KEY: key.toString("hex"), R4_DROP_COPY_RESPONSE: dropResponse ? "1" : "0" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    processes.push(child);
    const port = await new Promise<number>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("R4 fixture startup timed out")), 8_000);
      child.once("exit", () => { clearTimeout(timer); reject(new Error("R4 fixture exited before ready")); });
      child.stdout!.on("data", (chunk) => {
        output += String(chunk);
        const line = output.split("\n").find((candidate) => candidate.startsWith('{"port":'));
        if (line) { clearTimeout(timer); resolve(JSON.parse(line).port); }
      });
    });
    return { child, url: `http://127.0.0.1:${port}` };
  }
  async function stopProcess(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => { child.once("exit", () => resolve()); child.kill(); });
  }
});
