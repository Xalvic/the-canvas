import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { getAccount, signOut } from "../api/auth";
import { BoardApiError, createServerPage, deleteServerBoard, getServerBoard, getServerBoardDocument, listServerBoards } from "../api/boards";
import { getServerWorkspace, initializeServerWorkspace, updateServerWorkspace } from "../api/workspace";
import { AccountBoardSession } from "./accountBoardSession";
import { WorkspaceController } from "./workspaceController";
import { loadLocalBoard, saveLocalBoard, CURRENT_BOARD_ID, type LocalBoardRecord } from "./localBoardStorage";
import { waitForLocalBoardSave } from "./waitForLocalBoardSave";
import { useBoardStore } from "../store/boardStore";
import { useDocumentStore } from "../store/documentStore";
import { useViewportStore } from "../store/viewportStore";
import { useInteractionStore } from "../store/interactionStore";
import { useSelectionStore } from "../store/selectionStore";
import { createCardObject } from "../canvas/objects/objectFactories";
import { serializeDocumentSnapshot } from "./canvasDocumentAdapters";
import { pageFromUrl, rememberPageIntent } from "./workspaceNavigation";
import { openShareLink } from "../api/shareLinks";
import { shareLinkIntent } from "./shareLinkIntent";

vi.mock("../api/auth", () => ({ getAccount: vi.fn(), signOut: vi.fn() }));
vi.mock("../api/shareLinks", () => ({ openShareLink: vi.fn() }));
vi.mock("../api/workspace", () => ({ getServerWorkspace: vi.fn(), initializeServerWorkspace: vi.fn(), updateServerWorkspace: vi.fn() }));
vi.mock("../api/boards", async (original) => ({ ...await original<typeof import("../api/boards")>(),
  createServerPage: vi.fn(), getServerBoard: vi.fn(), getServerBoardDocument: vi.fn(), listServerBoards: vi.fn(), deleteServerBoard: vi.fn() }));
vi.mock("./localBoardStorage", async (original) => ({ ...await original<typeof import("./localBoardStorage")>(), loadLocalBoard: vi.fn(), saveLocalBoard: vi.fn() }));
vi.mock("./waitForLocalBoardSave", () => ({ waitForLocalBoardSave: vi.fn() }));
vi.mock("./useLocalBoardPersistence", () => ({ flushLocalBoardSave: vi.fn(), captureLocalBoard: vi.fn() }));

