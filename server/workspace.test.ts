import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createBoardStore } from "./boards.js";
import { hashToken, SESSION_COOKIE } from "./auth.js";
import type { AuthDependencies } from "./authRoutes.js";
import type { ProductionDependencies } from "./production.js";
import { HttpError } from "./errors.js";
import { createAuthenticatedApp, TEST_OWNER_ID } from "./testFixtures/authenticatedApp.js";
import type { WorkspaceStore } from "./workspace.js";

function setup() {
  const workspace = { initialized: true, lastOpenedBoardId: null };
  const input = { requestId: randomUUID(), createInitialPage: true };
  const result = { workspace, board: null, initialization: { requestId: input.requestId, replayed: false, initializedNow: true } };
  const store = {
    get: vi.fn<WorkspaceStore["get"]>().mockResolvedValue(workspace),
    update: vi.fn<WorkspaceStore["update"]>().mockResolvedValue(workspace),
    initialize: vi.fn<WorkspaceStore["initialize"]>().mockResolvedValue(result),
  };
  return { store, input, workspace, result, app: createAuthenticatedApp(createBoardStore(), undefined, TEST_OWNER_ID, store) };
}

describe("workspace HTTP contract", () => {
  it("returns no-store state without initialization and passes the authenticated actor", async () => {
    const { app, store, workspace } = setup();
    await request(app).get("/api/workspace").expect(200, { workspace }).expect("Cache-Control", "no-store");
    expect(store.get).toHaveBeenCalledExactlyOnceWith(TEST_OWNER_ID);
    expect(store.initialize).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled();
  });
  it.each([true, false])("normalizes a stable initialization UUID, including import mode %s", async (createInitialPage) => {
    const { app, store, input, result } = setup();
    await request(app).post("/api/workspace/initialize").send({ ...input, requestId: input.requestId.toUpperCase(), createInitialPage }).expect(200, result);
    expect(store.initialize).toHaveBeenCalledExactlyOnceWith({ ...input, createInitialPage }, TEST_OWNER_ID);
  });
  it.each([{}, { createInitialPage: true }, { requestId: randomUUID() }, { requestId: "bad", createInitialPage: true },
    { requestId: randomUUID(), createInitialPage: "false" }, { requestId: randomUUID(), createInitialPage: null },
    { requestId: randomUUID(), createInitialPage: true, ownerId: randomUUID() }])("rejects invalid initialization %j", async (body) => {
    const { app, store } = setup();
    expect((await request(app).post("/api/workspace/initialize").send(body).expect(400)).body.error.code).toBe("VALIDATION_ERROR");
    expect(store.initialize).not.toHaveBeenCalled();
  });
  it.each([null, "ABCDEFAB-1234-4123-8123-ABCDEFABCDEF"])("updates only a nullable page preference %s", async (id) => {
    const { app, store } = setup();
    await request(app).patch("/api/workspace").send({ lastOpenedBoardId: id }).expect(200);
    expect(store.update).toHaveBeenCalledExactlyOnceWith({ lastOpenedBoardId: id?.toLowerCase() ?? null }, TEST_OWNER_ID);
  });
  it.each([{}, { lastOpenedBoardId: "" }, { lastOpenedBoardId: 1 }, { lastOpenedBoardId: null, initialized: true }])("rejects invalid state updates %j", async (body) => {
    const { app, store } = setup();
    await request(app).patch("/api/workspace").send(body).expect(400);
    expect(store.update).not.toHaveBeenCalled();
  });
  it.each([[404, "BOARD_NOT_FOUND"], [409, "WORKSPACE_INITIALIZATION_CONFLICT"]] as const)("keeps storage errors %s %s", async (status, code) => {
    const { app, store, input } = setup();
    store.initialize.mockRejectedValue(new HttpError(status, code, "Workspace request failed"));
    expect((await request(app).post("/api/workspace/initialize").send(input).expect(status)).body.error).toEqual({ code, message: "Workspace request failed" });
  });
  it.each(["post", "patch"] as const)("uses the metadata parser and media guard for %s", async (method) => {
    const { app, store } = setup(), path = method === "post" ? "/api/workspace/initialize" : "/api/workspace";
    await request(app)[method](path).set("Content-Type", "text/plain").send("{}").expect(415);
    await request(app)[method](path).set("Content-Type", "application/json").send("{").expect(400);
    await request(app)[method](path).send({ padding: "x".repeat(17_000) }).expect(413);
    expect(store.initialize).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled();
  });
  it("fails closed when the durable workspace store is unavailable", async () => {
    const app = createAuthenticatedApp(createBoardStore());
    for (const [method, path] of [["get", "/api/workspace"], ["patch", "/api/workspace"], ["post", "/api/workspace/initialize"]] as const) {
      expect((await request(app)[method](path).send({}).expect(503)).body.error.code).toBe("WORKSPACE_UNAVAILABLE");
    }
  });
});

