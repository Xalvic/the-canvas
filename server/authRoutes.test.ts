import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createBoardStore } from "./boards.js";
import { FLOW_COOKIE, SESSION_COOKIE, hashToken, randomToken, type AuthSession, type GoogleFlow } from "./auth.js";
import type { AuthDependencies } from "./authRoutes.js";

afterEach(() => vi.restoreAllMocks());
const frontendUrl = "http://127.0.0.1:5173/scribble/";
const identity = { subject: "google-account-1", email: "artist@example.com", displayName: "Artist" };

function setup(secureCookies = false) {
  const flows = new Map<string, GoogleFlow>();
  const sessions = new Map<string, AuthSession>();
  const user = { id: randomUUID(), email: identity.email, displayName: identity.displayName };
  const auth: AuthDependencies = {
    frontendUrl, secureCookies,
    store: {
      createFlow: vi.fn(async (flow) => { flows.set(flow.stateHash, flow); }),
      consumeFlow: vi.fn(async (stateHash, browserHash) => {
        const flow = flows.get(stateHash);
        if (!flow || flow.browserHash !== browserHash) return undefined;
        flows.delete(stateHash); return { nonce: flow.nonce, codeVerifier: flow.codeVerifier };
      }),
      signIn: vi.fn(async (_identity, tokenHash, previous) => {
        if (previous) sessions.delete(previous);
        const session = { user, expiresAt: Date.now() + 7 * 86400000 };
        sessions.set(tokenHash, session); return session;
      }),
      getSession: vi.fn(async (hash) => sessions.get(hash)),
      revokeSession: vi.fn(async (hash) => { sessions.delete(hash); }),
    },
    provider: {
      authorizationUrl: vi.fn((flow) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(flow)}`),
      verifyCode: vi.fn(async () => identity),
    },
  };
  const app = createApp(createBoardStore(), undefined, auth);
  return { auth, app, flows, sessions, user };
}
function cookie(response: request.Response, name: string) {
  return (response.headers["set-cookie"] as unknown as string[]).find((value) => value.startsWith(`${name}=`))!;
}
async function begin(agent: ReturnType<typeof request.agent>) {
  const response = await agent.get("/api/auth/google").expect(302);
  return { response, state: new URL(response.headers.location).searchParams.get("state")! };
}

describe("Google-only session HTTP", () => {
  it("echoes a deliberate client flow only from a successful browser-paired OAuth attempt", async () => {
    const { app } = setup(); const agent = request.agent(app); const clientFlow = randomUUID();
    const start = await agent.get("/api/auth/google").query({ clientFlow }).expect(302);
    const header = cookie(start, "scribble_google_client_flow");
    expect(header).toContain("HttpOnly"); expect(header).toContain("Max-Age=600");
    const state = new URL(start.headers.location).searchParams.get("state");
    const callback = await agent.get("/api/auth/google/callback").query({ state, code: "verified" }).expect(303);
    expect(callback.headers.location).toBe(`${frontendUrl}?authFlow=${clientFlow}`);
    expect(cookie(callback, "scribble_google_client_flow")).toContain("Expires=Thu, 01 Jan 1970");
  });
  it("clears stale client flow on ordinary sign-in and never echoes it on a denied callback", async () => {
    const { app } = setup(); const agent = request.agent(app);
    const start = await agent.get("/api/auth/google").query({ clientFlow: randomUUID() }).expect(302);
    const state = new URL(start.headers.location).searchParams.get("state");
    const callback = await agent.get("/api/auth/google/callback").query({ state, error: "access_denied" }).expect(303);
    expect(callback.headers.location).toBe(`${frontendUrl}?authError=denied`);
    const ordinary = await begin(agent);
    expect(cookie(ordinary.response, "scribble_google_client_flow")).toContain("Expires=Thu, 01 Jan 1970");
  });
  it("rejects malformed client flow IDs and ignores unpaired flow cookies", async () => {
    const { app, auth } = setup();
    await request(app).get("/api/auth/google").query({ clientFlow: "bad" }).expect(400);
    expect(auth.store.createFlow).not.toHaveBeenCalled();
    const start = await begin(request.agent(app));
    const callback = await request(app).get("/api/auth/google/callback").query({ state: start.state, code: "verified" })
      .set("Cookie", `${cookie(start.response, FLOW_COOKIE).split(";")[0]}; scribble_google_client_flow=${randomToken()}.${randomUUID()}`).expect(303);
    expect(callback.headers.location).toBe(frontendUrl);
  });
  it("keeps account availability explicit and protects server boards when Google is unconfigured", async () => {
    const app = createApp(createBoardStore());
    for (const path of ["/api/auth/google", "/api/auth/google/callback"]) {
      expect((await request(app).get(path).expect(503)).body.error.code).toBe("GOOGLE_AUTH_NOT_CONFIGURED");
    }
    expect((await request(app).get("/api/auth/me").expect(401)).body.error.details.googleSignInEnabled).toBe(false);
    await request(app).get("/api/boards").expect(401);
    await request(app).post("/api/auth/logout").set("X-Scribble-Request", "1").expect(204);
  });

  it("binds fresh state/nonce/PKCE to an HttpOnly short-lived browser cookie, storing only hashes for state/browser", async () => {
    const { app, flows, auth } = setup(true);
    const response = await request(app).get("/api/auth/google").expect(302);
    const url = new URL(response.headers.location);
    const state = url.searchParams.get("state")!;
    const flow = flows.get(hashToken(state))!;
    expect(state).toMatch(/^[\w-]{43}$/);
    expect(flow.nonce).toBe(url.searchParams.get("nonce"));
    expect(flow.codeVerifier).not.toBe(url.searchParams.get("codeChallenge"));
    const header = cookie(response, FLOW_COOKIE);
    expect(header).toContain("HttpOnly"); expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax"); expect(header).toContain("Path=/api/auth/google");
    expect(header).toContain("Max-Age=600");
    expect(auth.store.createFlow).toHaveBeenCalledTimes(1);
    expect(flow.browserHash).toBe(hashToken(header.split(";")[0].split("=")[1]));
  });

  it("sets an opaque session only after verified Google identity and exposes a safe current-user response", async () => {
    const { app, user, auth, sessions } = setup();
    const agent = request.agent(app);
    const { state } = await begin(agent);
    const response = await agent.get("/api/auth/google/callback").query({ state, code: "verified-code" }).expect(303);
    expect(response.headers.location).toBe(frontendUrl);
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    const header = cookie(response, SESSION_COOKIE);
    const token = header.split(";")[0].split("=")[1];
    expect(header).toContain("HttpOnly"); expect(header).toContain("SameSite=Lax"); expect(header).toContain("Path=/api;");
    expect(sessions.has(token)).toBe(false); expect(sessions.has(hashToken(token))).toBe(true);
    expect(auth.provider!.verifyCode).toHaveBeenCalledExactlyOnceWith("verified-code", expect.objectContaining({ nonce: expect.any(String), codeVerifier: expect.any(String) }));
    expect((await agent.get("/api/auth/me").expect(200)).body).toEqual({ user, capabilities: { guestTransfer: 1 } });
    expect((await request(app).get("/api/auth/me").expect(401)).body.error.details.googleSignInEnabled).toBe(true);
  });

  it("rejects another browser's state without consuming the legitimate flow, then rejects replay", async () => {
    const { app, auth } = setup();
    const legitimate = request.agent(app), other = request.agent(app);
    const first = await begin(legitimate); await begin(other);
    const wrong = await other.get("/api/auth/google/callback").query({ state: first.state, code: "stolen" }).expect(303);
    expect(wrong.headers.location).toContain("authError=invalid_state");
    expect(auth.provider!.verifyCode).not.toHaveBeenCalled();
    await legitimate.get("/api/auth/google/callback").query({ state: first.state, code: "verified-code" }).expect(303);
    const replay = await request(app).get("/api/auth/google/callback").set("Cookie", cookie(first.response, FLOW_COOKIE).split(";")[0]).query({ state: first.state, code: "replay" }).expect(303);
    expect(replay.headers.location).toContain("authError=invalid_state");
    expect(auth.provider!.verifyCode).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { state: "bad", code: "code" }, { state: randomToken(), code: ["a", "b"] }, { state: randomToken(), code: "a", error: "b" }])("rejects malformed callback %j", async (query) => {
    const { app, auth } = setup();
    const response = await request(app).get("/api/auth/google/callback").query(query).expect(303);
    expect(response.headers.location).toContain("authError=invalid_state");
    expect(auth.store.signIn).not.toHaveBeenCalled(); expect(auth.provider!.verifyCode).not.toHaveBeenCalled();
  });

  it("handles denied consent and failed verification without exposing provider errors or changing sessions", async () => {
    const { app, auth, sessions } = setup();
    const agent = request.agent(app);
    let start = await begin(agent);
    expect((await agent.get("/api/auth/google/callback").query({ state: start.state, error: "access_denied" }).expect(303)).headers.location).toContain("authError=denied");
    expect(auth.provider!.verifyCode).not.toHaveBeenCalled();
    start = await begin(agent);
    vi.mocked(auth.provider!.verifyCode).mockRejectedValue(new Error("SECRET_GOOGLE_TOKEN"));
    const log = vi.spyOn(console, "error");
    const failed = await agent.get("/api/auth/google/callback").query({ state: start.state, code: "private-code" }).expect(303);
    expect(failed.headers.location).toBe(`${frontendUrl}?authError=failed`);
    expect(log).not.toHaveBeenCalled(); expect(auth.store.signIn).not.toHaveBeenCalled(); expect(sessions.size).toBe(0);
  });

  it("rotates an existing session and revokes only this browser's session on logout", async () => {
    const { app, sessions } = setup();
    const agent = request.agent(app), other = request.agent(app);
    let start = await begin(agent);
    const first = await agent.get("/api/auth/google/callback").query({ state: start.state, code: "code" }).expect(303);
    start = await begin(other);
    await other.get("/api/auth/google/callback").query({ state: start.state, code: "code" }).expect(303);
    start = await begin(agent);
    const next = await agent.get("/api/auth/google/callback").query({ state: start.state, code: "code" }).expect(303);
    expect(cookie(next, SESSION_COOKIE)).not.toBe(cookie(first, SESSION_COOKIE)); expect(sessions.size).toBe(2);
    await request(app).get("/api/auth/me").set("Cookie", cookie(first, SESSION_COOKIE).split(";")[0]).expect(401);
    await agent.post("/api/auth/logout").set("X-Scribble-Request", "1").set("Origin", "http://127.0.0.1:5173").expect(204);
    await agent.get("/api/auth/me").expect(401); await other.get("/api/auth/me").expect(200);
    await agent.post("/api/auth/logout").set("X-Scribble-Request", "1").expect(204);
  });

  it("blocks forged logout forms, cross-site metadata and hostile origins before revocation", async () => {
    const { app, auth } = setup();
    await request(app).post("/api/auth/logout").expect(403);
    await request(app).post("/api/auth/logout").set("X-Scribble-Request", "1").set("Origin", "https://evil.example").expect(403);
    await request(app).post("/api/auth/logout").set("X-Scribble-Request", "1").set("Sec-Fetch-Site", "cross-site").expect(403);
    expect(auth.store.revokeSession).not.toHaveBeenCalled();
  });

  it("ignores malformed/duplicate session cookies and clears missing/expired sessions", async () => {
    const { app, auth } = setup();
    for (const value of [`${SESSION_COOKIE}=%oops`, `${SESSION_COOKIE}=${randomToken()}; ${SESSION_COOKIE}=${randomToken()}`]) {
      await request(app).get("/api/auth/me").set("Cookie", value).expect(401);
    }
    expect(auth.store.getSession).not.toHaveBeenCalled();
    const expired = await request(app).get("/api/auth/me").set("Cookie", `${SESSION_COOKIE}=${randomToken()}`).expect(401);
    expect(cookie(expired, SESSION_COOKIE)).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("limits repeated sign-in starts before writing more pending flows", async () => {
    const { app, auth } = setup();
    for (let i = 0; i < 20; i++) await request(app).get("/api/auth/google").expect(302);
    const response = await request(app).get("/api/auth/google").expect(429);
    expect(response.body.error.code).toBe("AUTH_RATE_LIMIT"); expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
    expect(auth.store.createFlow).toHaveBeenCalledTimes(20);
  });
});
