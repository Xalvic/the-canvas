import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuestTransfer, readGuestTransfer } from "./guestTransfer";
import { BOARD_STORE_NAME, openCanvasDatabase } from "./database";
import { saveAsset } from "../assets/assetStore";
import { createCardObject, createImageObject } from "../canvas/objects/objectFactories";
import { createServerPage, getServerBoard, getServerBoardDocument, BoardApiError } from "../api/boards";
import { uploadBoardAssetRequest, getBoardAssetUpload } from "../api/assets";
import { applyBoardOperation } from "../api/collaboration";
import type { LocalBoardRecord } from "./localBoardStorage";

vi.mock("../api/boards", async (original) => ({ ...await original<typeof import("../api/boards")>(),
  createServerPage: vi.fn(), getServerBoard: vi.fn(), getServerBoardDocument: vi.fn() }));
vi.mock("../api/assets", async (original) => ({ ...await original<typeof import("../api/assets")>(),
  uploadBoardAssetRequest: vi.fn(), getBoardAssetUpload: vi.fn() }));
vi.mock("../api/collaboration", () => ({ applyBoardOperation: vi.fn() }));
const account = "11111111-1111-4111-8111-111111111111", destination = "22222222-2222-4222-8222-222222222222";
const asset = "33333333-3333-4333-8333-333333333333";
const signal = () => new AbortController().signal;
let transfer: GuestTransfer, source: LocalBoardRecord, tab: Map<string, string>;
let browser: { location: { href: string }; history: { state: null; replaceState: (state: unknown, title: string, url: string) => void } };
const readyUpload = (requestId: string) => ({ requestId, boardId: destination, assetId: asset, state: "ready" as const,
  canRetry: false as const, retryAfterMs: null, asset: { id: asset, boardId: destination, byteSize: 3, width: 1, height: 1, mimeType: "image/png" as const, createdAt: 1 } });

