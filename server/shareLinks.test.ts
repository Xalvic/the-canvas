import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createBoardStore } from "./boards.js";
import { hashToken, randomToken, SESSION_COOKIE, type AuthStore } from "./auth.js";
import { createShareLinkCrypto, loadShareLinkKey } from "./shareLinkCrypto.js";
import type { ShareLinkStore } from "./shareLinks.js";
import { HttpError } from "./errors.js";
import type { ProductionDependencies } from "./production.js";

const boardId = randomUUID(), userId = randomUUID(), sessionToken = randomToken();
const cookie = `${SESSION_COOKIE}=${sessionToken}`;
const settings = { enabled: false, role: "viewer" as const, generation: 0, version: 0 };
function setup(supported = true, production?: ProductionDependencies) {
  const auth: AuthStore = {
    getSession: vi.fn(async (digest: string) => digest === hashToken(sessionToken) ? { user: { id: userId, email: "owner@example.com", displayName: null }, expiresAt: Date.now() + 60_000 } : undefined),
    createFlow: vi.fn(), consumeFlow: vi.fn(), signIn: vi.fn(), revokeSession: vi.fn(),
  };
  const links: ShareLinkStore = {
    get: vi.fn().mockResolvedValue(settings),
    copy: vi.fn().mockResolvedValue({ settings: { ...settings, enabled: true, generation: 1, version: 1 }, token: randomToken(), requestId: randomUUID(), replayed: false }),
    update: vi.fn().mockResolvedValue({ settings, requestId: randomUUID(), replayed: false }),
    open: vi.fn().mockResolvedValue({ id: boardId, title: "Shared", role: "viewer", createdAt: 1, updatedAt: 1 }),
  };
  const app = createApp(createBoardStore(), undefined, { store: auth, provider: null, frontendUrl: "http://127.0.0.1:5173/scribble/", secureCookies: false }, undefined, undefined, undefined, production, undefined, supported ? links : undefined);
  return { app, links, auth };
}
const routes = [
  ["get", `/api/boards/${boardId}/share-link`],
  ["post", `/api/boards/${boardId}/share-link/copy`],
  ["patch", `/api/boards/${boardId}/share-link`],
  ["post", "/api/share-links/open"],
] as const;

