import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  createServerBoard, getServerBoard, getServerBoardDocument, listServerBoards, renameServerBoard, saveServerBoardDocument,
  type ServerBoardDocument,
} from "../api/boards";
import { createCardObject, createImageObject } from "../canvas/objects/objectFactories";
import { getAsset } from "../assets/assetStore";
import { uploadBoardAsset, downloadBoardAsset } from "../api/assets";
import { useBoardStore } from "../store/boardStore";
import { useDocumentStore } from "../store/documentStore";
import { useSelectionStore } from "../store/selectionStore";
import { useViewportStore } from "../store/viewportStore";
import { AccountBoardSession } from "./accountBoardSession";
import type { CanvasDocument } from "./canvasDocument";
import { deserializeCanvasDocument, serializeDocumentSnapshot } from "./canvasDocumentAdapters";
import {
  accountBoardStorageId, CURRENT_BOARD_ID, LOCAL_BOARD_SCHEMA_VERSION,
  loadLocalBoard, saveLocalBoard, type LocalBoardRecord,
} from "./localBoardStorage";
import { waitForLocalBoardSave } from "./waitForLocalBoardSave";
import { captureLocalBoard } from "./useLocalBoardPersistence";

vi.mock("../api/boards", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api/boards")>(),
  createServerBoard: vi.fn(),
  deleteServerBoard: vi.fn(),
  getServerBoard: vi.fn(),
  getServerBoardDocument: vi.fn(),
  listServerBoards: vi.fn(),
  renameServerBoard: vi.fn(),
  saveServerBoardDocument: vi.fn(),
}));
vi.mock("./localBoardStorage", async (importOriginal) => ({
  ...await importOriginal<typeof import("./localBoardStorage")>(),
  loadLocalBoard: vi.fn(),
  saveLocalBoard: vi.fn(),
}));
vi.mock("./waitForLocalBoardSave", () => ({ waitForLocalBoardSave: vi.fn() }));
vi.mock("../assets/assetStore", () => ({ getAsset: vi.fn() }));
vi.mock("../api/assets", () => ({ uploadBoardAsset: vi.fn(), downloadBoardAsset: vi.fn() }));

const ownerId = "owner-1";
const metadata = { id: "board-1", title: "Account board", createdAt: 10, updatedAt: 20 };
const initialBoard = useBoardStore.getState();
const records = new Map<string, LocalBoardRecord>();
let session: AccountBoardSession;
let stop: () => void;
let queryClient: QueryClient;

function document(body: string): CanvasDocument {
  const card = {
    ...createCardObject({ x: 10, y: 20 }, 1),
    id: "card-1", body, createdAt: 10, updatedAt: 20,
  };
  return serializeDocumentSnapshot({ [card.id]: card });
}

function remote(document: CanvasDocument, revision: number): ServerBoardDocument {
  return { ...document, boardId: metadata.id, revision, updatedAt: 100 };
}

function guestRecord(): LocalBoardRecord {
  return {
    schemaVersion: LOCAL_BOARD_SCHEMA_VERSION, id: CURRENT_BOARD_ID,
    title: "Guest work", objects: deserializeCanvasDocument(document("Guest note")),
    viewport: { x: 30, y: -50, zoom: 0.8 }, createdAt: 10, updatedAt: 20,
  };
}

function accountRecord(current = document("Draft"), baseline = document("Saved")): LocalBoardRecord {
  return {
    ...guestRecord(), id: accountBoardStorageId(ownerId, metadata.id), title: metadata.title,
    objects: deserializeCanvasDocument(current),
    account: { ownerId, boardId: metadata.id, revision: 2, savedDocument: baseline, savedTitle: metadata.title },
  };
}

function hydrate(record: LocalBoardRecord) {
  useBoardStore.setState({ isHydrated: false });
  useDocumentStore.getState().loadDocument(structuredClone(record.objects));
  useViewportStore.getState().setViewport(record.viewport);
  useBoardStore.getState().hydrate({
    id: record.id, title: record.title, createdAt: record.createdAt,
    updatedAt: record.updatedAt, account: structuredClone(record.account),
  }, true);
  useBoardStore.getState().setAccessRole(record.account ? "owner" : null);
}