beforeEach(async () => {
  vi.resetAllMocks();
  const db = await openCanvasDatabase();
  await new Promise<void>((resolve) => { const tx = db.transaction(BOARD_STORE_NAME, "readwrite"); tx.objectStore(BOARD_STORE_NAME).clear(); tx.oncomplete = () => resolve(); });
  tab = new Map();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => tab.get(key) ?? null, setItem: (key: string, value: string) => tab.set(key, value), removeItem: (key: string) => tab.delete(key) });
  browser = { location: { href: "http://localhost/scribble/" }, history: { state: null, replaceState: (_state, _title, url) => { browser.location.href = String(url); } } };
  vi.stubGlobal("window", browser);
  transfer = new GuestTransfer();
  const card = { ...createCardObject({ x: 20, y: 30 }, 1), title: "Original" };
  source = { schemaVersion: 1, id: "current-board", title: "Device drawing", objects: { [card.id]: card }, viewport: { x: 120, y: 90, zoom: 1.5 }, createdAt: 1, updatedAt: 2 };
  vi.mocked(createServerPage).mockImplementation(async (input) => ({ board: { id: destination, title: input.title, role: "owner" }, creation: { requestId: input.requestId, documentRevision: 1, replayed: false, expiresAt: Date.now() + 1000 } }));
  vi.mocked(getServerBoard).mockResolvedValue({ id: destination, title: "Device drawing", role: "owner" });
  vi.mocked(getServerBoardDocument).mockResolvedValue({ boardId: destination, schemaVersion: 1, content: { objects: [] }, revision: 1, updatedAt: 1, role: "owner" });
  vi.mocked(applyBoardOperation).mockResolvedValue({ boardId: destination, schemaVersion: 1, content: { objects: [] }, revision: 2, updatedAt: 2 });
  vi.mocked(uploadBoardAssetRequest).mockImplementation(async (_board, _blob, requestId) => readyUpload(requestId));
  vi.mocked(getBoardAssetUpload).mockImplementation(async (_board, requestId) => readyUpload(requestId));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function addImage() {
  const localId = await saveAsset(new Blob(["png"], { type: "image/png" }));
  const image = createImageObject({ center: { x: 100, y: 100 }, zIndex: 2, assetId: localId, width: 1, height: 1, originalWidth: 1, originalHeight: 1 });
  source.objects[image.id] = image;
  return localId;
}
async function reload(accountId = account) {
  transfer = new GuestTransfer(); await transfer.authentication(accountId, signal());
}
describe("deliberate guest transfer", () => {
  it("keeps an immutable drawing/blob snapshot without modifying guest keys or viewport", async () => {
    await addImage(); const original = structuredClone(source);
    await transfer.stage(source, account, signal());
    const snapshot = await readGuestTransfer(transfer.intent!.id);
    expect(source).toEqual(original); expect(snapshot!.source).toEqual(original);
    source.title = "Later edit"; const first = Object.values(source.objects)[0]; if (first.type !== "connector") first.x = 900;
    expect(snapshot!.source.title).toBe("Device drawing");
    expect(await snapshot!.images[0].blob.text()).toBe("png");
    const db = await openCanvasDatabase();
    expect(await new Promise((resolve) => { const req = db.transaction(BOARD_STORE_NAME).objectStore(BOARD_STORE_NAME).get("current-board"); req.onsuccess = () => resolve(req.result); })).toBeUndefined();
  });
  it("requires a matching successful callback and tab flow before binding an account", async () => {
    const flowId = await transfer.stage(source, null, signal());
    await reload(); expect(transfer.intent).toBeNull(); expect(createServerPage).not.toHaveBeenCalled();
    browser.location.href += `?authFlow=${flowId}`;
    await reload(); expect(transfer.intent?.status).toBe("active"); expect(transfer.intent?.accountId).toBe(account);
    expect(browser.location.href).toBe("http://localhost/scribble/");
  });
  it.each(["denied", "failed", "invalid_state"])("preserves %s OAuth's source but never imports on a later session", async (error) => {
    await transfer.stage(source, null, signal()); const id = transfer.intent!.id;
    browser.location.href += `?authError=${error}`;
    transfer = new GuestTransfer(); browser.location.href = "http://localhost/scribble/"; // Account UI strips message first.
    await transfer.authentication(null, signal()); await reload();
    expect(transfer.intent).toBeNull(); expect((await readGuestTransfer(id))?.source).toEqual(source);
    expect((await readGuestTransfer(id))?.status).toBe("paused"); expect(createServerPage).not.toHaveBeenCalled();
  });
  it("declined consent cancels an older unbound intent without erasing it", async () => {
    const flow = await transfer.stage(source, null, signal()), id = transfer.intent!.id;
    await transfer.declineAuthentication(); browser.location.href += `?authFlow=${flow}`; await reload();
    expect(transfer.intent).toBeNull(); expect((await readGuestTransfer(id))?.status).toBe("paused");
  });
  it("ignores mismatched callbacks and expires old authentication consent", async () => {
    const flow = await transfer.stage(source, null, signal());
    browser.location.href += `?authFlow=${crypto.randomUUID()}`; await reload(); expect(transfer.intent).toBeNull();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    browser.location.href = `http://localhost/scribble/?authFlow=${flow}`;
    await reload(); expect(transfer.intent).toBeNull(); expect(createServerPage).not.toHaveBeenCalled(); vi.restoreAllMocks();
  });
  it("reuses the durable create request after a lost response and reload", async () => {
    await transfer.stage(source, account, signal()); const original = transfer.intent!.requestId;
    vi.mocked(createServerPage).mockRejectedValueOnce(new Error("Lost create response"));
    await expect(transfer.resume(account, signal(), () => {})).rejects.toThrow("Lost create");
    await reload(); await transfer.resume(account, signal(), () => {});
    expect(vi.mocked(createServerPage).mock.calls.map(([input]) => input.requestId)).toEqual([original, original]);
    expect(transfer.intent?.destinationId).toBe(destination); expect(transfer.intent?.status).toBe("committed");
  });
  it("persists image identities before dispatch and reconciles unknown responses without another upload", async () => {
    await addImage(); await transfer.stage(source, account, signal()); const identity = transfer.intent!.images[0].requestId;
    vi.mocked(uploadBoardAssetRequest).mockImplementationOnce(async () => {
      expect((await readGuestTransfer(transfer.intent!.id))?.images[0].dispatched).toBe(true);
      throw new Error("Lost upload response");
    });
    await expect(transfer.resume(account, signal(), () => {})).rejects.toThrow("Lost upload");
    await reload(); await transfer.resume(account, signal(), () => {});
    expect(createServerPage).toHaveBeenCalledTimes(1); expect(uploadBoardAssetRequest).toHaveBeenCalledTimes(1);
    expect(getBoardAssetUpload).toHaveBeenCalledWith(destination, identity, expect.any(AbortSignal), account);
    expect(transfer.intent?.images[0].assetId).toBe(asset);
  });
  it("keeps completed image mappings while another image is pending and honors its delay", async () => {
    await addImage(); await addImage(); await transfer.stage(source, account, signal());
    vi.mocked(uploadBoardAssetRequest).mockImplementation(async (_board, _blob, id) => id === transfer.intent!.images[0].requestId ? readyUpload(id)
      : { requestId: id, boardId: destination, assetId: asset, state: "pending", canRetry: true, retryAfterMs: 90_000, asset: null });
    await expect(transfer.resume(account, signal(), () => {})).rejects.toThrow("still being checked");
    vi.mocked(getBoardAssetUpload).mockImplementation(async (_board, id) => ({ requestId: id, boardId: destination, assetId: asset, state: "pending", canRetry: true, retryAfterMs: 90_000, asset: null }));
    await reload(); await expect(transfer.resume(account, signal(), () => {})).rejects.toThrow("still being checked");
    expect(uploadBoardAssetRequest).toHaveBeenCalledTimes(2); expect(applyBoardOperation).not.toHaveBeenCalled();
    expect(transfer.intent?.images[0].assetId).toBe(asset);
  });
  it("stops bytes after retry exhaustion or failed upload status", async () => {
    await addImage(); await transfer.stage(source, account, signal());
    vi.mocked(uploadBoardAssetRequest).mockRejectedValueOnce(new Error("Unknown provider write"));
    await expect(transfer.resume(account, signal(), () => {})).rejects.toThrow();
    vi.mocked(getBoardAssetUpload).mockImplementation(async (_board, id) => ({ requestId: id, boardId: destination, assetId: asset, state: "failed", canRetry: false, retryAfterMs: null, asset: null }));
    await reload(); await expect(transfer.resume(account, signal(), () => {})).rejects.toThrow("expired");
    expect(uploadBoardAssetRequest).toHaveBeenCalledTimes(1);
  });
  it("honors HTTP rate-limit delay and retains its original upload request", async () => {
    await addImage(); await transfer.stage(source, account, signal());
    vi.mocked(uploadBoardAssetRequest).mockRejectedValueOnce(new BoardApiError(429, "RATE_LIMIT", "Wait", undefined, 90_000));
    await expect(transfer.resume(account, signal(), () => {})).rejects.toThrow("Wait");
    vi.mocked(getBoardAssetUpload).mockRejectedValue(new BoardApiError(404, "ASSET_UPLOAD_NOT_FOUND", "Missing"));
    await reload(); await expect(transfer.resume(account, signal(), () => {})).rejects.toThrow("still being checked");
    expect(uploadBoardAssetRequest).toHaveBeenCalledTimes(1); expect(transfer.intent?.images[0].nextAttemptAt).toBeGreaterThan(Date.now() + 80_000);
  });
  it("a pause in another tab during creation prevents importing or reactivating that intent", async () => {
    await transfer.stage(source, account, signal());
    vi.mocked(createServerPage).mockImplementationOnce(async (input) => {
      const other = new GuestTransfer(); await other.authentication(account, signal()); await other.pause();
      return { board: { id: destination, title: input.title }, creation: { requestId: input.requestId, documentRevision: 1, replayed: false, expiresAt: 1 } };
    });
    await expect(transfer.resume(account, signal(), () => {})).rejects.toThrow("paused");
    expect((await readGuestTransfer(transfer.intent!.id))?.status).toBe("paused"); expect(applyBoardOperation).not.toHaveBeenCalled();
  });
  it("replays the same committed operation after a lost response even with newer document edits", async () => {
    await transfer.stage(source, account, signal());
    vi.mocked(applyBoardOperation).mockImplementationOnce(async (_id, operation) => {
      expect((await readGuestTransfer(transfer.intent!.id))?.operation).toEqual(operation); throw new Error("Lost document response");
    });
    await expect(transfer.resume(account, signal(), () => {})).rejects.toThrow("Lost document");
    const original = transfer.intent!.operation;
    vi.mocked(getServerBoardDocument).mockResolvedValue({ boardId: destination, schemaVersion: 1, content: { objects: [] }, revision: 5, updatedAt: 5 });
    await reload(); await transfer.resume(account, signal(), () => {});
    expect(vi.mocked(applyBoardOperation).mock.calls.map(([, operation]) => operation)).toEqual([original, original]);
    await reload(); await transfer.resume(account, signal(), () => {}); expect(applyBoardOperation).toHaveBeenCalledTimes(2);
    await transfer.opened(); await reload(); expect(transfer.intent).toBeNull();
  });
  it("never overwrites a destination changed before the first document operation", async () => {
    await transfer.stage(source, account, signal());
    vi.mocked(getServerBoardDocument).mockResolvedValue({ boardId: destination, schemaVersion: 1, content: { objects: [] }, revision: 3, updatedAt: 3 });
    await expect(transfer.resume(account, signal(), () => {})).rejects.toThrow("edited before");
    expect(applyBoardOperation).not.toHaveBeenCalled(); expect(transfer.intent?.source).toEqual(source);
  });
  it("never resumes another account and requires explicit activation after sign-out", async () => {
    await transfer.stage(source, account, signal()); await transfer.pause();
    await reload(destination); expect(transfer.intent).toBeNull(); await reload();
    expect(transfer.intent?.status).toBe("paused"); await expect(transfer.resume(account, signal(), () => {})).rejects.toThrow("paused");
    await transfer.activate(account); await transfer.resume(account, signal(), () => {});
    expect(createServerPage).toHaveBeenCalledTimes(1);
  });
  it("terminal page creation errors retain the original identity and never create a replacement", async () => {
    await transfer.stage(source, account, signal());
    vi.mocked(createServerPage).mockRejectedValue(new BoardApiError(410, "CREATION_DESTINATION_GONE", "Deleted"));
    await expect(transfer.resume(account, signal(), () => {})).rejects.toThrow("Deleted");
    const id = transfer.intent!.requestId; await reload(); await expect(transfer.resume(account, signal(), () => {})).rejects.toThrow("Deleted");
    expect(vi.mocked(createServerPage).mock.calls.every(([input]) => input.requestId === id)).toBe(true);
  });
  it("aborting during creation prevents later destination/image/document changes", async () => {
    await addImage(); await transfer.stage(source, account, signal()); const abort = new AbortController();
    vi.mocked(createServerPage).mockImplementationOnce(async (input) => { abort.abort(); return { board: { id: destination, title: input.title }, creation: { requestId: input.requestId, documentRevision: 1, replayed: false, expiresAt: 1 } }; });
    await expect(transfer.resume(account, abort.signal, () => {})).rejects.toThrow();
    expect(transfer.intent?.destinationId).toBeNull(); expect(uploadBoardAssetRequest).not.toHaveBeenCalled(); expect(applyBoardOperation).not.toHaveBeenCalled();
  });
  it("rejects missing/unsupported local images before starting authentication or page creation", async () => {
    const image = createImageObject({ center: { x: 10, y: 10 }, zIndex: 2, assetId: "missing", width: 10, height: 10, originalWidth: 10, originalHeight: 10 });
    source.objects[image.id] = image;
    await expect(transfer.stage(source, null, signal())).rejects.toThrow("missing images");
    expect(transfer.intent).toBeNull(); expect(tab.size).toBe(0); expect(createServerPage).not.toHaveBeenCalled();
  });
});