describe("workspace protection ordering", () => {
  function protectedApp() {
    const { store } = setup(), token = "w".repeat(43);
    const auth: AuthDependencies = {
      frontendUrl: "https://scribble.example/scribble/", secureCookies: true, provider: null,
      store: { getSession: vi.fn(async (value) => value === hashToken(token) ? {
        user: { id: TEST_OWNER_ID, email: "owner@example.com", displayName: null }, expiresAt: Date.now() + 60_000,
      } : undefined), createFlow: vi.fn(), consumeFlow: vi.fn(), signIn: vi.fn(), revokeSession: vi.fn() },
    };
    const production: ProductionDependencies = { proxySecret: "s".repeat(48), ready: vi.fn(), log: vi.fn(),
      budgets: { consume: vi.fn(async () => ({ allowed: true, retryAfter: 60 })) } };
    const app = createApp(createBoardStore(), undefined, auth, undefined, undefined, undefined, production, store);
    const proxy = (test: request.Test) => test.set("X-Scribble-Proxy-Secret", production.proxySecret).set("X-Scribble-Client-IP", "203.0.113.10");
    const cookie = `${SESSION_COOKIE}=${token}`;
    return { app, store, auth, production, proxy, cookie };
  }
  it.each([["get", "/api/workspace"], ["patch", "/api/workspace"], ["post", "/api/workspace/initialize"]] as const)("guards proxy and session before %s %s parsing/storage", async (method, path) => {
    const { app, store, auth, proxy } = protectedApp();
    await request(app)[method](path).set("Content-Type", "application/json").send("{").expect(403);
    expect(auth.store.getSession).not.toHaveBeenCalled();
    await proxy(request(app)[method](path)).set("Content-Type", "application/json").send("{").expect(401);
    expect(store.get).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled(); expect(store.initialize).not.toHaveBeenCalled();
  });
  it.each(["post", "patch"] as const)("rejects forged %s requests before parsing/storage", async (method) => {
    const { app, store, proxy, cookie } = protectedApp(), path = method === "post" ? "/api/workspace/initialize" : "/api/workspace";
    for (const headers of [{}, { "X-Scribble-Request": "1", Origin: "https://evil.example" }, { "X-Scribble-Request": "1", "Sec-Fetch-Site": "cross-site" }]) {
      expect((await proxy(request(app)[method](path)).set("Cookie", cookie).set(headers).set("Content-Type", "application/json").send("{").expect(403)).body.error.code).toBe("CSRF_REJECTED");
    }
    expect(store.initialize).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled();
  });
  it("applies read/write budgets, Retry-After and privacy-safe workspace log classification", async () => {
    const { app, store, production, proxy, cookie } = protectedApp();
    await proxy(request(app).get("/API/Workspace")).set("Cookie", cookie).expect(200);
    expect(production.budgets.consume).toHaveBeenCalledWith("user-read", TEST_OWNER_ID, 1200, 60);
    expect(production.log).toHaveBeenCalledWith(expect.objectContaining({ route: "workspace", status: 200 }));
    vi.mocked(production.budgets.consume).mockImplementation(async (scope) => ({ allowed: scope !== "user-write", retryAfter: 17 }));
    for (const [method, path] of [["post", "/api/workspace/initialize"], ["patch", "/api/workspace"]] as const) {
      await proxy(request(app)[method](path)).set("Cookie", cookie).set("X-Scribble-Request", "1").send({}).expect(429).expect("Retry-After", "17");
    }
    expect(production.budgets.consume).toHaveBeenCalledWith("user-write", TEST_OWNER_ID, 900, 60);
    expect(store.initialize).not.toHaveBeenCalled(); expect(store.update).not.toHaveBeenCalled();
    vi.mocked(production.budgets.consume).mockRejectedValue(new Error("private database failure"));
    expect((await proxy(request(app).get("/api/workspace")).set("Cookie", cookie).expect(503)).body.error.code).toBe("ADMISSION_UNAVAILABLE");
    expect(store.get).toHaveBeenCalledTimes(1);
  });
  it("rejects expired sessions and missing auth dependencies", async () => {
    const { app, auth, proxy, cookie, store } = protectedApp();
    vi.mocked(auth.store.getSession).mockResolvedValue({ user: { id: TEST_OWNER_ID, email: "owner@example.com", displayName: null }, expiresAt: 0 });
    await proxy(request(app).get("/api/workspace")).set("Cookie", cookie).expect(401);
    await request(createApp(createBoardStore())).get("/api/workspace").set("Cookie", cookie).expect(401);
    expect(store.get).not.toHaveBeenCalled();
  });
});
