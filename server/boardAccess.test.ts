import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createBoardStore } from "./boards.js";
import { hashToken, SESSION_COOKIE, type AuthSession, type AuthStore } from "./auth.js";
import { documentInput } from "./testFixtures/document.js";

const owner = { id: randomUUID(), email: "owner@example.com", displayName: null };
const other = { id: randomUUID(), email: "other@example.com", displayName: null };
const token = "a".repeat(43), otherToken = "b".repeat(43);
const cookie = `${SESSION_COOKIE}=${token}`, otherCookie = `${SESSION_COOKIE}=${otherToken}`;

function setup() {
  const sessions = new Map<string, AuthSession>([
    [hashToken(token), { user: owner, expiresAt: Date.now() + 60_000 }],
    [hashToken(otherToken), { user: other, expiresAt: Date.now() + 60_000 }],
  ]);
  const store: AuthStore = {
    getSession: vi.fn(async (value: string) => sessions.get(value)),
    createFlow: vi.fn(), consumeFlow: vi.fn(), signIn: vi.fn(),
    revokeSession: vi.fn(async (value: string) => { sessions.delete(value); }),
  };
  const boards = createBoardStore();
  const get = vi.fn().mockResolvedValue({ status: "document-not-found" });
  const save = vi.fn().mockResolvedValue({ status: "board-not-found" });
  const app = createApp(boards, { get, save }, { store, provider: null, secureCookies: false, frontendUrl: "http://127.0.0.1:5173/scribble/" });
  return { app, boards, store, sessions, get, save };
}

describe("private board HTTP access", () => {
  const id = randomUUID();
  const routes = [
    ["get", "/api/boards"], ["post", "/api/boards"],
    ["get", `/api/boards/${id}`], ["patch", `/api/boards/${id}`], ["delete", `/api/boards/${id}`],
    ["get", `/api/boards/${id}/document`], ["put", `/api/boards/${id}/document`],
  ] as const;

  it.each(routes)("requires authentication for %s %s even without Google configured", async (method, path) => {
    const { app, boards, get, save } = setup();
    const list = vi.spyOn(boards, "list");
    expect((await request(app)[method](path).send({}).expect(401)).body.error.code).toBe("UNAUTHENTICATED");
    expect(get).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  });

  it("fails closed when authentication dependencies are omitted", async () => {
    await request(createApp(createBoardStore())).get("/api/boards").set("Cookie", cookie).expect(401);
  });

  it.each(["bad", `${token}; scribble_session=${otherToken}`, "z".repeat(43)])("rejects malformed, duplicate and unknown sessions: %s", async (value) => {
    const { app } = setup();
    await request(app).get("/api/boards").set("Cookie", `${SESSION_COOKIE}=${value}`).expect(401);
  });

  it("rejects expired and revoked sessions without exposing boards", async () => {
    const { app, sessions } = setup();
    sessions.set(hashToken(token), { user: owner, expiresAt: Date.now() - 1 });
    await request(app).get("/api/boards").set("Cookie", cookie).expect(401);
    sessions.set(hashToken(token), { user: owner, expiresAt: Date.now() + 60_000 });
    await request(app).post("/api/auth/logout").set("Cookie", cookie).set("X-Scribble-Request", "1").expect(204);
    await request(app).get("/api/boards").set("Cookie", cookie).expect(401);
  });

  it("creates server-owned boards and hides them from another account", async () => {
    const { app } = setup();
    const created = await request(app).post("/api/boards").set("Cookie", cookie).set("X-Scribble-Request", "1").send({ title: "Private" }).expect(201);
    const url = created.headers.location;
    expect((await request(app).get("/api/boards").set("Cookie", cookie).expect(200)).body.boards).toEqual([created.body.board]);
    expect((await request(app).get("/api/boards").set("Cookie", otherCookie).expect(200)).body.boards).toEqual([]);
    for (const method of ["get", "patch", "delete"] as const) {
      expect((await request(app)[method](url).set("Cookie", otherCookie).set("X-Scribble-Request", "1").send({ title: "Stolen" }).expect(404)).body.error.code).toBe("BOARD_NOT_FOUND");
    }
    expect((await request(app).get(url).set("Cookie", cookie).expect(200)).body).toEqual(created.body);
    await request(app).post("/api/boards").set("Cookie", cookie).set("X-Scribble-Request", "1").send({ title: "Spoof", ownerId: other.id }).expect(400);
  });

  it.each(["post", "patch", "delete", "put"] as const)("rejects forged %s writes before storage or body parsing", async (method) => {
    const { app, boards, save } = setup();
    const mutate = vi.spyOn(boards, "create");
    const path = method === "post" ? "/api/boards" : `/api/boards/${id}${method === "put" ? "/document" : ""}`;
    const forbidden = [
      {}, { "X-Scribble-Request": "wrong" },
      { "X-Scribble-Request": "1", Origin: "https://evil.example" },
      { "X-Scribble-Request": "1", "Sec-Fetch-Site": "cross-site" },
    ];
    for (const headers of forbidden) {
      expect((await request(app)[method](path).set("Cookie", cookie).set(headers).set("Content-Type", "application/json").send("{").expect(403)).body.error.code).toBe("CSRF_REJECTED");
    }
    expect(mutate).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });

  it("passes only the session owner to document storage with valid same-origin writes", async () => {
    const { app, get, save } = setup();
    const path = `/api/boards/${id}/document`;
    await request(app).get(path).set("Cookie", cookie).expect(404);
    expect(get).toHaveBeenCalledWith(id, owner.id);
    await request(app).put(path).set("Cookie", cookie).set("X-Scribble-Request", "1").set("Origin", "http://127.0.0.1:5173").send(documentInput()).expect(404);
    expect(save).toHaveBeenCalledWith(id, documentInput(), owner.id);
  });
});
