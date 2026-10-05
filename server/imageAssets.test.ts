import { randomUUID } from "node:crypto";
import request from "supertest";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createBoardStore } from "./boards.js";
import { hashToken, SESSION_COOKIE, type AuthStore } from "./auth.js";
import type { AssetMetadata, AssetStore } from "./assets.js";
import { HttpError } from "./errors.js";
import { createImageAssetService } from "./imageAssets.js";
import type { ImageStorage } from "./imageKit.js";
import { MAX_IMAGE_BYTES } from "./imageValidation.js";
import { cloudDocumentSchema } from "./contracts/cloudDocument.js";
import { canvasDocumentSchema } from "./contracts/canvasDocument.js";
import { documentInput } from "./testFixtures/document.js";

afterEach(() => vi.restoreAllMocks());
const userId = randomUUID(), boardId = randomUUID(), assetId = randomUUID();
const token = "a".repeat(43), cookie = `${SESSION_COOKIE}=${token}`;
const url = `/api/boards/${boardId}/assets`;
function imageObject(id = assetId) {
  return { id: "image-object", type: "image", assetId: id, zIndex: 1, createdAt: 1, updatedAt: 1,
    x: -40, y: 20, width: 100, height: 80, originalWidth: 2, originalHeight: 2, name: "Sketch.png", mimeType: "image/png" };
}
function setup(enabled = true) {
  const asset: AssetMetadata = { id: assetId, boardId, scopeBoardId: boardId, uploaderId: userId, status: "ready",
    byteSize: 100, mimeType: "image/png", width: 2, height: 2, fileId: "test-file", filePath: `/scribble/dev/${boardId}/${assetId}.png`, createdAt: Date.now(), lastReferencedAt: null };
  const store: AssetStore = {
    assertCanUpload: vi.fn(async () => {}),
    reserve: vi.fn(async (_board, _user, input) => ({ ...asset, ...input, status: "pending" })),
    finalize: vi.fn(async (id, _user, file) => ({ ...asset, id, byteSize: file.size, filePath: file.filePath })),
    getForRead: vi.fn(async () => asset), claimAbandoned: vi.fn(async () => []), finishDelete: vi.fn(async () => {}),
  };
  const storage: ImageStorage = {
    pathFor: vi.fn((target) => `/scribble/dev/${target.boardId}/${target.assetId}.${target.extension}`),
    upload: vi.fn(async (buffer, target) => ({ fileId: "test-file", filePath: storage.pathFor(target), size: buffer.length })),
    sign: vi.fn((_path, expiry) => `https://ik.imagekit.io/test/image.png?ik-s=test&ik-t=${expiry}`),
    delete: vi.fn(async () => {}), find: vi.fn(async () => null),
  };
  const authStore: AuthStore = {
    getSession: vi.fn(async (hash) => hash === hashToken(token) ? { user: { id: userId, email: "test@example.com", displayName: null }, expiresAt: Date.now() + 60_000 } : undefined),
    createFlow: vi.fn(), consumeFlow: vi.fn(), signIn: vi.fn(), revokeSession: vi.fn(),
  };
  const service = createImageAssetService(store, enabled ? storage : null);
  const app = createApp(createBoardStore(), undefined, { store: authStore, provider: null, secureCookies: false, frontendUrl: "http://127.0.0.1:5173/scribble/" }, undefined, service);
  const upload = (body: Buffer, type = "image/png") => request(app).post(url).set("Cookie", cookie).set("X-Scribble-Request", "1").set("Content-Type", type).send(body);
  return { app, store, storage, service, asset, upload };
}
async function png() { return sharp({ create: { width: 2, height: 2, channels: 3, background: "#ee9933" } }).png().toBuffer(); }

