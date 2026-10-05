import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { BoardTabCoordinator, BoardTabReadOnlyError, BOARD_LEASE_DURATION_MS } from "./boardTabCoordinator";
import { BOARD_STORE_NAME, BOARD_LEASE_STORE_NAME, ASSET_STORE_NAME, openCanvasDatabase } from "./database";

let database: IDBDatabase;
let now = 1000;
let first: BoardTabCoordinator;
let second: BoardTabCoordinator;
beforeEach(async () => {
  const factory = new IDBFactory();
  database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("atomic-board-test", 3);
    request.onupgradeneeded = () => {
      for (const store of [BOARD_STORE_NAME, BOARD_LEASE_STORE_NAME, ASSET_STORE_NAME]) request.result.createObjectStore(store, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  now = 1000;
  first = new BoardTabCoordinator(async () => database, () => now, "first", null);
  second = new BoardTabCoordinator(async () => database, () => now, "second", null);
});
afterEach(async () => { await first.close(); await second.close(); database.close(); vi.unstubAllGlobals(); });
function read(id: string) {
  return new Promise<unknown>((resolve, reject) => {
    const request = database.transaction(BOARD_STORE_NAME).objectStore(BOARD_STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
describe("atomic cross-tab board leases", () => {
  it("adds only the lease store when upgrading existing guest boards and image blobs", async () => {
    const factory = new IDBFactory();
    const original = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("the-canvas", 2);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(BOARD_STORE_NAME, { keyPath: "id" });
        request.result.createObjectStore(ASSET_STORE_NAME, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const existingBoard = { id: "current-board", title: "Existing guest", objects: { old: { id: "old" } }, viewport: { x: 10, y: 20, zoom: .8 } };
    await new Promise<void>((resolve, reject) => {
      const transaction = original.transaction([BOARD_STORE_NAME, ASSET_STORE_NAME], "readwrite");
      transaction.objectStore(BOARD_STORE_NAME).put(existingBoard);
      transaction.objectStore(ASSET_STORE_NAME).put({ id: "existing-image", blob: new Blob(["original bytes"], { type: "image/png" }) });
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
    original.close();
    vi.stubGlobal("indexedDB", factory);
    const upgraded = await openCanvasDatabase();
    try {
      expect(upgraded.version).toBe(3);
      expect([...upgraded.objectStoreNames].sort()).toEqual([ASSET_STORE_NAME, BOARD_LEASE_STORE_NAME, BOARD_STORE_NAME].sort());
      const transaction = upgraded.transaction([BOARD_STORE_NAME, ASSET_STORE_NAME]);
      const board = transaction.objectStore(BOARD_STORE_NAME).get("current-board");
      const asset = transaction.objectStore(ASSET_STORE_NAME).get("existing-image");
      const values = await Promise.all([board, asset].map((request) => new Promise<unknown>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      })));
      expect(values[0]).toEqual(existingBoard);
      expect(await (values[1] as { blob: Blob }).blob.text()).toBe("original bytes");
    } finally { upgraded.close(); }
  });
  it("admits exactly one simultaneous writer while permitting unrelated boards", async () => {
    const results = await Promise.all([first.acquire("guest"), second.acquire("guest")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await second.acquire("different-account-board")).not.toBeNull();
    const winner = results[0] ? first : second;
    const loser = results[0] ? second : first;
    await winner.write("guest", [{ id: "guest", value: "kept" }]);
    await expect(loser.write("guest", [{ id: "guest", value: "stale" }])).rejects.toBeInstanceOf(BoardTabReadOnlyError);
    expect(await read("guest")).toEqual({ id: "guest", value: "kept" });
  });
  it("rejects a sleeping writer's queued write even during an atomic takeover race", async () => {
    await first.acquire("guest");
    await first.write("guest", [{ id: "guest", value: "before sleep" }]);
    now += BOARD_LEASE_DURATION_MS + 1;
    const [claimed, stale] = await Promise.allSettled([
      second.acquire("guest"), first.write("guest", [{ id: "guest", value: "stale" }]),
    ]);
    expect(claimed.status).toBe("fulfilled");
    if (claimed.status === "fulfilled") expect(claimed.value).not.toBeNull();
    expect(stale.status).toBe("rejected");
    expect(first.owns("guest")).toBe(false);
    await second.write("guest", [{ id: "guest", value: "new writer" }]);
    expect(await read("guest")).toEqual({ id: "guest", value: "new writer" });
  });
  it("cannot silently renew an expired lease before loading the current board again", async () => {
    await first.acquire("guest");
    now += BOARD_LEASE_DURATION_MS + 1;
    expect(await first.renew("guest")).toBe(false);
    expect(first.owns("guest")).toBe(false);
    expect(await second.acquire("guest")).not.toBeNull();
  });
  it("guards the canonical recovery record with its base lease and disallows unrelated writes", async () => {
    await first.acquire("account");
    await first.write("account", [{ id: "account:recovery", value: "original draft" }]);
    await expect(second.write("account", [{ id: "account:recovery", value: "stale" }])).rejects.toBeInstanceOf(BoardTabReadOnlyError);
    await expect(first.write("account", [{ id: "other", value: "unrelated" }])).rejects.toBeInstanceOf(BoardTabReadOnlyError);
    expect(await read("account:recovery")).toEqual({ id: "account:recovery", value: "original draft" });
  });
  it("keeps an interrupted draft under a separately owned recovery key without overwriting the winner", async () => {
    await first.acquire("guest");
    now += BOARD_LEASE_DURATION_MS + 1;
    await second.acquire("guest");
    await second.write("guest", [{ id: "guest", value: "fresh" }]);
    const recoveryId = "guest:recovery:unique";
    await first.acquire(recoveryId);
    await first.write(recoveryId, [{ id: recoveryId, value: "interrupted draft" }]);
    expect(await read("guest")).toEqual({ id: "guest", value: "fresh" });
    expect(await read(recoveryId)).toEqual({ id: recoveryId, value: "interrupted draft" });
  });
  it("hands ownership over on release and rejects the former owner's writes", async () => {
    await first.acquire("guest");
    await first.release("guest");
    expect(await second.acquire("guest")).not.toBeNull();
    await second.write("guest", [{ id: "guest", value: "second" }]);
    await first.release("guest");
    expect(await second.renew("guest")).toBe(true);
    await expect(first.write("guest", [{ id: "guest", value: "first" }])).rejects.toBeInstanceOf(BoardTabReadOnlyError);
  });
});
