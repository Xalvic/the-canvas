import { randomUUID } from "node:crypto";
import express, { type Response } from "express";
import type { Server } from "node:http";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createBoardStore } from "./boards.js";
import { documentInput } from "./testFixtures/document.js";
import { collaborationOperationSchema, presenceSchema } from "./contracts/collaboration.js";
import { CollaborationPresence, createCollaborationRouter } from "./collaborationRoutes.js";
import { createCollaborationRateLimit, type CollaborationStore } from "./collaboration.js";
import { requireBoardSession } from "./boardAccess.js";
import { hashToken, SESSION_COOKIE, type AuthStore } from "./auth.js";
import type { AuthDependencies } from "./authRoutes.js";
import { HttpError } from "./errors.js";

const ownerId = randomUUID(), boardId = randomUUID(), token = "t".repeat(43);
const cookie = `${SESSION_COOKIE}=${token}`;
const input = () => {
  const before = documentInput().content.objects.find((object) => object.type === "card")!;
  return { operationId: randomUUID(), baseRevision: 1, changes: [{ id: before.id, before, after: { ...before, title: "Updated" } }] };
};
const servers: Server[] = [];
const controllers: AbortController[] = [];
afterEach(async () => {
  controllers.splice(0).forEach((controller) => controller.abort());
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  vi.restoreAllMocks(); vi.useRealTimers();
});
function setup() {
  const user = { id: ownerId, email: "owner@example.com", displayName: "Owner" };
  const getSession = vi.fn<AuthStore["getSession"]>().mockImplementation(async (value) => value === hashToken(token) ? { user, expiresAt: Date.now() + 60_000 } : undefined);
  const store: AuthStore = { getSession, async createFlow() {}, async consumeFlow() { return undefined; }, async signIn() { throw new Error("unused"); }, async revokeSession() {} };
  const auth: AuthDependencies = { store, provider: null, frontendUrl: "http://127.0.0.1:5173/scribble/", secureCookies: false };
  const document = { ...documentInput(), boardId, revision: 2, updatedAt: 100, role: "owner" as const };
  const collaboration = { apply: vi.fn<CollaborationStore["apply"]>().mockResolvedValue({ document, replayed: false }),
    state: vi.fn<CollaborationStore["state"]>().mockResolvedValue({ revision: 2, role: "owner" }) };
  const app = createApp(createBoardStore(), undefined, auth, undefined, undefined, collaboration);
  return { app, auth, collaboration, getSession, document, user };
}
async function streamApp(value: ReturnType<typeof setup>, middleware?: (res: Response) => void) {
  const app = express(); app.use("/api/boards", requireBoardSession(value.auth));
  if (middleware) app.use((_req, res, next) => { middleware(res); next(); });
  app.use("/api/boards/:id", createCollaborationRouter(value.collaboration, value.auth, { pollIntervalMs: 25 }));
  const server = app.listen(0, "127.0.0.1"); servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing port");
  const controller = new AbortController(); controllers.push(controller);
  const url = `http://127.0.0.1:${address.port}/api/boards/${boardId}/events`;
  const response = await fetch(`${url}?clientId=${randomUUID()}`, { headers: { Cookie: cookie }, signal: controller.signal });
  return { response, controller, url };
}
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, target: string) {
  let text = "";
  for (let attempt = 0; attempt < 30 && !text.includes(target); attempt++) {
    const result = await reader.read(); if (result.done) break;
    text += new TextDecoder().decode(result.value);
  }
  expect(text).toContain(target); return text;
}

