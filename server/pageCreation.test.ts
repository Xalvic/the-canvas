import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createBoardStore, type BoardCreationResult, type BoardStore } from "./boards.js";
import { createAuthenticatedApp, TEST_OWNER_ID } from "./testFixtures/authenticatedApp.js";
import { HttpError } from "./errors.js";

function setup() {
  const requestId = randomUUID();
  const result: BoardCreationResult = {
    board: { id: randomUUID(), title: "Untitled", role: "owner", createdAt: 1, updatedAt: 1 },
    creation: { requestId, documentRevision: 1, replayed: false, expiresAt: 1000 },
  };
  const createPage = vi.fn<NonNullable<BoardStore["createPage"]>>().mockResolvedValue(result);
  const boards = { ...createBoardStore(), createPage };
  const create = vi.spyOn(boards, "create");
  return { app: createAuthenticatedApp(boards), createPage, create, result,
    input: { title: "  Untitled  ", requestId: requestId.toUpperCase(), initializeDocument: true } };
}

describe("retry-safe creation HTTP boundary", () => {
  it("forwards normalized creation input and the authenticated actor, returning a creation acknowledgement", async () => {
    const { app, input, createPage, create, result } = setup();
    const response = await request(app).post("/api/boards").send(input).expect(201);
    expect(response.body).toEqual(result);
    expect(response.headers.location).toBe(`/api/boards/${result.board.id}`);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(createPage).toHaveBeenCalledExactlyOnceWith({ ...input, title: "Untitled", requestId: input.requestId.toLowerCase() }, TEST_OWNER_ID);
    expect(create).not.toHaveBeenCalled();
    createPage.mockResolvedValue({ ...result, creation: { ...result.creation, replayed: true } });
    expect((await request(app).post("/api/boards").send(input).expect(200)).body.creation.replayed).toBe(true);
  });

  it.each([
    { requestId: randomUUID() }, { initializeDocument: true },
    { requestId: "invalid", initializeDocument: true },
    { requestId: randomUUID(), initializeDocument: false },
    { requestId: randomUUID(), initializeDocument: "true" },
    { requestId: randomUUID(), initializeDocument: true, ownerId: randomUUID() },
  ])("rejects incomplete or invalid creation fields before either store path: %j", async (fields) => {
    const { app, create, createPage } = setup();
    expect((await request(app).post("/api/boards").send({ title: "Untitled", ...fields }).expect(400)).body.error.code).toBe("VALIDATION_ERROR");
    expect(create).not.toHaveBeenCalled(); expect(createPage).not.toHaveBeenCalled();
  });

  it("keeps legacy creation intact and prevents creation fields from becoming rename fields", async () => {
    const { app, input, createPage, create } = setup();
    const legacy = await request(app).post("/api/boards").send({ title: "Legacy" }).expect(201);
    expect(legacy.body.creation).toBeUndefined();
    expect(create).toHaveBeenCalledExactlyOnceWith("Legacy", TEST_OWNER_ID);
    expect(createPage).not.toHaveBeenCalled();
    await request(app).patch(`/api/boards/${legacy.body.board.id}`).send(input).expect(400);
    expect((await request(app).get(`/api/boards/${legacy.body.board.id}`).expect(200)).body).toEqual(legacy.body);
  });

  it.each([
    [409, "CREATION_REQUEST_CONFLICT"], [410, "CREATION_DESTINATION_GONE"],
    [410, "CREATION_REQUEST_EXPIRED"], [404, "BOARD_NOT_FOUND"],
  ])("preserves the store's %s %s error without falling back to legacy creation", async (status, code) => {
    const { app, input, createPage, create } = setup();
    createPage.mockRejectedValue(new HttpError(status, code, "Creation failed"));
    expect((await request(app).post("/api/boards").send(input).expect(status)).body.error).toEqual({ code, message: "Creation failed" });
    expect(createPage).toHaveBeenCalledTimes(1); expect(create).not.toHaveBeenCalled();
  });

  it("fails explicitly when a metadata-only fixture has no atomic creation support", async () => {
    const boards = createBoardStore();
    const app = createAuthenticatedApp(boards);
    expect((await request(app).post("/api/boards").send({ title: "Untitled", requestId: randomUUID(), initializeDocument: true }).expect(503)).body.error.code).toBe("PAGE_CREATION_UNAVAILABLE");
    expect(boards.list(TEST_OWNER_ID)).toEqual([]);
  });
});