const user = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", displayName: "Owner" };
const first = { id: "22222222-2222-4222-8222-222222222222", title: "First", role: "owner" as const, createdAt: 1, updatedAt: 1 };
const second = { ...first, id: "33333333-3333-4333-8333-333333333333", title: "Second", createdAt: 2 };
const initialBoard = useBoardStore.getState();
const empty = { schemaVersion: 1 as const, content: { objects: [] } };
let controller: WorkspaceController, session: AccountBoardSession, client: QueryClient, stop: () => void;
let records: Map<string, LocalBoardRecord>, storage: Map<string, string>, tabStorage: Map<string, string>;
let browser: EventTarget & { location: { href: string }; history: { state: null; pushState: ReturnType<typeof vi.fn>; replaceState: ReturnType<typeof vi.fn> } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const ready = () => vi.waitFor(() => expect(controller.getState().phase).toBe("ready"));
async function start() { stop = controller.start(); await ready(); }

beforeEach(() => {
  vi.resetAllMocks();
  storage = new Map(); tabStorage = new Map();
  const storageApi = (map: Map<string, string>) => ({ getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } });
  vi.stubGlobal("localStorage", storageApi(storage)); vi.stubGlobal("sessionStorage", storageApi(tabStorage));
  browser = Object.assign(new EventTarget(), { location: { href: "http://localhost/scribble/" }, history: { state: null,
    pushState: vi.fn((_state, _title, url) => { browser.location.href = String(url); }),
    replaceState: vi.fn((_state, _title, url) => { browser.location.href = String(url); }) } });
  vi.stubGlobal("window", browser); vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("document", Object.assign(new EventTarget(), { activeElement: null }));
  useBoardStore.setState(initialBoard);
  useInteractionStore.getState().endInteraction(); useSelectionStore.getState().clearSelection();
  const card = { ...createCardObject({ x: 10, y: 20 }, 1), id: "guest-note", title: "Retained guest drawing" };
  const guest: LocalBoardRecord = { schemaVersion: 1, id: CURRENT_BOARD_ID, title: "Guest", objects: { [card.id]: card }, viewport: { x: 50, y: 60, zoom: 2 }, createdAt: 1, updatedAt: 1 };
  records = new Map([[CURRENT_BOARD_ID, guest]]);
  useDocumentStore.getState().loadDocument(guest.objects); useViewportStore.getState().setViewport(guest.viewport);
  useBoardStore.getState().hydrate(guest, true);
  vi.mocked(loadLocalBoard).mockImplementation(async (id = CURRENT_BOARD_ID) => structuredClone(records.get(id) ?? null));
  vi.mocked(saveLocalBoard).mockImplementation(async (record) => { records.set(record.id, structuredClone(record)); });
  vi.mocked(waitForLocalBoardSave).mockResolvedValue();
  vi.mocked(getAccount).mockResolvedValue({ status: "signed-in", user }); vi.mocked(signOut).mockResolvedValue();
  vi.mocked(getServerWorkspace).mockResolvedValue({ initialized: true, lastOpenedBoardId: first.id });
  vi.mocked(listServerBoards).mockResolvedValue([first, second]);
  vi.mocked(getServerBoard).mockImplementation(async (id) => id === second.id ? second : first);
  vi.mocked(getServerBoardDocument).mockImplementation(async (boardId) => ({ ...empty, boardId, revision: 1, updatedAt: 1, role: "owner" }));
  vi.mocked(updateServerWorkspace).mockImplementation(async (input) => ({ initialized: true, lastOpenedBoardId: input.lastOpenedBoardId }));
  vi.mocked(initializeServerWorkspace).mockImplementation(async (input) => ({ workspace: { initialized: true, lastOpenedBoardId: null }, board: input.createInitialPage ? first : null,
    initialization: { requestId: input.requestId, initializedNow: true, replayed: false } }));
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  session = new AccountBoardSession(client);
  controller = new WorkspaceController(session, client);
  stop = () => {};
});
afterEach(() => { stop(); client.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); useBoardStore.setState(initialBoard); useDocumentStore.getState().loadDocument({}); useInteractionStore.getState().endInteraction(); });

