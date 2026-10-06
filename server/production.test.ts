import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createBoardStore } from "./boards.js";
import { SESSION_COOKIE, randomToken, hashToken } from "./auth.js";
import type { AuthDependencies } from "./authRoutes.js";
import { checkReady, type ProductionDependencies } from "./production.js";

function setup() {
  const token = randomToken(), user = { id: randomUUID(), email: "private@example.com", displayName: "Private Name" };
  const auth: AuthDependencies = {
    frontendUrl: "https://scribble.example/scribble/", secureCookies: true, provider: null,
    store: { createFlow: vi.fn(), consumeFlow: vi.fn(), signIn: vi.fn(), revokeSession: vi.fn(),
      getSession: vi.fn(async (value) => value === hashToken(token) ? { user, expiresAt: Date.now() + 60_000 } : undefined) },
  };
  const production: ProductionDependencies = {
    proxySecret: "s".repeat(48), ready: vi.fn(async () => {}), log: vi.fn(),
    budgets: { consume: vi.fn(async () => ({ allowed: true, retryAfter: 60 })) },
  };
  const app = createApp(createBoardStore(), undefined, auth, undefined, undefined, undefined, production);
  function proxy(test: request.Test) { return test.set("X-Scribble-Proxy-Secret", production.proxySecret).set("X-Scribble-Client-IP", "203.0.113.10"); }
  return { app, auth, production, proxy, user, token };
}
describe("production origin and admission", () => {
  it("keeps health quiet and reports sanitized readiness failures", async () => {
    const { app, production, proxy } = setup();
    await request(app).get("/health").expect(200).expect("Cache-Control", "no-store");
    await request(app).get("/ready").expect(403);
    await proxy(request(app).get("/ready")).expect(200, { status: "ready" });
    vi.mocked(production.ready).mockRejectedValue(new Error("secret-database-url"));
    await proxy(request(app).get("/ready")).expect(503, { status: "unavailable" });
    expect(production.log).not.toHaveBeenCalled();
    expect(production.budgets.consume).not.toHaveBeenCalled();
  });
  it("bounds readiness waiting independently of a stalled database callback", async () => {
    await expect(checkReady(() => new Promise(() => {}), 20)).rejects.toThrow("Readiness deadline");
  });
  it("rejects direct callers and forged forwarding headers before accessing sessions or budgets", async () => {
    const { app, auth, production } = setup();
    for (const value of [undefined, "wrong", "s".repeat(47)]) {
      const test = request(app).get("/api/boards").set("X-Forwarded-For", "203.0.113.10").set("X-Scribble-Client-IP", "203.0.113.10");
      if (value) test.set("X-Scribble-Proxy-Secret", value);
      expect((await test.expect(403)).body.error.code).toBe("PROXY_REQUIRED");
    }
    await request(app).get("/api/boards").set("X-Scribble-Proxy-Secret", production.proxySecret).set("X-Scribble-Client-IP", "forged, 203.0.113.10").expect(403);
    expect(auth.store.getSession).not.toHaveBeenCalled();
    expect(production.budgets.consume).not.toHaveBeenCalled();
  });
  it("enforces authenticated read and write budgets and keeps trusted IP independent of forwarded headers", async () => {
    const { app, production, proxy, user, token } = setup();
    await proxy(request(app).get("/api/boards")).set("Cookie", `${SESSION_COOKIE}=${token}`).set("X-Forwarded-For", "192.0.2.55").expect(200);
    expect(production.budgets.consume).toHaveBeenCalledWith("api-ip", "203.0.113.10", 2400, 60);
    expect(production.budgets.consume).toHaveBeenCalledWith("user-read", user.id, 1200, 60);
    vi.mocked(production.budgets.consume).mockImplementation(async (scope) => ({ allowed: scope !== "user-write", retryAfter: 17 }));
    expect((await proxy(request(app).post("/api/boards")).set("Cookie", `${SESSION_COOKIE}=${token}`).set("X-Scribble-Request", "1").send({ title: "Never written", requestId: randomUUID(), initializeDocument: true }).expect(429).expect("Retry-After", "17")).body.error.code).toBe("REQUEST_RATE_LIMIT");
    expect((await proxy(request(app).get("/api/boards")).set("Cookie", `${SESSION_COOKIE}=${token}`).expect(200)).body.boards).toEqual([]);
  });
  it("limits OAuth starts/callbacks with matching route classes and fails closed if admission is unavailable", async () => {
    const { app, production, proxy } = setup();
    await proxy(request(app).get("/API/Auth/Google")).expect(503);
    expect(production.budgets.consume).toHaveBeenCalledWith("auth-start", "203.0.113.10", 20, 600);
    await proxy(request(app).get("/api/auth/google/callback?code=PRIVATE" )).expect(503);
    expect(production.budgets.consume).toHaveBeenCalledWith("auth-callback", "203.0.113.10", 40, 600);
    vi.mocked(production.budgets.consume).mockRejectedValue(new Error("password and database location"));
    expect((await proxy(request(app).get("/api/auth/me")).expect(503)).body.error.code).toBe("ADMISSION_UNAVAILABLE");
  });
  it("applies the same user budgets to session reads/logout without disclosing or changing sessions after denial", async () => {
    const { app, auth, production, proxy, user, token } = setup();
    await proxy(request(app).get("/api/auth/me")).set("Cookie", `${SESSION_COOKIE}=${token}`).expect(200);
    expect(production.budgets.consume).toHaveBeenCalledWith("user-read", user.id, 1200, 60);
    vi.mocked(production.budgets.consume).mockImplementation(async (scope) => ({ allowed: scope !== "user-write", retryAfter: 12 }));
    await proxy(request(app).post("/api/auth/logout")).set("Cookie", `${SESSION_COOKIE}=${token}`).set("X-Scribble-Request", "1").expect(429).expect("Retry-After", "12");
    expect(auth.store.revokeSession).not.toHaveBeenCalled();
  });
  it("logs only bounded route categories and fresh generated IDs, excluding cookies, board IDs, and queries", async () => {
    const { app, production, proxy } = setup();
    const boardId = randomUUID();
    const response = await proxy(request(app).get(`/api/boards/${boardId}?signed_url=SECRET`)).set("Cookie", "private-cookie").set("X-Request-Id", "ATTACKER-CONTROLLED").expect(401);
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(production.log).toHaveBeenCalledWith({ event: "request", requestId: response.headers["x-request-id"], method: "GET", route: "boards", status: 401, durationMs: expect.any(Number) });
    const logs = JSON.stringify(vi.mocked(production.log!).mock.calls);
    for (const privateValue of [boardId, "SECRET", "private-cookie", "ATTACKER-CONTROLLED", "203.0.113.10"]) expect(logs).not.toContain(privateValue);
  });
});