function startAccount(record: LocalBoardRecord) {
  stop();
  hydrate(record);
  stop = session.start();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function drain() {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  records.clear();
  useBoardStore.setState(initialBoard);
  useSelectionStore.getState().clearSelection();
  hydrate(guestRecord());
  records.set(CURRENT_BOARD_ID, guestRecord());
  vi.mocked(loadLocalBoard).mockImplementation(async (id = CURRENT_BOARD_ID) => structuredClone(records.get(id) ?? null));
  vi.mocked(saveLocalBoard).mockImplementation(async (record) => { records.set(record.id, structuredClone(record)); });
  vi.mocked(waitForLocalBoardSave).mockResolvedValue(undefined);
  vi.mocked(getServerBoardDocument).mockResolvedValue(remote(document("Saved"), 2));
  vi.mocked(listServerBoards).mockResolvedValue([metadata]);
  vi.mocked(getServerBoard).mockResolvedValue(metadata);
  vi.mocked(saveServerBoardDocument).mockImplementation(async (_id, content, expected) => remote(content, expected + 1));
  vi.mocked(createServerBoard).mockResolvedValue(metadata);
  vi.mocked(renameServerBoard).mockImplementation(async (id, title) => ({ ...metadata, id, title }));
  vi.mocked(getAsset).mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  vi.mocked(downloadBoardAsset).mockResolvedValue(new Blob(["png"], { type: "image/png" }));
  vi.mocked(uploadBoardAsset).mockImplementation(async (boardId) => ({
    id: "550e8400-e29b-41d4-a716-446655440010", boardId, mimeType: "image/png",
    byteSize: 3, width: 20, height: 10, createdAt: 10,
  }));
  queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  session = new AccountBoardSession(queryClient);
  session.setUser(ownerId);
  stop = session.start();
});

afterEach(() => {
  stop();
  queryClient.clear();
  vi.useRealTimers();
  useBoardStore.setState(initialBoard);
  useDocumentStore.getState().loadDocument({});
  useSelectionStore.getState().clearSelection();
});

function localImage(assetId = "local-image") {
  return { ...createImageObject({ assetId, center: { x: 30, y: 30 }, width: 20, height: 10,
    originalWidth: 20, originalHeight: 10, mimeType: "image/png", name: "Draft image", zIndex: 2 }), id: assetId };
}

describe("explicit account image uploads", () => {
  it("keeps local images out of autosave until explicit upload, without changing undo history", async () => {
    startAccount(accountRecord(document("Saved")));
    const image = localImage();
    useDocumentStore.getState().addObject(image);
    const history = useDocumentStore.getState().past;
    await session.save();
    expect(uploadBoardAsset).not.toHaveBeenCalled();
    expect(saveServerBoardDocument).not.toHaveBeenCalled();
    await session.uploadImages();
    expect(uploadBoardAsset).toHaveBeenCalledTimes(1);
    expect(useDocumentStore.getState().past).toBe(history);
    expect(useDocumentStore.getState().objects[image.id]).toEqual(image);
    expect(useBoardStore.getState().account?.imageAssets).toEqual({ "local-image": "550e8400-e29b-41d4-a716-446655440010" });
    expect(saveServerBoardDocument).toHaveBeenCalledWith(metadata.id,
      expect.objectContaining({ content: { objects: expect.arrayContaining([expect.objectContaining({ type: "image", assetId: "550e8400-e29b-41d4-a716-446655440010" })]) } }), 2, expect.any(AbortSignal));
    useDocumentStore.getState().undo();
    await session.save();
    useDocumentStore.getState().redo();
    await session.save();
    expect(uploadBoardAsset).toHaveBeenCalledTimes(1);
    expect(session.getState().status).toBe("saved");
  });

  it("persists each completed upload and retries only missing images after a failure", async () => {
    startAccount(accountRecord(document("Saved")));
    useDocumentStore.getState().addObjects([localImage("first"), localImage("second")]);
    vi.mocked(uploadBoardAsset).mockResolvedValueOnce({ id: "550e8400-e29b-41d4-a716-446655440010", boardId: metadata.id,
      mimeType: "image/png", width: 20, height: 10, byteSize: 3, createdAt: 10 }).mockRejectedValueOnce(new Error("Provider offline"));
    await session.uploadImages();
    expect(session.getState()).toMatchObject({ status: "error", error: "Provider offline" });
    expect(useBoardStore.getState().account?.imageAssets).toHaveProperty("first");
    expect(saveServerBoardDocument).not.toHaveBeenCalled();
    const record = captureLocalBoard();
    startAccount(structuredClone(record));
    await session.uploadImages();
    expect(uploadBoardAsset).toHaveBeenCalledTimes(3);
    expect(session.getState().status).toBe("saved");
  });

  it("uploads source-board bytes into a new board instead of reusing its asset reference", async () => {
    const image = { ...localImage("550e8400-e29b-41d4-a716-446655440020"),
      cloudAsset: { boardId: "source-board", assetId: "550e8400-e29b-41d4-a716-446655440020" } };
    const record = accountRecord(document("Saved")); record.objects[image.id] = image;
    startAccount(record);
    await session.saveCopy();
    expect(downloadBoardAsset).toHaveBeenCalledExactlyOnceWith("source-board", image.assetId, expect.any(AbortSignal));
    expect(uploadBoardAsset).toHaveBeenCalledTimes(1);
    expect(saveServerBoardDocument).toHaveBeenCalledWith(metadata.id,
      expect.objectContaining({ content: { objects: expect.arrayContaining([expect.objectContaining({ type: "image", assetId: "550e8400-e29b-41d4-a716-446655440010" })]) } }), 0, expect.any(AbortSignal));
  });

  it("does not upload while signed out or with viewer access", async () => {
    startAccount(accountRecord());
    useDocumentStore.getState().addObject(localImage());
    useBoardStore.getState().setAccessRole("viewer");
    await session.uploadImages();
    expect(uploadBoardAsset).not.toHaveBeenCalled();
    expect(session.getState().error).toMatch(/Editing access/);
  });
});

