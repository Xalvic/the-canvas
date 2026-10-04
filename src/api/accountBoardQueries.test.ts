import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onlineManager, QueryClient } from "@tanstack/react-query";
import { AccountBoardQueries, accountBoardKeys, accountBoardListOptions, retryBoardRead } from "./accountBoardQueries";
import {
  BoardApiError, BoardSignInRequired, createServerBoard, deleteServerBoard,
  getServerBoardDocument, listServerBoards, renameServerBoard, saveServerBoardDocument,
} from "./boards";
import type { CanvasDocument } from "../persistence/canvasDocument";

vi.mock("./boards", async (importOriginal) => ({
  ...await importOriginal<typeof import("./boards")>(),
  createServerBoard: vi.fn(), deleteServerBoard: vi.fn(), getServerBoardDocument: vi.fn(),
  listServerBoards: vi.fn(), renameServerBoard: vi.fn(), saveServerBoardDocument: vi.fn(),
}));

const owner = "owner-1";
const board = { id: "board-1", title: "Saved board", createdAt: 10, updatedAt: 20 };
const document: CanvasDocument = { schemaVersion: 1, content: { objects: [] } };
const remote = { ...document, boardId: board.id, revision: 2, updatedAt: 30 };
let client: QueryClient;
let queries: AccountBoardQueries;
let controller: AbortController;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  queries = new AccountBoardQueries(client);
  controller = new AbortController();
  vi.mocked(listServerBoards).mockResolvedValue([board]);
  vi.mocked(getServerBoardDocument).mockResolvedValue(remote);
  vi.mocked(createServerBoard).mockResolvedValue(board);
  vi.mocked(renameServerBoard).mockResolvedValue({ ...board, title: "Renamed" });
  vi.mocked(saveServerBoardDocument).mockResolvedValue(remote);
  vi.mocked(deleteServerBoard).mockResolvedValue(undefined);
});

afterEach(() => { client.clear(); onlineManager.setOnline(true); });

describe("owner-scoped account queries", () => {
  it("deduplicates reads and reuses the fresh list only within the same owner", async () => {
    const options = accountBoardListOptions(owner);
    await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);
    await client.fetchQuery(options);
    expect(listServerBoards).toHaveBeenCalledTimes(1);
    await client.fetchQuery(accountBoardListOptions("another-owner"));
    expect(listServerBoards).toHaveBeenCalledTimes(2);
  });

  it("manual refresh bypasses a fresh cached list", async () => {
    await client.fetchQuery(accountBoardListOptions(owner));
    vi.mocked(listServerBoards).mockResolvedValue([]);
    await client.invalidateQueries({ queryKey: accountBoardKeys.list(owner) });
    expect(await client.fetchQuery(accountBoardListOptions(owner))).toEqual([]);
    expect(listServerBoards).toHaveBeenCalledTimes(2);
  });

  it("retains the last list when a background refresh fails, then recovers", async () => {
    await client.fetchQuery(accountBoardListOptions(owner));
    vi.mocked(listServerBoards).mockRejectedValue(new TypeError("Network unavailable"));
    await expect(client.fetchQuery({ ...accountBoardListOptions(owner), staleTime: 0, retryDelay: 0 })).rejects.toThrow("Network unavailable");
    expect(listServerBoards).toHaveBeenCalledTimes(3);
    expect(client.getQueryData(accountBoardKeys.list(owner))).toEqual([board]);
    vi.mocked(listServerBoards).mockResolvedValue([]);
    await queries.list(owner, controller.signal);
    expect(client.getQueryData(accountBoardKeys.list(owner))).toEqual([]);
    expect(client.getQueryState(accountBoardKeys.list(owner))?.error).toBeNull();
  });

  it.each([
    new BoardSignInRequired(), new BoardApiError(403, "FORBIDDEN", "Forbidden"),
    new BoardApiError(404, "BOARD_NOT_FOUND", "Missing"), new BoardApiError(409, "REVISION_CONFLICT", "Changed"),
    new BoardApiError(200, "INVALID_RESPONSE", "Malformed"), new DOMException("Cancelled", "AbortError"),
  ])("does not automatically retry permanent read errors: %s", async (error) => {
    vi.mocked(listServerBoards).mockRejectedValue(error);
    await expect(client.fetchQuery(accountBoardListOptions(owner))).rejects.toBe(error);
    expect(listServerBoards).toHaveBeenCalledTimes(1);
  });

  it("bounds transient server retries to one", () => {
    const error = new BoardApiError(503, "UNAVAILABLE", "Try later");
    expect(retryBoardRead(0, error)).toBe(true);
    expect(retryBoardRead(1, error)).toBe(false);
  });

  it("always checks documents and recovery metadata against the server", async () => {
    client.setQueryData(accountBoardKeys.document(owner, board.id), { ...remote, revision: 1 });
    client.setQueryData(accountBoardKeys.list(owner), [{ ...board, title: "Old title" }]);
    expect(await queries.document(owner, board.id, controller.signal)).toEqual(remote);
    expect(await queries.list(owner, controller.signal)).toEqual([board]);
    expect(getServerBoardDocument).toHaveBeenCalledTimes(1);
    expect(listServerBoards).toHaveBeenCalledTimes(1);
  });

  it("cancels a document read when its board operation is aborted", async () => {
    const pending = deferred<typeof remote>();
    vi.mocked(getServerBoardDocument).mockReturnValue(pending.promise);
    const reading = queries.document(owner, board.id, controller.signal);
    const rejected = expect(reading).rejects.toThrow();
    controller.abort();
    await rejected;
    expect(vi.mocked(getServerBoardDocument).mock.calls[0][1]?.aborted).toBe(true);
    pending.resolve(remote);
    await Promise.resolve();
    expect(client.getQueryData(accountBoardKeys.document(owner, board.id))).toBeUndefined();
  });

  it("clears private snapshots and rejects late reads after an account transition", async () => {
    client.setQueryData(accountBoardKeys.document(owner, board.id), remote);
    const pending = deferred<typeof board[]>();
    vi.mocked(listServerBoards).mockReturnValue(pending.promise);
    const reading = client.fetchQuery(accountBoardListOptions(owner));
    const rejected = expect(reading).rejects.toThrow();
    queries.clear();
    await rejected;
    pending.resolve([board]);
    await Promise.resolve();
    expect(client.getQueryCache().findAll({ queryKey: accountBoardKeys.all })).toEqual([]);
  });
});