describe("workspace lifecycle and navigation", () => {
  it("opens an authenticated link with no incidental first page and preserves the guest drawing", async () => {
    browser.location.href += `#share=${"A".repeat(43)}`;
    vi.mocked(getAccount).mockResolvedValue({ status: "signed-in", user, shareLinksEnabled: true });
    vi.mocked(getServerWorkspace).mockResolvedValue({ initialized: false, lastOpenedBoardId: null });
    vi.mocked(openShareLink).mockResolvedValue({ ...second, role: "viewer" });
    vi.mocked(getServerBoardDocument).mockImplementation(async (boardId) => ({ ...empty, boardId, revision: 1, updatedAt: 1, role: "viewer" }));
    await start();
    expect(initializeServerWorkspace).toHaveBeenCalledWith(expect.objectContaining({ createInitialPage: false }), expect.any(AbortSignal));
    expect(useBoardStore.getState().account?.boardId).toBe(second.id); expect(useBoardStore.getState().readOnly).toBe(true);
    expect(shareLinkIntent()).toBeNull(); expect(pageFromUrl()).toBe(second.id); expect(new URL(browser.location.href).hash).toBe("");
    expect(records.get(CURRENT_BOARD_ID)?.objects["guest-note"]).toBeDefined(); expect(createServerPage).not.toHaveBeenCalled();
  });
  it("does not read protected content or initialize a workspace for signed-out recipients", async () => {
    browser.location.href += `#share=${"A".repeat(43)}`;
    vi.mocked(getAccount).mockResolvedValue({ status: "guest", googleSignInEnabled: true, shareLinksEnabled: true });
    stop = controller.start(); await vi.waitFor(() => expect(controller.getState().status).toBe("guest"));
    expect(controller.getState().sharedPage).toBe("sign-in"); expect(openShareLink).not.toHaveBeenCalled();
    expect(getServerBoardDocument).not.toHaveBeenCalled(); expect(getServerWorkspace).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().objects["guest-note"]).toBeDefined();
  });
  it("retains a link after transient failure and retries without calling it revoked", async () => {
    browser.location.href += `#share=${"A".repeat(43)}`;
    vi.mocked(openShareLink).mockRejectedValueOnce(new TypeError("Network unavailable"));
    stop = controller.start(); await vi.waitFor(() => expect(controller.getState().sharedPage).toBe("error"));
    expect(shareLinkIntent()).not.toBeNull(); expect(getServerBoardDocument).not.toHaveBeenCalled();
    vi.mocked(openShareLink).mockResolvedValue(second); await controller.retry(); await ready();
    expect(useBoardStore.getState().account?.boardId).toBe(second.id); expect(shareLinkIntent()).toBeNull();
  });
  it("reports invalid/revoked links without falling back to another protected document", async () => {
    browser.location.href += `#share=${"A".repeat(43)}`;
    vi.mocked(openShareLink).mockRejectedValue(new BoardApiError(404, "SHARE_LINK_UNAVAILABLE", "Unavailable"));
    stop = controller.start(); await vi.waitFor(() => expect(controller.getState().sharedPage).toBe("unavailable"));
    expect(getServerBoardDocument).not.toHaveBeenCalled(); expect(initializeServerWorkspace).not.toHaveBeenCalled();
    expect(controller.getState().error).not.toContain(first.title);
  });
  it("retains a new page request through lost responses/reload and opens its confirmed destination", async () => {
    await start();
    vi.mocked(createServerPage).mockRejectedValueOnce(new TypeError("Lost create response"));
    expect(await controller.newPage()).toBe(false);
    expect(useBoardStore.getState().account?.boardId).toBe(first.id);
    const [payload] = vi.mocked(createServerPage).mock.calls[0];
    expect(payload).toEqual({ requestId: expect.any(String), title: "Untitled", initializeDocument: true });
    stop(); controller = new WorkspaceController(session, client); await start();
    vi.mocked(createServerPage).mockResolvedValue({ board: second, creation: { requestId: payload.requestId, documentRevision: 1, replayed: true, expiresAt: Date.now() + 100000 } });
    expect(await controller.newPage()).toBe(true);
    expect(vi.mocked(createServerPage).mock.calls[1]).toEqual([payload, expect.any(AbortSignal), user.id]);
    expect(getServerBoard).toHaveBeenCalledWith(second.id, expect.any(AbortSignal), user.id);
    expect(getServerBoardDocument).toHaveBeenCalledWith(second.id, expect.any(AbortSignal), user.id);
    expect(pageFromUrl()).toBe(second.id); expect(tabStorage.size).toBe(0);
    expect(useDocumentStore.getState().past).toHaveLength(0);
  });
  it("requires new page intent persistence before dispatch and leaves the current canvas intact", async () => {
    await start();
    vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => { throw new Error("Storage unavailable"); } });
    expect(await controller.newPage()).toBe(false); expect(createServerPage).not.toHaveBeenCalled();
    expect(useBoardStore.getState().account?.boardId).toBe(first.id);
    expect(controller.getState().creationError).toContain("Storage unavailable");
  });
  it("reopens a known new page after a failed document read without another creation request", async () => {
    await start();
    vi.mocked(createServerPage).mockImplementation(async (payload) => ({ board: second, creation: { requestId: payload.requestId, documentRevision: 1, replayed: false, expiresAt: Date.now() + 100000 } }));
    vi.mocked(getServerBoardDocument).mockRejectedValueOnce(new TypeError("Document unavailable"));
    expect(await controller.newPage()).toBe(false);
    expect(useBoardStore.getState().account?.boardId).toBe(first.id);
    expect(await controller.newPage()).toBe(true); expect(createServerPage).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch two new page requests or replace native composition", async () => {
    await start(); document.dispatchEvent(new Event("compositionstart"));
    expect(await controller.newPage()).toBe(false); expect(createServerPage).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("compositionend"));
    const gate = deferred<Awaited<ReturnType<typeof createServerPage>>>(); vi.mocked(createServerPage).mockReturnValue(gate.promise);
    const work = controller.newPage(); await vi.waitFor(() => expect(createServerPage).toHaveBeenCalledTimes(1));
    expect(await controller.newPage()).toBe(false);
    gate.resolve({ board: second, creation: { requestId: vi.mocked(createServerPage).mock.calls[0][0].requestId, documentRevision: 1, replayed: false, expiresAt: Date.now() + 100000 } });
    expect(await work).toBe(true);
  });
  it("waits for initial guest hydration even when the guest lease is passive", async () => {
    useBoardStore.setState({ isHydrated: false, tabReadOnly: true });
    stop = controller.start();
    await vi.waitFor(() => expect(controller.getState().status).toBe("workspace"));
    expect(getServerWorkspace).not.toHaveBeenCalled(); expect(session.getState().userId).toBeNull();
    useBoardStore.setState({ isHydrated: true }); await ready();
    expect(useBoardStore.getState().account?.boardId).toBe(first.id);
  });
  it("initializes once, reads the current document, and never imports guest objects", async () => {
    vi.mocked(getServerWorkspace).mockResolvedValue({ initialized: false, lastOpenedBoardId: null });
    vi.mocked(listServerBoards).mockResolvedValue([]);
    await start();
    expect(initializeServerWorkspace).toHaveBeenCalledWith({ requestId: expect.any(String), createInitialPage: true }, expect.any(AbortSignal));
    expect(getServerBoardDocument).toHaveBeenCalledWith(first.id, expect.any(AbortSignal), user.id);
    expect(useDocumentStore.getState().objects).toEqual({});
    expect(records.get(CURRENT_BOARD_ID)?.objects["guest-note"]).toBeDefined();
    await vi.waitFor(() => expect(updateServerWorkspace).toHaveBeenCalledWith({ lastOpenedBoardId: first.id }, expect.any(AbortSignal)));
  });
  it("prefers an explicit page URL and preserves the deployed base, hash and invitation", async () => {
    browser.location.href = `http://localhost/scribble/?page=${second.id}&invite=${first.id}#canvas`;
    await start();
    expect(useBoardStore.getState().account?.boardId).toBe(second.id);
    expect(browser.location.href).toBe(`http://localhost/scribble/?page=${second.id}&invite=${first.id}#canvas`);
    expect(initializeServerWorkspace).not.toHaveBeenCalled();
  });
  it("retains a deliberate page target across the Google redirect", async () => {
    browser.location.href += `?page=${second.id}`; rememberPageIntent();
    browser.location.href = "http://localhost/scribble/";
    await start();
    expect(pageFromUrl()).toBe(second.id); expect(tabStorage.size).toBe(0);
  });
  it("chooses owned pages before shared pages when there is no preference", async () => {
    vi.mocked(getServerWorkspace).mockResolvedValue({ initialized: true, lastOpenedBoardId: null });
    vi.mocked(listServerBoards).mockResolvedValue([{ ...second, role: "viewer", createdAt: 0 }, first]);
    await start(); expect(useBoardStore.getState().account?.boardId).toBe(first.id);
  });
  it("does not treat a failed list as empty or initialize a new page", async () => {
    vi.mocked(getServerWorkspace).mockResolvedValue({ initialized: false, lastOpenedBoardId: null });
    vi.mocked(listServerBoards).mockRejectedValue(new TypeError("Offline"));
    stop = controller.start(); await vi.waitFor(() => expect(controller.getState().phase).toBe("error"));
    expect(initializeServerWorkspace).not.toHaveBeenCalled(); expect(session.getState().userId).toBe(user.id);
  });
  it("reuses a persisted initialization UUID after a lost response and reload", async () => {
    vi.mocked(getServerWorkspace).mockResolvedValue({ initialized: false, lastOpenedBoardId: null });
    vi.mocked(listServerBoards).mockResolvedValue([]);
    vi.mocked(initializeServerWorkspace).mockRejectedValueOnce(new TypeError("Lost response"));
    stop = controller.start(); await vi.waitFor(() => expect(controller.getState().phase).toBe("error"));
    const intent = vi.mocked(initializeServerWorkspace).mock.calls[0][0];
    stop(); controller = new WorkspaceController(session, client); await start();
    expect(vi.mocked(initializeServerWorkspace).mock.calls[1][0]).toEqual(intent);
    expect(storage.size).toBe(0);
  });
  it("requires durable intent storage before the first initialization dispatch", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("Storage unavailable"); } });
    vi.mocked(getServerWorkspace).mockResolvedValue({ initialized: false, lastOpenedBoardId: null });
    stop = controller.start(); await vi.waitFor(() => expect(controller.getState().phase).toBe("error"));
    expect(initializeServerWorkspace).not.toHaveBeenCalled();
  });
  it("reserves transfer priority without creating or opening a default page", async () => {
    vi.mocked(getServerWorkspace).mockResolvedValue({ initialized: false, lastOpenedBoardId: null });
    controller = new WorkspaceController(session, client, () => ({ pendingTransfer: true }));
    stop = controller.start(); await vi.waitFor(() => expect(controller.getState().phase).toBe("transfer-pending"));
    expect(vi.mocked(initializeServerWorkspace).mock.calls[0][0].createInitialPage).toBe(false);
    expect(getServerBoardDocument).not.toHaveBeenCalled();
  });
  it("lets an explicit page take priority over a reserved transfer", async () => {
    browser.location.href += `?page=${second.id}`;
    controller = new WorkspaceController(session, client, () => ({ pendingTransfer: true }));
    await start(); expect(pageFromUrl()).toBe(second.id);
  });
  it("keeps current account, document and history through account service failures", async () => {
    await start(); const board = useBoardStore.getState();
    useDocumentStore.getState().addObject(createCardObject({ x: 5, y: 5 }, 1));
    const document = useDocumentStore.getState();
    vi.mocked(getAccount).mockRejectedValue(new TypeError("Service unavailable"));
    await controller.checkAccount();
    expect(controller.getState().status).toBe("service-error"); expect(session.getState().userId).toBe(user.id);
    expect(useBoardStore.getState().id).toBe(board.id); expect(useDocumentStore.getState().past).toBe(document.past);
  });
  it("never treats an account timeout as confirmed sign-out", async () => {
    await start(); vi.useFakeTimers();
    vi.mocked(getAccount).mockImplementation((signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
    const checking = controller.checkAccount(); await vi.advanceTimersByTimeAsync(20_001); await checking;
    expect(controller.getState().status).toBe("service-error"); expect(session.getState().userId).toBe(user.id);
    expect(useBoardStore.getState().account?.boardId).toBe(first.id);
  });
  it("refreshes identity without following another device's last-opened page", async () => {
    await start(); vi.mocked(getServerWorkspace).mockResolvedValue({ initialized: true, lastOpenedBoardId: second.id });
    await controller.checkAccount(); expect(getServerWorkspace).toHaveBeenCalledTimes(1); expect(pageFromUrl()).toBe(first.id);
  });
  it("keeps the current page after failed Back/Forward and restores its URL", async () => {
    await start(); browser.location.href = `http://localhost/scribble/?page=${second.id}`;
    vi.mocked(getServerBoard).mockRejectedValue(new TypeError("Offline"));
    await controller.enter("replace", true);
    expect(useBoardStore.getState().account?.boardId).toBe(first.id); expect(pageFromUrl()).toBe(first.id);
    expect(controller.getState().phase).toBe("ready");
  });
  it("opens Back/Forward with fresh reads, isolated history, selection and page viewport", async () => {
    await start();
    const card = createCardObject({ x: 2, y: 3 }, 1); useDocumentStore.getState().addObject(card);
    useSelectionStore.getState().selectOnly(card.id);
    await session.open(second); expect(pageFromUrl()).toBe(second.id);
    const secondRecord = records.get(useBoardStore.getState().id)!;
    records.set(secondRecord.id, { ...secondRecord, viewport: { x: 100, y: 200, zoom: 3 } });
    browser.location.href = `http://localhost/scribble/?page=${first.id}`; browser.dispatchEvent(new Event("popstate"));
    await vi.waitFor(() => expect(useBoardStore.getState().account?.boardId).toBe(first.id));
    expect(useDocumentStore.getState().past).toEqual([]); expect(useSelectionStore.getState().selectedIds.size).toBe(0);
    expect(vi.mocked(getServerBoardDocument).mock.calls.filter(([id]) => id === first.id)).toHaveLength(2);
    browser.location.href = `http://localhost/scribble/?page=${second.id}`; await controller.enter("replace", true);
    expect(useViewportStore.getState().viewport).toEqual({ x: 100, y: 200, zoom: 3 });
  });
  it("ignores stale page metadata after a newer navigation", async () => {
    await start(); const gate = deferred<typeof second>();
    vi.mocked(getServerBoard).mockImplementation(async (id) => id === second.id ? gate.promise : first);
    browser.location.href = `http://localhost/scribble/?page=${second.id}`; const old = controller.enter();
    await vi.waitFor(() => expect(getServerBoard).toHaveBeenCalledWith(second.id, expect.any(AbortSignal)));
    browser.location.href = `http://localhost/scribble/?page=${first.id}`; await controller.enter();
    gate.resolve(second); await old;
    expect(pageFromUrl()).toBe(first.id); expect(useBoardStore.getState().account?.boardId).toBe(first.id);
  });
  it("rechecks current viewer access and blocks canvas mutations", async () => {
    vi.mocked(getServerBoard).mockResolvedValue({ ...first, role: "viewer" });
    vi.mocked(getServerBoardDocument).mockResolvedValue({ ...empty, boardId: first.id, revision: 1, updatedAt: 1, role: "viewer" });
    await start(); expect(useBoardStore.getState().readOnly).toBe(true); expect(useBoardStore.getState().accessRole).toBe("viewer");
  });
  it("falls back from an inaccessible URL and terminates when all candidates disappear", async () => {
    browser.location.href += `?page=${first.id}`;
    vi.mocked(getServerBoard).mockRejectedValue(new BoardApiError(404, "BOARD_NOT_FOUND", "Unavailable"));
    stop = controller.start(); await vi.waitFor(() => expect(controller.getState().phase).toBe("empty"));
    expect(getServerBoard).toHaveBeenCalledTimes(2); expect(initializeServerWorkspace).not.toHaveBeenCalled(); expect(pageFromUrl()).toBeNull();
  });
  it("deletes the final page into an intentional empty workspace without loading guest", async () => {
    await start(); vi.mocked(listServerBoards).mockResolvedValue([]);
    vi.mocked(getServerWorkspace).mockResolvedValue({ initialized: true, lastOpenedBoardId: null });
    vi.mocked(deleteServerBoard).mockResolvedValue();
    await session.remove(first);
    expect(controller.getState().phase).toBe("empty"); expect(initializeServerWorkspace).not.toHaveBeenCalled();
    expect(useBoardStore.getState().account?.boardId).toBe(first.id); expect(pageFromUrl()).toBeNull();
  });
  it("preserves pending account draft and returns to the retained guest on sign-out", async () => {
    await start(); const board = useBoardStore.getState();
    const draft = serializeDocumentSnapshot({ note: { ...createCardObject({ x: 1, y: 1 }, 1), id: "note" } });
    useBoardStore.getState().setAccount({ ...board.account!, pendingSave: { document: draft, expectedRevision: 1 } });
    records.set(board.id, { ...records.get(board.id)!, account: useBoardStore.getState().account! });
    await controller.logout();
    expect(controller.getState().status).toBe("guest"); expect(session.getState().userId).toBeNull();
    expect(useDocumentStore.getState().objects["guest-note"]).toBeDefined(); expect(records.get(board.id)?.account?.pendingSave).toBeDefined();
    expect(client.getQueryCache().findAll({ queryKey: ["account-boards"] })).toHaveLength(0);
  });
  it("protects drafts on confirmed expiry rather than treating it as a service failure", async () => {
    await start(); vi.mocked(getAccount).mockResolvedValue({ status: "guest", googleSignInEnabled: true });
    await controller.checkAccount();
    expect(controller.getState().status).toBe("expired"); expect(useBoardStore.getState().account).toBeNull(); expect(pageFromUrl()).toBeNull();
  });
  it("does not send logout when the local draft cannot be preserved", async () => {
    await start(); vi.mocked(waitForLocalBoardSave).mockRejectedValue(new Error("Device save failed"));
    await controller.logout(); expect(signOut).not.toHaveBeenCalled(); expect(session.getState().userId).toBe(user.id);
  });
  it("does not replace in-progress native composition during navigation", async () => {
    await start(); document.dispatchEvent(new Event("compositionstart"));
    browser.location.href = `http://localhost/scribble/?page=${second.id}`;
    await controller.enter("replace", true);
    expect(pageFromUrl()).toBe(first.id); expect(useBoardStore.getState().account?.boardId).toBe(first.id);
    document.dispatchEvent(new Event("compositionend")); await controller.enter(); expect(pageFromUrl()).toBe(first.id);
  });
  it("ignores a late auth response after the mounted controller stops", async () => {
    const gate = deferred<Awaited<ReturnType<typeof getAccount>>>(); vi.mocked(getAccount).mockReturnValue(gate.promise);
    stop = controller.start(); stop(); gate.resolve({ status: "signed-in", user });
    await Promise.resolve(); expect(session.getState().userId).toBeNull(); expect(getServerWorkspace).not.toHaveBeenCalled();
  });
  it("ignores an older account check after another account is confirmed", async () => {
    await start();
    const gate = deferred<Awaited<ReturnType<typeof getAccount>>>();
    vi.mocked(getAccount).mockReturnValueOnce(gate.promise);
    const old = controller.checkAccount();
    const other = { ...user, id: "44444444-4444-4444-8444-444444444444" };
    vi.mocked(getAccount).mockResolvedValue({ status: "signed-in", user: other });
    await controller.checkAccount(); gate.resolve({ status: "signed-in", user }); await old;
    expect(controller.getState().account).toEqual({ status: "signed-in", user: other });
    expect(useBoardStore.getState().account?.ownerId).toBe(other.id);
  });
  it("cancels an in-flight page read when expiry is confirmed by the session", async () => {
    await start(); const gate = deferred<typeof second>();
    vi.mocked(getServerBoard).mockReturnValueOnce(gate.promise);
    const opening = controller.openPage(second.id);
    await vi.waitFor(() => expect(getServerBoard).toHaveBeenCalledWith(second.id, expect.any(AbortSignal)));
    session.expire(); gate.resolve(second); await opening;
    await vi.waitFor(() => expect(useBoardStore.getState().account).toBeNull());
    expect(controller.getState().status).toBe("expired");
  });
  it("only remembers a page after its document opens successfully", async () => {
    await start(); await vi.waitFor(() => expect(updateServerWorkspace).toHaveBeenCalledTimes(1));
    vi.mocked(getServerBoardDocument).mockRejectedValueOnce(new TypeError("Document unavailable"));
    await controller.openPage(second.id);
    expect(pageFromUrl()).toBe(first.id); expect(updateServerWorkspace).toHaveBeenCalledTimes(1);
    expect(useBoardStore.getState().navigationPending).toBe(false);
  });
  it("keeps preferences ordered when an older successful open is slow", async () => {
    const gate = deferred<Awaited<ReturnType<typeof updateServerWorkspace>>>();
    vi.mocked(updateServerWorkspace).mockReturnValueOnce(gate.promise);
    await start(); await controller.openPage(second.id);
    expect(updateServerWorkspace).toHaveBeenCalledTimes(1);
    gate.resolve({ initialized: true, lastOpenedBoardId: first.id });
    await vi.waitFor(() => expect(updateServerWorkspace).toHaveBeenCalledTimes(2));
    expect(vi.mocked(updateServerWorkspace).mock.calls[1][0].lastOpenedBoardId).toBe(second.id);
  });
  it("retains the newest queued preference through a same-account identity check", async () => {
    const gate = deferred<Awaited<ReturnType<typeof updateServerWorkspace>>>();
    vi.mocked(updateServerWorkspace).mockReturnValueOnce(gate.promise);
    await start(); await controller.openPage(second.id); await controller.checkAccount();
    gate.resolve({ initialized: true, lastOpenedBoardId: first.id });
    await vi.waitFor(() => expect(updateServerWorkspace).toHaveBeenCalledTimes(2));
    expect(vi.mocked(updateServerWorkspace).mock.calls[1][0].lastOpenedBoardId).toBe(second.id);
  });
  it("clears the old account cache before opening a different account", async () => {
    await start();
    const other = { ...user, id: "44444444-4444-4444-8444-444444444444" };
    vi.mocked(getAccount).mockResolvedValue({ status: "signed-in", user: other });
    await controller.checkAccount(); await ready();
    expect(session.getState().userId).toBe(other.id); expect(useBoardStore.getState().account?.ownerId).toBe(other.id);
    expect(client.getQueryCache().findAll({ queryKey: ["account-boards", user.id] })).toHaveLength(0);
  });
});