describe("share-link security and API contract", () => {
  it.each(routes)("requires a session and fences account changes before %s %s", async (method, path) => {
    const { app, links } = setup();
    await request(app)[method](path).send({}).expect(401);
    const changed = await request(app)[method](path).set("Cookie", cookie).set("X-Scribble-Account", randomUUID()).set("X-Scribble-Request", "1").set("Content-Type", "application/json").send("{").expect(409);
    expect(changed.body.error.code).toBe("ACCOUNT_CHANGED");
    for (const call of Object.values(links)) expect(call).not.toHaveBeenCalled();
  });
  it.each(routes.filter(([method]) => method !== "get"))("requires CSRF and origin verification on %s %s", async (method, path) => {
    const { app, links } = setup();
    await request(app)[method](path).set("Cookie", cookie).send({}).expect(403);
    await request(app)[method](path).set("Cookie", cookie).set("X-Scribble-Request", "1").set("Origin", "https://hostile.example").send({}).expect(403);
    await request(app)[method](path).set("Cookie", cookie).set("X-Scribble-Request", "1").set("Sec-Fetch-Site", "cross-site").send({}).expect(403);
    for (const call of Object.values(links)) expect(call).not.toHaveBeenCalled();
  });
  it("advertises only configured support and fails usefully when disabled", async () => {
    const enabled = setup(), disabled = setup(false);
    expect((await request(enabled.app).get("/api/auth/me").set("Cookie", cookie)).body.capabilities.shareLinks).toBe(1);
    expect((await request(disabled.app).get("/api/auth/me").set("Cookie", cookie)).body.capabilities.shareLinks).toBeUndefined();
    expect((await request(enabled.app).get("/api/auth/me").expect(401)).body.error.details.shareLinksEnabled).toBe(true);
    for (const [method, path] of routes) {
      const response = await request(disabled.app)[method](path).set("Cookie", cookie).set("X-Scribble-Request", "1").send({}).expect(503);
      expect(response.body.error.code).toBe("SHARE_LINKS_UNSUPPORTED");
    }
  });
  it("normalizes stable mutation IDs and rejects ambiguous settings or extra fields", async () => {
    const { app, links } = setup(), requestId = randomUUID();
    const url = `/api/boards/${boardId}/share-link`;
    await request(app).post(`${url}/copy`).set("Cookie", cookie).set("X-Scribble-Request", "1").send({ requestId: requestId.toUpperCase(), expectedVersion: 0 }).expect(200);
    expect(links.copy).toHaveBeenCalledWith(boardId, userId, { requestId, expectedVersion: 0 });
    for (const extra of [{ enabled: true }, { enabled: false, role: "editor" }, { role: "owner" }, { role: "viewer", ownerId: userId }, { expectedVersion: -1, role: "viewer" }]) {
      await request(app).patch(url).set("Cookie", cookie).set("X-Scribble-Request", "1").send({ requestId, expectedVersion: 0, ...extra }).expect(400);
    }
    expect(links.update).not.toHaveBeenCalled();
  });
  it("bounds token parsing and request bodies without echoing secret values", async () => {
    const { app, links } = setup();
    for (const body of [{ token: "secret-invalid" }, { token: randomToken(), userId }, { token: randomToken(), boardId }]) {
      const response = await request(app).post("/api/share-links/open").set("Cookie", cookie).set("X-Scribble-Request", "1").send(body).expect(400);
      expect(JSON.stringify(response.body).includes(body.token)).toBe(false);
    }
    await request(app).post("/api/share-links/open").set("Cookie", cookie).set("X-Scribble-Request", "1").send({ token: "a".repeat(17_000) }).expect(413);
    await request(app).post("/api/share-links/open").set("Cookie", cookie).set("X-Scribble-Request", "1").set("Content-Type", "text/plain").send("token").expect(415);
    expect(links.open).not.toHaveBeenCalled();
  });
  it("returns authenticated join metadata with no-store and no-referrer", async () => {
    const { app, links } = setup(), token = randomToken();
    const response = await request(app).post("/api/share-links/open").set("Cookie", cookie).set("X-Scribble-Request", "1").send({ token }).expect(200);
    expect(links.open).toHaveBeenCalledWith(token, userId);
    expect(response.body.board.role).toBe("viewer");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });
  it("enforces production link budgets and redacts token-bearing route logs", async () => {
    const consume = vi.fn().mockImplementation(async (scope: string) => ({ allowed: scope !== "share-links", retryAfter: 12 }));
    const log = vi.fn();
    const { app, links } = setup(true, { budgets: { consume }, proxySecret: "test-proxy", ready: async () => {}, log });
    const token = randomToken();
    const response = await request(app).post("/api/share-links/open").set("Cookie", cookie).set("X-Scribble-Request", "1").set("X-Scribble-Proxy-Secret", "test-proxy").set("X-Scribble-Client-IP", "127.0.0.1").send({ token }).expect(429);
    expect(response.headers["retry-after"]).toBe("12");
    expect(consume).toHaveBeenCalledWith("share-links", userId, 60, 60);
    expect(links.open).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ route: "share-links", status: 429 }));
    expect(JSON.stringify(log.mock.calls).includes(token)).toBe(false);
  });
  it("bounds development link attempts", async () => {
    const { app, links } = setup();
    vi.mocked(links.open).mockRejectedValue(new HttpError(404, "SHARE_LINK_UNAVAILABLE", "This shared page is unavailable"));
    for (let index = 0; index < 60; index++) await request(app).post("/api/share-links/open").set("Cookie", cookie).set("X-Scribble-Request", "1").send({ token: randomToken() }).expect(404);
    const response = await request(app).post("/api/share-links/open").set("Cookie", cookie).set("X-Scribble-Request", "1").send({ token: randomToken() }).expect(429);
    expect(response.body.error.code).toBe("SHARE_LINK_RATE_LIMIT");
    expect(links.open).toHaveBeenCalledTimes(60);
  });
});

describe("recoverable share-link secrets", () => {
  it("keeps the active token recoverable across instances with randomized ciphertext", () => {
    const key = randomBytes(32), token = randomToken(), generation = 1;
    const crypto = createShareLinkCrypto(key), encrypted = crypto.protect(token, boardId, generation);
    expect(encrypted.includes(token)).toBe(false);
    expect(crypto.protect(token, boardId, generation) !== encrypted).toBe(true);
    expect(createShareLinkCrypto(key).recover(encrypted, hashToken(token), boardId, generation) === token).toBe(true);
  });
  it("authenticates board, generation, digest, key and encrypted bytes with safe errors", () => {
    const key = randomBytes(32), token = randomToken(), crypto = createShareLinkCrypto(key);
    const encrypted = crypto.protect(token, boardId, 1), digest = hashToken(token);
    const calls = [
      () => crypto.recover(encrypted, digest, randomUUID(), 1),
      () => crypto.recover(encrypted, digest, boardId, 2),
      () => crypto.recover(encrypted, hashToken(randomToken()), boardId, 1),
      () => createShareLinkCrypto(randomBytes(32)).recover(encrypted, digest, boardId, 1),
      () => crypto.recover(`${encrypted[0] === "0" ? "1" : "0"}${encrypted.slice(1)}`, digest, boardId, 1),
    ];
    for (const call of calls) expect(call).toThrow(expect.objectContaining({ code: "SHARE_LINK_KEY_UNAVAILABLE" }));
  });
  it("validates optional configuration without printing rejected keys", () => {
    expect(loadShareLinkKey({})).toBeNull();
    expect(loadShareLinkKey({ SHARE_LINK_KEY: "ab".repeat(32) })?.length).toBe(32);
    const secret = "private-invalid-value";
    try { loadShareLinkKey({ SHARE_LINK_KEY: secret }); throw new Error("Accepted invalid key"); }
    catch (error) { expect(String(error).includes(secret)).toBe(false); }
    expect(() => createShareLinkCrypto(Buffer.alloc(31))).toThrow("32-byte");
  });
});