describe("account mutations and cache consistency", () => {
  it("updates acknowledged create, rename, save and delete snapshots while leaving other owners alone", async () => {
    client.setQueryData(accountBoardKeys.list(owner), []);
    client.setQueryData(accountBoardKeys.list("another-owner"), [board]);
    await queries.create(owner, board.title, controller.signal);
    expect(client.getQueryData(accountBoardKeys.list(owner))).toEqual([board]);
    await queries.rename(owner, board.id, "Renamed", controller.signal);
    expect(client.getQueryData(accountBoardKeys.list(owner))).toEqual([{ ...board, title: "Renamed" }]);
    await queries.save(owner, board.id, document, 1, controller.signal);
    expect(client.getQueryData(accountBoardKeys.document(owner, board.id))).toEqual(remote);
    expect(client.getQueryData(accountBoardKeys.list(owner))).toEqual([{ ...board, title: "Renamed", updatedAt: remote.updatedAt }]);
    expect(client.getQueryState(accountBoardKeys.list(owner))?.isInvalidated).toBe(true);
    await queries.remove(owner, board.id, controller.signal);
    expect(client.getQueryData(accountBoardKeys.list(owner))).toEqual([]);
    expect(client.getQueryData(accountBoardKeys.document(owner, board.id))).toBeUndefined();
    expect(client.getQueryData(accountBoardKeys.list("another-owner"))).toEqual([board]);
  });

  it.each(["create", "rename", "save", "delete"] as const)("never automatically retries an uncertain %s", async (action) => {
    const error = new TypeError("Response was lost");
    const request = { create: createServerBoard, rename: renameServerBoard, save: saveServerBoardDocument, delete: deleteServerBoard }[action];
    vi.mocked(request).mockRejectedValue(error);
    client.setQueryData(accountBoardKeys.list(owner), [board]);
    const writing = {
      create: () => queries.create(owner, board.title, controller.signal),
      rename: () => queries.rename(owner, board.id, "Renamed", controller.signal),
      save: () => queries.save(owner, board.id, document, 1, controller.signal),
      delete: () => queries.remove(owner, board.id, controller.signal),
    }[action]();
    await expect(writing).rejects.toBe(error);
    expect(request).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(accountBoardKeys.list(owner))).toEqual([board]);
  });

  it("does not advance the cached revision on a conflict", async () => {
    client.setQueryData(accountBoardKeys.document(owner, board.id), remote);
    const conflict = new BoardApiError(409, "REVISION_CONFLICT", "Changed elsewhere", 4);
    vi.mocked(saveServerBoardDocument).mockRejectedValue(conflict);
    await expect(queries.save(owner, board.id, document, 2, controller.signal)).rejects.toBe(conflict);
    expect(saveServerBoardDocument).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(accountBoardKeys.document(owner, board.id))).toEqual(remote);
  });

  it("prevents an older in-flight read from replacing an accepted save", async () => {
    const pending = deferred<typeof remote>();
    vi.mocked(getServerBoardDocument).mockReturnValue(pending.promise);
    const reading = queries.document(owner, board.id, controller.signal);
    const rejected = expect(reading).rejects.toThrow();
    await queries.save(owner, board.id, document, 1, controller.signal);
    await rejected;
    pending.resolve({ ...remote, revision: 1 });
    await Promise.resolve();
    expect(client.getQueryData(accountBoardKeys.document(owner, board.id))).toEqual(remote);
  });

  it("does not repopulate private caches from a late mutation after sign-out", async () => {
    const pending = deferred<typeof remote>();
    vi.mocked(saveServerBoardDocument).mockReturnValue(pending.promise);
    const writing = queries.save(owner, board.id, document, 1, controller.signal);
    await vi.waitFor(() => expect(saveServerBoardDocument).toHaveBeenCalledTimes(1));
    controller.abort();
    queries.clear();
    pending.resolve(remote);
    await writing;
    expect(client.getQueryCache().findAll({ queryKey: accountBoardKeys.all })).toEqual([]);
    expect(client.getMutationCache().findAll({ mutationKey: accountBoardKeys.all })).toEqual([]);
  });

  it("fails a write promptly offline without queuing it for reconnect", async () => {
    onlineManager.setOnline(false);
    vi.mocked(createServerBoard).mockRejectedValue(new TypeError("Offline"));
    await expect(queries.create(owner, board.title, controller.signal)).rejects.toThrow("Offline");
    onlineManager.setOnline(true);
    await Promise.resolve();
    expect(createServerBoard).toHaveBeenCalledTimes(1);
  });
});
