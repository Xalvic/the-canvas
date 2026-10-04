import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasDocument } from "../persistence/canvasDocument";
import {
  BoardApiError,
  BoardSignInRequired,
  createServerBoard,
  deleteServerBoard,
  getServerBoardDocument,
  listServerBoards,
  renameServerBoard,
  saveServerBoardDocument,
} from "./boards";

afterEach(() => vi.unstubAllGlobals());

const id = "550e8400-e29b-41d4-a716-446655440000";
const otherId = "550e8400-e29b-41d4-a716-446655440001";
const board = { id, title: "My board", createdAt: 100, updatedAt: 200 };
const document: CanvasDocument = { schemaVersion: 1, content: { objects: [] } };
const savedDocument = { ...document, boardId: id, revision: 1, updatedAt: 200 };

function respond(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("board metadata API boundary", () => {
  it("reads metadata and supports older metadata-only fixtures", async () => {
    const boards = [board, { id: "private-board", title: "Older board" }];
    const fetch = respond({ boards });
    const signal = new AbortController().signal;
    expect(await listServerBoards(signal)).toEqual(boards);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/boards", { credentials: "same-origin", signal });
  });

  it.each([
    { boards: [{ id: "", title: "Board" }] },
    { boards: [{ id, title: " " }] },
    { boards: [{ ...board, updatedAt: -1 }] },
    { boards: null },
  ])("rejects malformed metadata %j", async (payload) => {
    respond(payload);
    await expect(listServerBoards()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("creates a board with a validated trimmed title and mutation header", async () => {
    const fetch = respond({ board }, 201);
    const signal = new AbortController().signal;
    expect(await createServerBoard("  My board  ", signal)).toEqual(board);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/boards", {
      credentials: "same-origin",
      method: "POST",
      headers: { "X-Scribble-Request": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "My board" }),
      signal,
    });
  });

  it.each(["", "   ", "a".repeat(121)])("rejects invalid title before sending a mutation", async (title) => {
    const fetch = respond({ board }, 201);
    await expect(createServerBoard(title)).rejects.toThrow();
    await expect(renameServerBoard(id, title)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("renames only the requested board and forwards the title", async () => {
    const renamed = { ...board, title: "Renamed" };
    const fetch = respond({ board: renamed });
    expect(await renameServerBoard(id, "Renamed")).toEqual(renamed);
    expect(fetch).toHaveBeenCalledWith(`/api/boards/${id}`, expect.objectContaining({
      method: "PATCH",
      headers: { "X-Scribble-Request": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Renamed" }),
    }));
    respond({ board: { ...renamed, id: otherId } });
    await expect(renameServerBoard(id, "Renamed")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("deletes with the mutation header and requires the server's deletion acknowledgement", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await expect(deleteServerBoard(id, signal)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(`/api/boards/${id}`, {
      credentials: "same-origin", method: "DELETE", headers: { "X-Scribble-Request": "1" }, signal,
    });
    await expect(deleteServerBoard(id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("board document API boundary", () => {
  it("loads a validated document with its board identity and revision", async () => {
    const fetch = respond({ document: savedDocument });
    const signal = new AbortController().signal;
    expect(await getServerBoardDocument(id, signal)).toEqual(savedDocument);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/boards/${id}/document`, {
      credentials: "same-origin", signal,
    });
  });

  it.each([
    { ...savedDocument, boardId: otherId },
    { ...savedDocument, revision: 0 },
    { ...savedDocument, revision: 1.5 },
    { ...savedDocument, schemaVersion: 2 },
    { ...savedDocument, updatedAt: "today" },
    { ...savedDocument, unexpected: "field" },
    { ...savedDocument, content: { objects: [{ type: "image" }] } },
  ])("rejects invalid or mismatched returned documents %j", async (payload) => {
    respond({ document: payload });
    await expect(getServerBoardDocument(id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([0, 4])("saves an initial or updated document against expected revision %s", async (expectedRevision) => {
    const saved = { ...savedDocument, revision: expectedRevision + 1 };
    const fetch = respond({ document: saved }, expectedRevision === 0 ? 201 : 200);
    const signal = new AbortController().signal;
    expect(await saveServerBoardDocument(id, document, expectedRevision, signal)).toEqual(saved);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`/api/boards/${id}/document`, {
      credentials: "same-origin",
      method: "PUT",
      headers: { "X-Scribble-Request": "1", "Content-Type": "application/json" },
      body: JSON.stringify({ ...document, expectedRevision }),
      signal,
    });
  });

  it.each([-1, 0.5, 2_147_483_647])("rejects invalid expected revision %s before a request", async (expectedRevision) => {
    const fetch = respond({ document: savedDocument });
    await expect(saveServerBoardDocument(id, document, expectedRevision)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects unsupported images before sending board content", async () => {
    const fetch = respond({ document: savedDocument });
    const invalid = { schemaVersion: 1, content: { objects: [{ type: "image" }] } } as unknown as CanvasDocument;
    await expect(saveServerBoardDocument(id, invalid, 0)).rejects.toThrow("Image-containing documents are unsupported");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { ...savedDocument, boardId: otherId },
    { ...savedDocument, revision: 2 },
  ])("does not accept a save acknowledgement for another board/revision", async (saved) => {
    respond({ document: saved });
    await expect(saveServerBoardDocument(id, document, 0)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("exposes conflict revision without retrying or overwriting", async () => {
    const fetch = respond({ error: {
      code: "REVISION_CONFLICT", message: "Document revision does not match", details: { currentRevision: 7 },
    } }, 409);
    await expect(saveServerBoardDocument(id, document, 3)).rejects.toMatchObject({
      status: 409, code: "REVISION_CONFLICT", currentRevision: 7,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([-1, "7", undefined])("does not trust malformed conflict revision %s", async (currentRevision) => {
    respond({ error: { code: "REVISION_CONFLICT", message: "Conflict", details: { currentRevision } } }, 409);
    await expect(saveServerBoardDocument(id, document, 0)).rejects.toMatchObject({
      status: 409, code: "REVISION_CONFLICT", currentRevision: undefined,
    });
  });
});

describe("protected board request failures", () => {
  it.each([
    () => listServerBoards(),
    () => createServerBoard("Board"),
    () => renameServerBoard(id, "Board"),
    () => deleteServerBoard(id),
    () => getServerBoardDocument(id),
    () => saveServerBoardDocument(id, document, 0),
  ])("preserves sign-in-required errors for every protected operation", async (request) => {
    respond({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } }, 401);
    await expect(request()).rejects.toBeInstanceOf(BoardSignInRequired);
  });

  it.each(["BOARD_NOT_FOUND", "DOCUMENT_NOT_FOUND"])("retains structured %s errors", async (code) => {
    respond({ error: { code, message: "Not found" } }, 404);
    await expect(getServerBoardDocument(id)).rejects.toMatchObject({ status: 404, code, message: "Not found" });
  });

  it("reports unstructured errors and malformed success JSON safely", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("Bad gateway", { status: 502 }))
      .mockResolvedValueOnce(new Response("not JSON", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(listServerBoards()).rejects.toMatchObject({ status: 502, code: "HTTP_ERROR" });
    await expect(listServerBoards()).rejects.toBeInstanceOf(BoardApiError);
  });

  it("lets callers cancel requests without converting cancellation into an API failure", async () => {
    const error = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    await expect(listServerBoards(new AbortController().signal)).rejects.toBe(error);
  });
});
