import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createBoardStore } from "./boards.js";

afterEach(() => vi.restoreAllMocks());

describe("local board API", () => {
  it("reports process health and starts with an empty board list", async () => {
    const app = createApp();
    const health = await request(app).get("/health").expect(200);
    expect(health.body).toEqual({ status: "ok" });
    expect(health.headers["content-type"]).toContain("application/json");
    expect(health.headers["cache-control"]).toBe("no-store");
    const list = await request(app).get("/api/boards").expect(200);
    expect(list.body).toEqual({ boards: [] });
  });

  it("creates, lists, and reads normalized metadata with server-owned identity", async () => {
    const app = createApp();
    const created = await request(app)
      .post("/api/boards")
      .send({ title: "  Product ideas  " })
      .expect(201);
    const board = created.body.board;
    expect(board).toEqual({
      id: expect.any(String),
      title: "Product ideas",
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(board.updatedAt).toBe(board.createdAt);
    expect(created.headers.location).toBe(`/api/boards/${board.id}`);
    const detail = await request(app).get(created.headers.location).expect(200);
    expect(detail.body).toEqual({ board });
    const list = await request(app).get("/api/boards").expect(200);
    expect(list.body).toEqual({ boards: [board] });
  });

  it.each([
    {},
    { title: "" },
    { title: "   " },
    { title: 42 },
    { title: "x".repeat(121) },
    { title: "Valid", id: randomUUID() },
    { title: "Valid", ownerId: "someone-else" },
  ])("rejects invalid creation input without adding a board: %j", async (body) => {
    const app = createApp();
    const response = await request(app).post("/api/boards").send(body).expect(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details.length).toBeGreaterThan(0);
    const list = await request(app).get("/api/boards").expect(200);
    expect(list.body.boards).toEqual([]);
  });

  it("distinguishes invalid IDs, missing boards, and unknown routes", async () => {
    const app = createApp();
    const invalid = await request(app).get("/api/boards/not-a-uuid").expect(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
    const missing = await request(app).get(`/api/boards/${randomUUID()}`).expect(404);
    expect(missing.body.error.code).toBe("BOARD_NOT_FOUND");
    const unknown = await request(app).get("/api/missing").expect(404);
    expect(unknown.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("returns JSON errors for malformed, oversized, and non-JSON bodies", async () => {
    const app = createApp();
    const malformed = await request(app)
      .post("/api/boards")
      .set("Content-Type", "application/json")
      .send('{"title":')
      .expect(400);
    expect(malformed.body.error.code).toBe("INVALID_JSON");
    const oversized = await request(app)
      .post("/api/boards")
      .send({ title: "x".repeat(17 * 1024) })
      .expect(413);
    expect(oversized.body.error.code).toBe("PAYLOAD_TOO_LARGE");
    const nonJson = await request(app)
      .post("/api/boards")
      .set("Content-Type", "text/plain")
      .send("Product ideas")
      .expect(415);
    expect(nonJson.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("starts fresh for a new application instance, modeling a restart", async () => {
    await request(createApp()).post("/api/boards").send({ title: "Temporary" }).expect(201);
    const fresh = await request(createApp()).get("/api/boards").expect(200);
    expect(fresh.body.boards).toEqual([]);
  });

  it("logs unexpected failures but keeps internal details out of the response", async () => {
    const boards = createBoardStore();
    vi.spyOn(boards, "list").mockImplementation(() => {
      throw new Error("private implementation detail");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(createApp(boards)).get("/api/boards").expect(500);
    expect(response.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred" },
    });
    expect(log).toHaveBeenCalledOnce();
  });
});