describe("account draft save queue", () => {
  it("opens a viewer snapshot and preserves an old editable draft without sending writes", async () => {
    const draft = accountRecord(); records.set(draft.id, draft);
    vi.mocked(getServerBoardDocument).mockResolvedValue({ ...remote(document("Saved"), 2), role: "viewer" });
    await session.open({ ...metadata, role: "viewer" });
    expect(useBoardStore.getState().readOnly).toBe(true);
    expect(session.getState().status).toBe("read-only");
    expect(records.get(`${draft.id}:recovery`)?.objects).toEqual(draft.objects);
    useDocumentStore.getState().addObject(createCardObject({ x: 0, y: 0 }, 2));
    useBoardStore.getState().setTitle("Forbidden rename");
    await session.save();
    expect(useDocumentStore.getState().objects).toEqual(deserializeCanvasDocument(document("Saved")));
    expect(useBoardStore.getState().title).toBe(metadata.title);
    expect(saveServerBoardDocument).not.toHaveBeenCalled();
    await session.back();
    expect(useBoardStore.getState().readOnly).toBe(false);
  });

  it("stops a queued autosave on downgrade and keeps the exact local draft", async () => {
    startAccount(accountRecord());
    useDocumentStore.getState().updateObject("card-1", { body: "Waiting edit" });
    const objects = useDocumentStore.getState().objects;
    vi.mocked(getServerBoard).mockResolvedValue({ ...metadata, role: "viewer" });
    await session.refreshAccess();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saveServerBoardDocument).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().objects).toBe(objects);
    expect(useBoardStore.getState().readOnly).toBe(true);
    expect(session.getState().status).toBe("read-only");
  });

  it("checks a pending save's current permission before retrying", async () => {
    const draft = accountRecord(); draft.account!.pendingSave = { document: document("Draft"), expectedRevision: 2 };
    startAccount(draft);
    vi.mocked(getServerBoardDocument).mockResolvedValue({ ...remote(document("Saved"), 2), role: "viewer" });
    await session.save();
    expect(saveServerBoardDocument).not.toHaveBeenCalled();
    expect(useBoardStore.getState().account?.pendingSave).toEqual(draft.account!.pendingSave);
    expect(session.getState().status).toBe("read-only");
  });
  it("reconciles an accepted pending submission without writing it again", async () => {
    const submitted = document("Submitted");
    const record = accountRecord(submitted);
    record.account!.pendingSave = { document: submitted, expectedRevision: 2 };
    startAccount(record);
    vi.mocked(getServerBoardDocument).mockResolvedValue(remote(submitted, 3));

    await session.save();

    expect(saveServerBoardDocument).not.toHaveBeenCalled();
    expect(useBoardStore.getState().account).toMatchObject({ revision: 3, savedDocument: submitted });
    expect(useBoardStore.getState().account?.pendingSave).toBeUndefined();
    expect(session.getState().status).toBe("saved");
  });

  it("retries an unaccepted pending submission against the unchanged revision", async () => {
    const submitted = document("Submitted");
    const record = accountRecord(submitted);
    record.account!.pendingSave = { document: submitted, expectedRevision: 2 };
    startAccount(record);

    await session.save();

    expect(saveServerBoardDocument).toHaveBeenCalledExactlyOnceWith(metadata.id, submitted, 2, expect.any(AbortSignal));
    expect(useBoardStore.getState().account?.revision).toBe(3);
    expect(useBoardStore.getState().account?.pendingSave).toBeUndefined();
    expect(session.getState().status).toBe("saved");
  });

  it("keeps pending drafts in conflict when an unrelated newer revision exists", async () => {
    const submitted = document("Submitted");
    const record = accountRecord(submitted);
    record.account!.pendingSave = { document: submitted, expectedRevision: 2 };
    startAccount(record);
    vi.mocked(getServerBoardDocument).mockResolvedValue(remote(document("Other device"), 4));

    await session.save();

    expect(saveServerBoardDocument).not.toHaveBeenCalled();
    expect(useBoardStore.getState().account?.pendingSave).toEqual(record.account!.pendingSave);
    expect(useDocumentStore.getState().objects).toEqual(record.objects);
    expect(session.getState().status).toBe("conflict");
  });

  it("keeps the exact pending draft when a response arrives after local tab ownership is lost", async () => {
    const submitted = document("Before ownership loss");
    startAccount(accountRecord(submitted));
    const response = deferred<ServerBoardDocument>();
    vi.mocked(saveServerBoardDocument).mockImplementationOnce(() => response.promise);
    const saving = session.save();
    await drain();
    expect(saveServerBoardDocument).toHaveBeenCalledTimes(1);
    const pending = useBoardStore.getState().account;
    useBoardStore.getState().setTabReadOnly(true);
    response.resolve(remote(document("Late remote result"), 3));
    await saving;
    expect(useBoardStore.getState().account).toBe(pending);
    expect(serializeDocumentSnapshot(useDocumentStore.getState().objects)).toEqual(submitted);
    expect(vi.mocked(saveServerBoardDocument).mock.calls[0][3]?.aborted).toBe(true);
  });

  it("serializes edits made during a request into the next save with the accepted revision", async () => {
    const submitted = document("First edit");
    const record = accountRecord(submitted);
    startAccount(record);
    const first = deferred<ServerBoardDocument>();
    vi.mocked(saveServerBoardDocument).mockImplementationOnce(() => first.promise);

    const saving = session.save();
    await drain();
    expect(saveServerBoardDocument).toHaveBeenCalledTimes(1);
    useDocumentStore.getState().updateObject("card-1", { body: "New edit" });
    const newest = serializeDocumentSnapshot(useDocumentStore.getState().objects);
    first.resolve(remote(submitted, 3));
    await saving;
    await drain();

    expect(saveServerBoardDocument).toHaveBeenCalledTimes(2);
    expect(saveServerBoardDocument).toHaveBeenNthCalledWith(2, metadata.id, newest, 3, expect.any(AbortSignal));
    expect(useBoardStore.getState().account?.savedDocument).toEqual(newest);
    expect(useBoardStore.getState().account?.revision).toBe(4);
    expect(session.getState().status).toBe("saved");
  });
});

