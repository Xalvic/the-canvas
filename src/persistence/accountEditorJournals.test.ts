import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { AccountEditorJournals, parseEditorJournal } from "./accountEditorJournals";
import { BoardTabCoordinator, BoardTabReadOnlyError } from "./boardTabCoordinator";
import { BOARD_STORE_NAME, BOARD_LEASE_STORE_NAME, ASSET_STORE_NAME, EDITOR_JOURNAL_STORE_NAME, requestResult } from "./database";
import { accountBoardStorageId, type LocalBoardRecord } from "./localBoardStorage";

let database: IDBDatabase;
let firstLease: BoardTabCoordinator, secondLease: BoardTabCoordinator;
let first: AccountEditorJournals, second: AccountEditorJournals;
const base = accountBoardStorageId("account-a", "board-a");
function draft(title = "Pending title"): LocalBoardRecord {
  const card = { id: "pending-card", type: "card" as const, title, body: "", x: 1, y: 2, width: 200, height: 120, zIndex: 1, createdAt: 1, updatedAt: 1 };
  return { schemaVersion: 1, id: base, title, objects: { [card.id]: card }, viewport: { x: 12, y: 34, zoom: .8 }, createdAt: 1, updatedAt: 1,
    account: { ownerId: "account-a", boardId: "board-a", revision: 1, savedTitle: "Saved title", savedDocument: { schemaVersion: 1, content: { objects: [] } },
      imageAssets: { image: crypto.randomUUID() }, pendingOperation: { input: { operationId: crypto.randomUUID(), baseRevision: 1, changes: [{ id: card.id, before: null, after: card }] }, document: { schemaVersion: 1, content: { objects: [card] } } } } };
}
beforeEach(async () => {
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = new IDBFactory().open("journal-tests", 4);
    request.onupgradeneeded = () => { for (const name of [BOARD_STORE_NAME, BOARD_LEASE_STORE_NAME, ASSET_STORE_NAME, EDITOR_JOURNAL_STORE_NAME]) request.result.createObjectStore(name, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  firstLease = new BoardTabCoordinator(async () => database, Date.now, "first", null);
  secondLease = new BoardTabCoordinator(async () => database, Date.now, "second", null);
  first = new AccountEditorJournals(firstLease, async () => database);
  second = new AccountEditorJournals(secondLease, async () => database);
});
afterEach(async () => { await firstLease.close(); await secondLease.close(); database.close(); vi.unstubAllGlobals(); });

describe("isolated account editor journals", () => {
  it("admits two same-account editors with fresh identities and independent pending operations/mappings", async () => {
    expect(first.editorId).not.toBe(second.editorId);
    await first.open(base, async () => null); await second.open(base, async () => null);
    expect(first.leaseId(base)).not.toBe(second.leaseId(base));
    const a = draft("First pending"), b = draft("Second pending");
    await Promise.all([first.save(a), second.save(b)]);
    expect(await first.read(base)).toEqual(a); expect(await second.read(base)).toEqual(b);
    expect((await first.list(base)).map((journal) => journal.board.title).sort()).toEqual(["First pending", "Second pending"]);
    await expect(firstLease.writeJournal(first.leaseId(base), [{ id: second.leaseId(base), board: a }])).rejects.toBeInstanceOf(BoardTabReadOnlyError);
    expect(await requestResult(database.transaction(BOARD_STORE_NAME).objectStore(BOARD_STORE_NAME).get(base))).toBeUndefined();
  });
  it("copies a legacy draft once without deleting pending operations, image mappings or its original key", async () => {
    const legacy = draft();
    await new Promise<void>((resolve) => {
      const transaction = database.transaction(BOARD_STORE_NAME, "readwrite"); transaction.objectStore(BOARD_STORE_NAME).put(legacy); transaction.oncomplete = () => resolve();
    });
    expect(await first.open(base, async () => legacy)).toEqual(legacy);
    expect(await second.open(base, async () => legacy)).toBeNull();
    expect(await requestResult(database.transaction(BOARD_STORE_NAME).objectStore(BOARD_STORE_NAME).get(base))).toEqual(legacy);
    expect((await first.list(base)).filter((journal) => journal.legacySource)).toHaveLength(1);
    expect((await first.read(base))?.account?.pendingOperation?.input.operationId).toBe(legacy.account?.pendingOperation?.input.operationId);
  });
  it("discovers a released legacy pending draft even after another journal exists", async () => {
    await first.open(base, async () => null);
    const existing = draft("Existing journal"), legacy = draft("Released legacy work");
    await first.save(existing);
    await firstLease.close();
    expect(await second.open(base, async () => legacy)).toEqual(legacy);
    expect((await second.list(base)).map((journal) => journal.board.title).sort()).toEqual(["Existing journal", "Released legacy work"]);
    expect((await second.read(base))?.account?.pendingOperation?.input.operationId).toBe(legacy.account?.pendingOperation?.input.operationId);
  });
  it("adopts an inactive crash journal under its own lease and keeps exact operation identity", async () => {
    await first.open(base, async () => null);
    const pending = draft(); await first.save(pending);
    const originalKey = first.leaseId(base);
    await firstLease.close();
    expect(await second.open(base, async () => null)).toEqual(pending);
    expect(second.leaseId(base)).toBe(originalKey);
    await second.save({ ...pending, title: "Still pending" });
    expect((await second.read(base))?.account?.pendingOperation?.input.operationId).toBe(pending.account?.pendingOperation?.input.operationId);
    expect((await second.list(base))[0].editorId).toBe(second.editorId);
  });
  it("retains every older dirty journal rather than deleting by timestamp", async () => {
    await first.open(base, async () => null); await second.open(base, async () => null);
    await first.save({ ...draft("Older pending"), updatedAt: 1 });
    await second.save({ ...draft("Newer pending"), updatedAt: 100 });
    await firstLease.close(); await secondLease.close();
    const recovered = new AccountEditorJournals(firstLease, async () => database);
    await recovered.open(base, async () => null);
    expect((await recovered.list(base)).map((journal) => journal.board.title).sort()).toEqual(["Newer pending", "Older pending"]);
  });
  it("scopes recovery snapshots to each journal and rejects cross-account records", async () => {
    await first.open(base, async () => null); await second.open(base, async () => null);
    const a = draft("First backup"), b = draft("Second backup");
    await first.save({ ...a, id: `${base}:recovery` }); await second.save({ ...b, id: `${base}:recovery` });
    expect((await first.recovery(base))?.title).toBe("First backup"); expect((await second.recovery(base))?.title).toBe("Second backup");
    const value = { id: first.leaseId(base), journalVersion: 1, editorId: first.editorId, board: { ...a, account: { ...a.account!, ownerId: "wrong-account" } } };
    expect(parseEditorJournal(value)).toBeNull();
    expect(await first.list(accountBoardStorageId("wrong-account", "board-a"))).toEqual([]);
  });
  it("never adopts another live editor's journal during duplicate-tab recovery", async () => {
    await first.open(base, async () => null); await first.save(draft());
    await second.open(base, async () => null);
    await expect(second.reserve(base, first.leaseId(base))).rejects.toThrow("currently being edited");
    expect(await first.read(base)).not.toBeNull(); expect(await second.read(base)).toBeNull();
  });
});
