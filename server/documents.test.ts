import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthenticatedApp as createApp, TEST_OWNER_ID } from "./testFixtures/authenticatedApp.js";
import { createBoardStore } from "./boards.js";
import { MAX_DOCUMENT_REVISION, type BoardDocumentStore } from "./documents.js";
import { documentInput } from "./testFixtures/document.js";

afterEach(() => vi.restoreAllMocks());

function setup() {
  const id = randomUUID();
  const boards = createBoardStore();
  const document = { schemaVersion: 1 as const, boardId: id, revision: 1, content: documentInput().content, updatedAt: 1000 };
  const get = vi.fn<BoardDocumentStore["get"]>().mockResolvedValue({ status: "found", document });
  const save = vi.fn<BoardDocumentStore["save"]>().mockResolvedValue({ status: "saved", created: true, document });
  return { id, boards, get, save, document, app: createApp(boards, { get, save }), url: `/api/boards/${id}/document` };
}

describe("local document HTTP contract", () => {
  it("reads a versioned document with no-store caching", async () => {
    const { app, url, document, get, id } = setup();
    const result = await request(app).get(url).expect(200);
    expect(result.body).toEqual({ document });
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(get).toHaveBeenCalledExactlyOnceWith(id, TEST_OWNER_ID);
  });

  it.each([
    ["board-not-found", "BOARD_NOT_FOUND"],
    ["document-not-found", "DOCUMENT_NOT_FOUND"],
  ] as const)("distinguishes %s on load", async (status, code) => {
    const { app, url, get } = setup();
    get.mockResolvedValue({ status });
    expect((await request(app).get(url).expect(404)).body.error.code).toBe(code);
  });

  it("creates with Location/201 and replaces with 200 using the exact input revision", async () => {
    const { app, url, save, document, id } = setup();
    const first = await request(app).put(url).send(documentInput()).expect(201);
    expect(first.headers.location).toBe(url);
    expect(first.body).toEqual({ document });
    expect(save).toHaveBeenCalledExactlyOnceWith(id, documentInput(), TEST_OWNER_ID);
    save.mockResolvedValue({ status: "saved", created: false, document: { ...document, revision: 2 } });
    const replaced = await request(app).put(url).send(documentInput(1)).expect(200);
    expect(replaced.body.document.revision).toBe(2);
    expect(replaced.headers.location).toBeUndefined();
    expect(save).toHaveBeenLastCalledWith(id, documentInput(1), TEST_OWNER_ID);
  });

  it("reports a conflict's current revision without retrying", async () => {
    const { app, url, save } = setup();
    save.mockResolvedValue({ status: "conflict", currentRevision: 3 });
    expect((await request(app).put(url).send(documentInput(1)).expect(409)).body).toEqual({
      error: { code: "REVISION_CONFLICT", message: "Document revision does not match", details: { currentRevision: 3 } },
    });
    expect(save).toHaveBeenCalledTimes(1);
    save.mockResolvedValue({ status: "board-not-found" });
    expect((await request(app).put(url).send(documentInput()).expect(404)).body.error.code).toBe("BOARD_NOT_FOUND");
  });

  it.each([undefined, null, -1, 0.5, "0", MAX_DOCUMENT_REVISION, MAX_DOCUMENT_REVISION + 1])("rejects invalid expectedRevision %s before saving", async (expectedRevision) => {
    const { app, url, save } = setup();
    const result = await request(app).put(url).send({ ...documentInput(), expectedRevision }).expect(400);
    expect(result.body.error.details).toContainEqual(expect.objectContaining({ path: "expectedRevision" }));
    expect(save).not.toHaveBeenCalled();
  });

  it("retains the shared schema's reference/duplicate/image/unknown-field checks", async () => {
    const input = documentInput();
    const objects = input.content.objects;
    const invalid = [
      { ...input, schemaVersion: 2 },
      { ...input, title: "A stale board rename" },
      { ...input, content: { objects: [...objects, objects[0]] } },
      { ...input, content: { objects: objects.slice(0, 1) } },
      { ...input, content: { objects: [...objects, { type: "image", id: "image" }] } },
      { ...input, content: { objects: [...objects, { type: "video", id: "video" }] } },
      { ...input, content: { objects, viewport: { zoom: 1 } } },
      { ...input, content: { objects: [{ ...objects[1], width: NaN }] } },
    ];
    const { app, url, save } = setup();
    for (const body of invalid) expect((await request(app).put(url).send(body).expect(400)).body.error.code).toBe("VALIDATION_ERROR");
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects malformed IDs, JSON and non-JSON input before reaching the store", async () => {
    const { app, url, get, save } = setup();
    await request(app).get("/api/boards/bad-id/document").expect(400);
    await request(app).put("/api/boards/bad-id/document").send(documentInput()).expect(400);
    expect((await request(app).put(url).set("Content-Type", "application/json").send('{"content":').expect(400)).body.error.code).toBe("INVALID_JSON");
    expect((await request(app).put(url).set("Content-Type", "text/plain").send("hello").expect(415)).body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(get).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it.each([1024 * 1024, 1024 * 1024 + 1])("enforces the document JSON byte boundary at %i bytes without increasing metadata limits", async (bytes) => {
    const { app, url, save } = setup();
    const card = documentInput().content.objects.find((object) => object.type === "card")!;
    const body = { schemaVersion: 1, expectedRevision: 0, content: { objects: Array.from({ length: 11 }, (_, index) => ({ ...card, id: `large-${index}`, body: "" })) } };
    let remaining = bytes - Buffer.byteLength(JSON.stringify(body));
    for (const object of body.content.objects) {
      const size = Math.min(100_000, remaining);
      object.body = "x".repeat(size);
      remaining -= size;
    }
    expect(remaining).toBe(0);
    const raw = JSON.stringify(body);
    expect(Buffer.byteLength(raw)).toBe(bytes);
    const result = await request(app).put(url).set("Content-Type", "application/json").send(raw).expect(bytes === 1024 * 1024 ? 201 : 413);
    if (bytes > 1024 * 1024) {
      expect(result.body.error.message).toContain("1 MB");
      expect(save).not.toHaveBeenCalled();
    }
    const metadata = await request(app).post("/api/boards").send({ title: "x".repeat(17 * 1024) }).expect(413);
    expect(metadata.body.error.message).toContain("16 KB");
  });

  it("handles rejected asynchronous store calls without exposing internals", async () => {
    const { app, url, get, save } = setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    get.mockRejectedValue(new Error("private read failure"));
    save.mockRejectedValue(new Error("private save failure"));
    for (const result of [await request(app).get(url).expect(500), await request(app).put(url).send(documentInput()).expect(500)]) {
      expect(result.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred" } });
    }
    expect(log).toHaveBeenCalledTimes(2);
  });
});