describe("board image HTTP and failure boundaries", () => {
  it("requires a session and mutation-origin proof before upload access or parsing", async () => {
    const { app, store, storage } = setup();
    await request(app).post(url).set("Content-Type", "image/png").send(Buffer.from("bad")).expect(401);
    await request(app).get(`${url}/${assetId}`).expect(401);
    for (const headers of [{}, { "X-Scribble-Request": "1", Origin: "https://attacker.example" }, { "X-Scribble-Request": "1", "Sec-Fetch-Site": "cross-site" }]) {
      await request(app).post(url).set("Cookie", cookie).set(headers).send(Buffer.from("bad")).expect(403);
    }
    expect(store.assertCanUpload).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it("normalizes a valid image, reserves before upload, and returns only public metadata", async () => {
    const { upload, store, storage } = setup();
    const response = await upload(await png()).expect(201);
    expect(response.headers.location).toBe(`${url}/${response.body.asset.id}`);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.asset).toEqual({ id: expect.any(String), boardId, mimeType: "image/png", width: 2, height: 2, byteSize: expect.any(Number), createdAt: expect.any(Number) });
    expect(vi.mocked(store.reserve).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(storage.upload).mock.invocationCallOrder[0]!);
    expect(vi.mocked(storage.upload).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(store.finalize).mock.invocationCallOrder[0]!);
    expect(store.finishDelete).not.toHaveBeenCalled();
  });
  it("rejects invalid content, MIME mismatch, incomplete images, oversized bodies and compression before provider writes", async () => {
    const { upload, store, storage } = setup();
    await upload(Buffer.from("<svg/>"), "image/svg+xml").expect(415);
    await upload(await png(), "image/jpeg").expect(415);
    await upload((await png()).subarray(0, 30)).expect(422);
    const oversized = await upload(Buffer.alloc(MAX_IMAGE_BYTES + 1)).expect(413);
    expect(oversized.body.error.message).toContain("5 MiB");
    await upload(await png()).set("Content-Encoding", "gzip").expect(415);
    expect(store.reserve).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it("checks edit access before accepting bytes and rechecks during finalization", async () => {
    const first = setup();
    vi.mocked(first.store.assertCanUpload).mockRejectedValue(new HttpError(403, "BOARD_FORBIDDEN", "Read only"));
    await first.upload(await png()).expect(403);
    expect(first.storage.upload).not.toHaveBeenCalled();
    const second = setup();
    vi.mocked(second.store.finalize).mockRejectedValue(new HttpError(403, "BOARD_FORBIDDEN", "Read only"));
    await second.upload(await png()).expect(403);
    expect(second.store.reserve).toHaveBeenCalledOnce();
    expect(second.storage.delete).not.toHaveBeenCalled();
    expect(second.store.finishDelete).not.toHaveBeenCalled();
  });
  it.each(["provider", "database"])("keeps the reservation and hides provider details on %s failure", async (failure) => {
    const { upload, storage, store } = setup();
    if (failure === "provider") vi.mocked(storage.upload).mockRejectedValue(new Error("private_provider_secret"));
    else vi.mocked(store.finalize).mockRejectedValue(new Error("private_database_details"));
    const result = await upload(await png()).expect(503);
    expect(result.body.error.code).toBe("ASSET_UPLOAD_FAILED");
    expect(JSON.stringify(result.body)).not.toContain("private_");
    expect(store.reserve).toHaveBeenCalledOnce();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(store.finishDelete).not.toHaveBeenCalled();
  });
  it("never contacts the provider if durable quota reservation fails", async () => {
    const { store, storage, upload } = setup();
    vi.mocked(store.reserve).mockRejectedValue(new HttpError(507, "ASSET_STORAGE_LIMIT", "Full"));
    await upload(await png()).expect(507);
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it("uses current board access for each short-lived signed read and never exposes internal provider metadata", async () => {
    const { app, store, storage } = setup();
    const result = await request(app).get(`${url}/${assetId}`).set("Cookie", cookie).expect(200);
    expect(store.getForRead).toHaveBeenCalledWith(boardId, assetId, userId);
    expect(result.body.asset.expiresAt).toBeGreaterThan(Date.now() + 298_000);
    expect(result.body.asset.expiresAt).toBeLessThanOrEqual(Date.now() + 300_000);
    expect(result.body.asset.fileId).toBeUndefined();
    expect(result.body.asset.filePath).toBeUndefined();
    vi.mocked(store.getForRead).mockRejectedValue(new HttpError(404, "BOARD_NOT_FOUND", "Board not found"));
    await request(app).get(`${url}/${assetId}`).set("Cookie", cookie).expect(404);
    expect(storage.sign).toHaveBeenCalledOnce();
  });
  it("reports disabled storage and signing failures without provider details", async () => {
    const disabled = setup(false);
    await disabled.upload(await png()).expect(503);
    await request(disabled.app).get(`${url}/${assetId}`).set("Cookie", cookie).expect(503);
    expect(disabled.store.reserve).not.toHaveBeenCalled();
    const ready = setup();
    vi.mocked(ready.storage.sign).mockImplementation(() => { throw new Error("secret"); });
    const response = await request(ready.app).get(`${url}/${assetId}`).set("Cookie", cookie).expect(503);
    expect(response.body.error.code).toBe("ASSET_SIGNING_FAILED");
  });
  it("bounds concurrent uploads for one user before allocating their second body", async () => {
    const { upload, storage } = setup();
    let complete!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { started = resolve; });
    const original = storage.upload;
    vi.mocked(storage.upload).mockImplementationOnce(async (...args) => {
      started(); await new Promise<void>((resolve) => { complete = resolve; }); return original(...args);
    });
    const buffer = await png();
    const first = upload(buffer).then((response) => response);
    await waiting;
    await upload(buffer).expect(429);
    complete();
    expect((await first).status).toBe(201);
    await upload(buffer).expect(201);
  });
});

describe("asset reconciliation", () => {
  it("only releases quota after provider deletion or confirmed absence", async () => {
    const { service, store, storage, asset } = setup();
    const unknown = { ...asset, id: randomUUID(), status: "pending" as const, fileId: null };
    vi.mocked(store.claimAbandoned).mockResolvedValue([asset, unknown]);
    expect(await service.cleanup()).toEqual({ claimed: 2, deleted: 2, deferred: 0 });
    expect(storage.delete).toHaveBeenCalledExactlyOnceWith("test-file");
    expect(storage.find).toHaveBeenCalledExactlyOnceWith(unknown.filePath);
    expect(store.finishDelete).toHaveBeenCalledTimes(2);
  });
  it.each(["find", "delete"] as const)("keeps storage reserved if reconciliation %s fails", async (operation) => {
    const { service, store, storage, asset } = setup();
    vi.mocked(store.claimAbandoned).mockResolvedValue([{ ...asset, fileId: operation === "find" ? null : asset.fileId }]);
    vi.mocked(storage[operation]).mockRejectedValue(new Error("secret"));
    expect(await service.cleanup()).toEqual({ claimed: 1, deleted: 0, deferred: 1 });
    expect(store.finishDelete).not.toHaveBeenCalled();
  });
});

describe("backend cloud document contract", () => {
  it("accepts asset references without widening the guest/browser document schema", () => {
    const input = documentInput();
    const document = { schemaVersion: 1, content: { objects: [...input.content.objects, imageObject()] } };
    expect(cloudDocumentSchema.parse(document)).toEqual(document);
    expect(canvasDocumentSchema.safeParse(document).success).toBe(false);
  });
  it("preserves duplicate, connector, Unicode, order and image-field validation", () => {
    const input = documentInput();
    const image = imageObject();
    const invalid = [
      [image, { ...image, assetId: randomUUID() }],
      [{ ...image, assetId: "local-blob" }], [{ ...image, url: "https://other.test/image" }],
      [{ ...image, name: "bad\0name" }], [{ ...image, originalWidth: 4097 }],
      [image, { ...image, id: "3" }],
      [image, input.content.objects[0]],
    ];
    for (const objects of invalid) expect(cloudDocumentSchema.safeParse({ schemaVersion: 1, content: { objects } }).success).toBe(false);
  });
});