describe("collaboration API", () => {
  it("accepts strict atomic object operations and returns replay metadata", async () => {
    const { app, collaboration, document } = setup(); const body = input();
    const result = await request(app).post(`/api/boards/${boardId}/operations`).set("Cookie", cookie).set("X-Scribble-Request", "1").send(body).expect(200);
    expect(result.body).toEqual({ document, replayed: false });
    expect(collaboration.apply).toHaveBeenCalledExactlyOnceWith(boardId, body, ownerId);
    collaboration.apply.mockResolvedValue({ document, replayed: true });
    expect((await request(app).post(`/api/boards/${boardId}/operations`).set("Cookie", cookie).set("X-Scribble-Request", "1").send(body).expect(200)).body.replayed).toBe(true);
  });

  it("requires session and CSRF protections before parsing or store access", async () => {
    const { app, collaboration } = setup(); const url = `/api/boards/${boardId}/operations`;
    await request(app).post(url).send(input()).expect(401);
    await request(app).post(url).set("Cookie", cookie).send(input()).expect(403);
    await request(app).post(url).set("Cookie", cookie).set("X-Scribble-Request", "1").set("Origin", "https://evil.example").send(input()).expect(403);
    expect(collaboration.apply).not.toHaveBeenCalled();
  });

  it("rejects duplicate IDs, identity changes, unknown fields and invalid object references", async () => {
    const { app, collaboration } = setup(); const body = input();
    for (const invalid of [
      { ...body, changes: [] }, { ...body, operationId: "bad-id" }, { ...body, baseRevision: -1 },
      { ...body, changes: [body.changes[0], body.changes[0]] },
      { ...body, changes: [{ ...body.changes[0], id: "different" }] },
      { ...body, changes: [{ id: "empty", before: null, after: null }] },
      { ...body, changes: [{ ...body.changes[0], after: { ...body.changes[0].after, url: "signed" } }] },
      { ...body, extra: true },
    ]) await request(app).post(`/api/boards/${boardId}/operations`).set("Cookie", cookie).set("X-Scribble-Request", "1").send(invalid).expect(400);
    expect(collaboration.apply).not.toHaveBeenCalled();
  });

  it("reports conflicts and operation-ID reuse without retries", async () => {
    const { app, collaboration } = setup();
    for (const code of ["COLLABORATION_CONFLICT", "OPERATION_ID_REUSED"]) {
      collaboration.apply.mockRejectedValue(new HttpError(409, code, "Conflict", { currentRevision: 3, conflictingObjectIds: ["note"] }));
      const result = await request(app).post(`/api/boards/${boardId}/operations`).set("Cookie", cookie).set("X-Scribble-Request", "1").send(input()).expect(409);
      expect(result.body.error).toMatchObject({ code, details: { currentRevision: 3 } });
    }
    expect(collaboration.apply).toHaveBeenCalledTimes(2);
    collaboration.apply.mockResolvedValue(undefined);
    expect((await request(app).post(`/api/boards/${boardId}/operations`).set("Cookie", cookie).set("X-Scribble-Request", "1").send(input()).expect(404)).body.error.code).toBe("BOARD_NOT_FOUND");
  });

  it("keeps operation and presence body limits bounded", async () => {
    const { app, collaboration } = setup();
    const operation = await request(app).post(`/api/boards/${boardId}/operations`).set("Cookie", cookie).set("X-Scribble-Request", "1").send({ padding: "a".repeat(2 * 1024 * 1024) }).expect(413);
    expect(operation.body.error.message).toContain("2 MB");
    await request(app).post(`/api/boards/${boardId}/presence`).set("Cookie", cookie).set("X-Scribble-Request", "1").send({ padding: "a".repeat(16 * 1024) }).expect(413);
    expect(collaboration.apply).not.toHaveBeenCalled();
  });

  it("allows viewer presence, validates coordinates and hides inaccessible boards", async () => {
    const { app, collaboration } = setup(); collaboration.state.mockResolvedValue({ revision: 2, role: "viewer" });
    const body = { clientId: randomUUID(), cursor: { x: -100, y: 200 }, selectedIds: ["note"] };
    await request(app).post(`/api/boards/${boardId}/presence`).set("Cookie", cookie).set("X-Scribble-Request", "1").send(body).expect(204);
    for (const invalid of [{ ...body, cursor: { x: 1e10, y: 0 } }, { ...body, selectedIds: Array(101).fill("note") }, { ...body, userId: randomUUID() }])
      await request(app).post(`/api/boards/${boardId}/presence`).set("Cookie", cookie).set("X-Scribble-Request", "1").send(invalid).expect(400);
    collaboration.state.mockResolvedValue(undefined);
    await request(app).post(`/api/boards/${boardId}/presence`).set("Cookie", cookie).set("X-Scribble-Request", "1").send(body).expect(404);
  });

  it("streams revision hints and server-derived presence, rechecking access every poll", async () => {
    const value = setup(), { response } = await streamApp(value);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader(); const first = await readUntil(reader, "event: presence");
    expect(first).toContain('"revision":2'); expect(first).toContain('"displayName":"Owner"');
    expect(first).not.toContain("First sketch"); expect(first).not.toContain("owner@example.com");
    value.collaboration.state.mockResolvedValue({ revision: 3, role: "viewer" });
    const changed = await readUntil(reader, '"revision":3'); expect(changed).toContain('"role":"viewer"');
    value.collaboration.state.mockResolvedValue(undefined);
    expect(await readUntil(reader, "BOARD_NOT_FOUND")).toContain("event: access");
    expect((await reader.read()).done).toBe(true);
    expect(value.getSession.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("closes an already-open stream when its session is revoked", async () => {
    const value = setup(), { response } = await streamApp(value);
    const reader = response.body!.getReader(); await readUntil(reader, "event: presence");
    value.getSession.mockResolvedValue(undefined);
    await readUntil(reader, "UNAUTHENTICATED"); expect((await reader.read()).done).toBe(true);
  });

  it("rejects stream access before opening headers and caps concurrent user connections", async () => {
    const value = setup();
    await request(value.app).get(`/api/boards/${boardId}/events?clientId=${randomUUID()}`).expect(401);
    await request(value.app).get(`/api/boards/${boardId}/events?clientId=invalid`).set("Cookie", cookie).expect(400);
    value.collaboration.state.mockResolvedValue(undefined);
    await request(value.app).get(`/api/boards/${boardId}/events?clientId=${randomUUID()}`).set("Cookie", cookie).expect(404);
    value.collaboration.state.mockResolvedValue({ revision: 2, role: "owner" });
    const { url } = await streamApp(value);
    for (let index = 0; index < 7; index++) {
      const controller = new AbortController(); controllers.push(controller);
      expect((await fetch(`${url}?clientId=${randomUUID()}`, { headers: { Cookie: cookie }, signal: controller.signal })).status).toBe(200);
    }
    expect((await fetch(`${url}?clientId=${randomUUID()}`, { headers: { Cookie: cookie } })).status).toBe(429);
  });

  it("sends authorized heartbeats while an unchanged stream stays open", async () => {
    const value = setup(), { response } = await streamApp(value);
    const reader = response.body!.getReader(); await readUntil(reader, "event: presence");
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 16_000);
    await readUntil(reader, ": heartbeat");
    expect(value.collaboration.state.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("bounds backpressure and terminates consumers whose response never drains", async () => {
    let responseObject: Response | undefined;
    const value = setup(), { response } = await streamApp(value, (res) => { responseObject = res; });
    const reader = response.body!.getReader(); await readUntil(reader, "event: presence");
    Object.defineProperty(responseObject!, "writableNeedDrain", { configurable: true, get: () => true });
    // One poll establishes the blocked time; the next exceeds the grace period.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 6_000);
    expect((await reader.read()).done).toBe(true);
  });

  it("bounds rate counters and expires stale presence without persisting cursor state", () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const rate = createCollaborationRateLimit(2, 1000); rate(ownerId); rate(ownerId);
    expect(() => rate(ownerId)).toThrow("Too many collaboration");
    vi.advanceTimersByTime(1001); expect(() => rate(ownerId)).not.toThrow();
    const presence = new CollaborationPresence(), user = setup().user;
    const body = { clientId: randomUUID(), cursor: { x: 10, y: 20 }, selectedIds: [] };
    presence.update(boardId, user, body); expect(presence.list(boardId)).toHaveLength(1);
    vi.advanceTimersByTime(30_001); expect(presence.list(boardId)).toEqual([]);
    expect(presenceSchema.safeParse({ ...body, cursor: { x: Infinity, y: 0 } }).success).toBe(false);
    expect(collaborationOperationSchema.safeParse(input()).success).toBe(true);
  });

  it("caps live participant count and board presence bytes", () => {
    const presence = new CollaborationPresence(), user = setup().user;
    for (let index = 0; index < 32; index++) presence.update(boardId, { ...user, id: randomUUID() }, { clientId: randomUUID(), cursor: null, selectedIds: [] });
    expect(() => presence.update(boardId, user, { clientId: randomUUID(), cursor: null, selectedIds: [] })).toThrow("live presence limit");
    const anotherBoard = randomUUID();
    presence.update(anotherBoard, user, { clientId: randomUUID(), cursor: null, selectedIds: Array(100).fill("a".repeat(256)) });
    expect(() => presence.update(anotherBoard, user, { clientId: randomUUID(), cursor: null, selectedIds: Array(100).fill("b".repeat(256)) })).toThrow("live presence size limit");
  });
});