describe("account board transitions", () => {
  it("cancels a queued switch and the active save when the account changes", async () => {
    const record = accountRecord();
    record.account!.pendingSave = { document: document("Pending submission"), expectedRevision: 2 };
    startAccount(record);
    const gate = deferred<ServerBoardDocument>();
    vi.mocked(getServerBoardDocument).mockReturnValueOnce(gate.promise);
    const saving = session.save(); await drain();
    const opening = session.open({ ...metadata, id: "next-board" });
    session.setUser(null);
    gate.resolve(remote(document("Saved"), 2));
    await saving; await opening; await drain();
    expect(getServerBoardDocument).toHaveBeenCalledTimes(1);
    expect(saveServerBoardDocument).not.toHaveBeenCalled();
    expect(vi.mocked(getServerBoardDocument).mock.calls[0][1]?.aborted).toBe(true);
    expect(useBoardStore.getState().account).toBeNull();
  });
  it("keeps the guest canvas intact when saving a new scoped record fails", async () => {
    const guest = useDocumentStore.getState().objects;
    vi.mocked(saveLocalBoard).mockRejectedValue(new Error("Device storage full"));

    await session.open(metadata);

    expect(useBoardStore.getState().id).toBe(CURRENT_BOARD_ID);
    expect(useBoardStore.getState().account).toBeNull();
    expect(useDocumentStore.getState().objects).toBe(guest);
    expect(saveServerBoardDocument).not.toHaveBeenCalled();
    expect(session.getState().error).toBe("Device storage full");
  });

  it("blocks explicit upload before POST when the guest autosave failed", async () => {
    vi.mocked(waitForLocalBoardSave).mockRejectedValue(new Error("Could not save your canvas"));

    await session.upload();

    expect(createServerBoard).not.toHaveBeenCalled();
    expect(useBoardStore.getState().id).toBe(CURRENT_BOARD_ID);
    expect(session.getState().error).toBe("Could not save your canvas");
  });

  it("keeps guest work open when the upload's scoped draft cannot be persisted", async () => {
    const guest = useDocumentStore.getState().objects;
    vi.mocked(saveLocalBoard).mockRejectedValue(new Error("Device storage full"));

    await session.upload();

    expect(createServerBoard).toHaveBeenCalledTimes(1);
    expect(useBoardStore.getState().id).toBe(CURRENT_BOARD_ID);
    expect(useDocumentStore.getState().objects).toBe(guest);
    expect(saveServerBoardDocument).not.toHaveBeenCalled();
    expect(session.getState().error).toBe("Device storage full");
  });

  it("restores the separate guest document, viewport, selection and history boundary", async () => {
    startAccount(accountRecord());
    const extra = { ...createCardObject({ x: 0, y: 0 }, 2), id: "extra" };
    useDocumentStore.getState().addObject(extra);
    useDocumentStore.getState().updateObject(extra.id, { body: "Changed" });
    useDocumentStore.getState().undo();
    useSelectionStore.getState().selectOnly(extra.id);
    expect(useDocumentStore.getState().past.length).toBeGreaterThan(0);
    expect(useDocumentStore.getState().future.length).toBeGreaterThan(0);
    const previousSession = useBoardStore.getState().sessionVersion;

    await session.back();

    expect(useBoardStore.getState()).toMatchObject({ id: CURRENT_BOARD_ID, title: "Guest work", account: null });
    expect(useDocumentStore.getState().objects).toEqual(guestRecord().objects);
    expect(useViewportStore.getState().viewport).toEqual(guestRecord().viewport);
    expect(useDocumentStore.getState().past).toEqual([]);
    expect(useDocumentStore.getState().future).toEqual([]);
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
    expect(useBoardStore.getState().sessionVersion).toBeGreaterThan(previousSession);
    expect(session.getState().status).toBe("local");
  });

  it("opens a dirty scoped draft as a conflict without overwriting either version", async () => {
    const draft = accountRecord(document("My unsaved work"));
    records.set(draft.id, draft);
    vi.mocked(getServerBoardDocument).mockResolvedValue(remote(document("Other device"), 3));

    await session.open(metadata);
    await drain();
    await vi.advanceTimersByTimeAsync(1000);

    expect(useBoardStore.getState().id).toBe(draft.id);
    expect(useDocumentStore.getState().objects).toEqual(draft.objects);
    expect(useBoardStore.getState().account?.revision).toBe(2);
    expect(saveServerBoardDocument).not.toHaveBeenCalled();
    expect(session.getState().status).toBe("conflict");
  });

  it("discards an open response after the signed-in account changes", async () => {
    const pending = deferred<ServerBoardDocument>();
    vi.mocked(getServerBoardDocument).mockImplementationOnce(() => pending.promise);
    const opening = session.open(metadata);
    await drain();
    session.setUser(null);
    pending.resolve(remote(document("Remote"), 2));
    await opening;

    expect(useBoardStore.getState().id).toBe(CURRENT_BOARD_ID);
    expect(useDocumentStore.getState().objects).toEqual(guestRecord().objects);
    expect(saveLocalBoard).not.toHaveBeenCalled();
    expect(saveServerBoardDocument).not.toHaveBeenCalled();
  });

  it("discards an open response after a different local board session takes over", async () => {
    const pending = deferred<ServerBoardDocument>();
    vi.mocked(getServerBoardDocument).mockImplementationOnce(() => pending.promise);
    const opening = session.open(metadata);
    await drain();
    const replacement = { ...guestRecord(), title: "New local session", objects: deserializeCanvasDocument(document("Replacement")) };
    hydrate(replacement);
    pending.resolve(remote(document("Remote"), 2));
    await opening;

    expect(useBoardStore.getState().id).toBe(CURRENT_BOARD_ID);
    expect(useBoardStore.getState().title).toBe(replacement.title);
    expect(useDocumentStore.getState().objects).toEqual(replacement.objects);
    expect(saveServerBoardDocument).not.toHaveBeenCalled();
  });

  it("backs up edits committed while recovery storage is pending before adopting the remote document", async () => {
    const draft = accountRecord(document("Original draft"));
    startAccount(draft);
    const remoteDocument = document("Other device");
    vi.mocked(getServerBoardDocument).mockResolvedValue(remote(remoteDocument, 4));
    const firstBackup = deferred<void>();
    let backupPending = true;
    vi.mocked(saveLocalBoard).mockImplementation(async (record) => {
      if (backupPending && record.id === `${draft.id}:recovery`) {
        backupPending = false;
        await firstBackup.promise;
      }
      records.set(record.id, structuredClone(record));
    });
    const adoptedRecords: LocalBoardRecord[] = [];
    const unsubscribe = useBoardStore.subscribe((state, previous) => {
      if (
        state.isHydrated && previous.isHydrated && state.sessionVersion === previous.sessionVersion &&
        state.account !== previous.account
      ) adoptedRecords.push(captureLocalBoard());
    });

    try {
      const reloading = session.reload();
      await drain();
      expect(saveLocalBoard).toHaveBeenCalledTimes(1);
      expect(useDocumentStore.getState().objects).toEqual(draft.objects);
      useDocumentStore.getState().updateObject("card-1", { body: "Edited during backup" });
      useBoardStore.getState().setTitle("Renamed during backup");
      const latestObjects = useDocumentStore.getState().objects;
      firstBackup.resolve();
      await reloading;

      const recoveryWrites = vi.mocked(saveLocalBoard).mock.calls.filter(([record]) => record.id === `${draft.id}:recovery`);
      expect(recoveryWrites).toHaveLength(2);
      expect(records.get(`${draft.id}:recovery`)).toMatchObject({ title: "Renamed during backup", objects: latestObjects });
      expect(useDocumentStore.getState().objects).toEqual(deserializeCanvasDocument(remoteDocument));
      expect(adoptedRecords).toHaveLength(1);
      expect(adoptedRecords[0]).toMatchObject({
        id: draft.id, title: metadata.title, objects: deserializeCanvasDocument(remoteDocument),
        account: { revision: 4, savedDocument: remoteDocument, savedTitle: metadata.title },
      });
      expect(session.getState()).toMatchObject({ status: "saved", hasRecovery: true, busy: false });
      await vi.advanceTimersByTimeAsync(1000);
      expect(saveServerBoardDocument).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it.each(["signout", "expiry"] as const)("settles after one failed guest return on account %s", async (action) => {
    const draft = accountRecord();
    startAccount(draft);
    vi.mocked(waitForLocalBoardSave).mockRejectedValue(new Error("Could not save your canvas"));

    if (action === "signout") session.setUser(null);
    else session.expire();
    await drain();

    expect(loadLocalBoard).not.toHaveBeenCalled();
    expect(waitForLocalBoardSave).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ userId: null, busy: false, status: "error", error: "Could not save your canvas" });
    expect(useBoardStore.getState().id).toBe(draft.id);
    expect(useDocumentStore.getState().objects).toEqual(draft.objects);
    await vi.advanceTimersByTimeAsync(1000);
    await drain();
    expect(loadLocalBoard).not.toHaveBeenCalled();
    expect(saveServerBoardDocument).not.toHaveBeenCalled();
  });
});
