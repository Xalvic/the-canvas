import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  BoardApiError, BoardSignInRequired,
  type ServerBoard,
} from "../api/boards";
import { AccountBoardQueries } from "../api/accountBoardQueries";
import { useBoardStore, DEFAULT_BOARD_TITLE } from "../store/boardStore";
import { useDocumentStore } from "../store/documentStore";
import { useViewportStore, initialViewport } from "../store/viewportStore";
import { useSelectionStore } from "../store/selectionStore";
import { useInteractionStore } from "../store/interactionStore";
import { useAppearancePreviewStore } from "../store/appearancePreviewStore";
import { deserializeCanvasDocument, serializeDocumentSnapshot } from "./canvasDocumentAdapters";
import type { CanvasDocument } from "./canvasDocument";
import {
  accountBoardStorageId, CURRENT_BOARD_ID, LOCAL_BOARD_SCHEMA_VERSION,
  loadLocalBoard, saveLocalBoard, type AccountBoardLink, type LocalBoardRecord,
} from "./localBoardStorage";
import { captureLocalBoard } from "./useLocalBoardPersistence";
import { waitForLocalBoardSave } from "./waitForLocalBoardSave";

type CloudStatus = "local" | "saved" | "unsaved" | "saving" | "conflict" | "error" | "signed-out";
type SessionState = {
  userId: string | null;
  busy: boolean;
  status: CloudStatus;
  error: string | null;
  hasRecovery: boolean;
  accountVersion: number;
};

const blankDocument = (): CanvasDocument => serializeDocumentSnapshot({});
const sameDocument = (a: CanvasDocument, b: CanvasDocument) => JSON.stringify(a) === JSON.stringify(b);
const titleNow = () => useBoardStore.getState().title.trim() || DEFAULT_BOARD_TITLE;
const message = (error: unknown) => error instanceof Error ? error.message : "Couldn’t save your account board.";

/** Only committed store changes enter this queue. Pointer previews stay in the editor. */
export class AccountBoardSession {
  private state: SessionState = { userId: null, busy: false, status: "local", error: null, hasRecovery: false, accountVersion: 0 };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: AbortController | null = null;
  private saving: Promise<void> | null = null;
  private operationSession = 0;
  private returnToGuest = false;
  private queries: AccountBoardQueries;

  constructor(queryClient: QueryClient) {
    this.queries = new AccountBoardQueries(queryClient);
  }

  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private clearTimer() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }

  start() {
    const changed = () => {
      const board = useBoardStore.getState();
      if (!board.isHydrated || !board.account) return;
      if (this.state.userId !== board.account.ownerId) { this.update({ status: "signed-out" }); return; }
      if (["conflict", "error"].includes(this.state.status)) return;
      this.update({ status: "unsaved" });
      this.clearTimer();
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.state.busy && this.state.status === "unsaved") void this.save();
      }, 700);
    };
    const documentUnsubscribe = useDocumentStore.subscribe((state, previous) => {
      if (state.objects !== previous.objects) changed();
    });
    const boardUnsubscribe = useBoardStore.subscribe((state, previous) => {
      if (state.isHydrated && previous.isHydrated && state.sessionVersion === previous.sessionVersion &&
          state.title !== previous.title) changed();
    });
    return () => { documentUnsubscribe(); boardUnsubscribe(); this.clearTimer(); this.request?.abort(); };
  }

  setUser = (userId: string | null) => {
    if (userId === this.state.userId) return;
    this.clearTimer(); this.request?.abort();
    this.queries.clear();
    this.update({ userId, error: null });
    const account = useBoardStore.getState().account;
    if (account && account.ownerId !== userId) {
      this.update({ status: "signed-out" });
      // Keep the scoped draft before returning to the guest canvas.
      this.returnToGuest = this.state.busy;
      if (!this.state.busy) void this.back();
    } else if (account) {
      this.update({ status: account.pendingSave ? "error" : "unsaved" });
      if (!account.pendingSave) void this.save();
    }
  };

  expire = () => {
    this.setUser(null);
    this.update({ accountVersion: this.state.accountVersion + 1 });
  };

  private fail(error: unknown) {
    if (error instanceof BoardSignInRequired) { this.expire(); return; }
    const conflict = error instanceof BoardApiError && error.code === "REVISION_CONFLICT";
    this.update({ status: useBoardStore.getState().account ? (conflict ? "conflict" : "error") : "local", error: message(error) });
  }

  private assertIdle() {
    if (useInteractionStore.getState().mode !== "idle") throw new Error("Finish the current canvas interaction before switching boards.");
  }

  private applyRecord(record: LocalBoardRecord, signal: AbortSignal, persist = false) {
    if (signal.aborted) throw new Error("Board switch cancelled.");
    if (useBoardStore.getState().sessionVersion !== this.operationSession) throw new Error("The active board changed. Please open the board again.");
    this.assertIdle();
    useBoardStore.setState({ isHydrated: false });
    useAppearancePreviewStore.getState().cancel();
    useSelectionStore.getState().clearSelection();
    useDocumentStore.getState().loadDocument(record.objects);
    useViewportStore.getState().setViewport(record.viewport);
    useBoardStore.getState().hydrate({
      id: record.id, title: record.title, createdAt: record.createdAt,
      updatedAt: record.updatedAt, account: record.account,
    }, true);
    this.operationSession = useBoardStore.getState().sessionVersion;
    // Loaded remote/recovery content uses the same serial local autosave queue.
    if (persist && record.account) useBoardStore.getState().setAccount({ ...record.account });
  }

  private async replace(record: LocalBoardRecord, signal: AbortSignal, persist = false) {
    await waitForLocalBoardSave(signal);
    this.applyRecord(record, signal, persist);
  }

  private async preserveAndReplace(record: LocalBoardRecord, signal: AbortSignal) {
    // A user can edit while the remote read or IndexedDB backup is pending.
    // Repeat the backup until it covers the exact state we are about to replace.
    while (!signal.aborted) {
      await waitForLocalBoardSave(signal);
      this.assertIdle();
      if (useBoardStore.getState().sessionVersion !== this.operationSession) throw new Error("The active board changed. Please try again.");
      const recovery = captureLocalBoard();
      await saveLocalBoard({ ...recovery, id: `${recovery.id}:recovery` });
      await waitForLocalBoardSave(signal);
      if (useDocumentStore.getState().objects !== recovery.objects ||
          titleNow() !== recovery.title || useViewportStore.getState().viewport !== recovery.viewport) continue;
      this.applyRecord({ ...record, viewport: recovery.viewport }, signal, true);
      return;
    }
  }

  private async operation(work: (signal: AbortSignal) => Promise<void>) {
    if (this.state.busy) return;
    this.clearTimer();
    this.update({ busy: true, error: null });
    // Complete the current save before any metadata operation or board switch.
    await this.saving;
    const controller = new AbortController();
    this.request = controller;
    this.operationSession = useBoardStore.getState().sessionVersion;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try { await work(controller.signal); }
    catch (error) {
      if (!controller.signal.aborted) this.fail(error);
      else if (this.request === controller) this.update({ error: "The request was interrupted. Your draft stays on this device.", status: useBoardStore.getState().account ? "error" : "local" });
    } finally {
      clearTimeout(timeout);
      if (this.request === controller) { this.request = null; this.update({ busy: false }); }
      const account = useBoardStore.getState().account;
      if (this.returnToGuest && account && account.ownerId !== this.state.userId && !this.state.busy) {
        this.returnToGuest = false;
        void this.back();
      }
      else if (this.state.status === "unsaved" && !this.state.busy) void this.save();
    }
  }

  private async readDocument(boardId: string, signal: AbortSignal) {
    const ownerId = this.state.userId;
    if (!ownerId) throw new BoardSignInRequired();
    try { return await this.queries.document(ownerId, boardId, signal); }
    catch (error) {
      if (error instanceof BoardApiError && error.code === "DOCUMENT_NOT_FOUND") return { ...blankDocument(), boardId, revision: 0, updatedAt: Date.now() };
      throw error;
    }
  }

  open = (board: ServerBoard) => this.operation(async (signal) => {
    const ownerId = this.state.userId;
    if (!ownerId) throw new BoardSignInRequired();
    if (useBoardStore.getState().account?.boardId === board.id && useBoardStore.getState().account?.ownerId === ownerId) return;
    this.assertIdle();
    const id = accountBoardStorageId(ownerId, board.id);
    const draft = await loadLocalBoard(id);
    const remote = await this.readDocument(board.id, signal);
    if (signal.aborted || this.state.userId !== ownerId) return;
    const document: CanvasDocument = { schemaVersion: remote.schemaVersion, content: remote.content };
    let unsupportedDraft = false;
    let draftDocument: CanvasDocument | null = null;
    if (draft) {
      try { draftDocument = serializeDocumentSnapshot(draft.objects); }
      catch { unsupportedDraft = true; }
    }
    const dirty = draft?.account && (
      draft.account.pendingSave || draft.title !== draft.account.savedTitle ||
      unsupportedDraft || (draftDocument !== null && !sameDocument(draftDocument, draft.account.savedDocument))
    );
    let record: LocalBoardRecord;
    let status: CloudStatus = "saved";
    if (dirty && draft?.account) {
      record = draft;
      const pending = draft.account.pendingSave;
      // A lost response can be confirmed after a reload without another write.
      if (pending && remote.revision === pending.expectedRevision + 1 && sameDocument(document, pending.document)) {
        record = { ...draft, account: { ...draft.account, revision: remote.revision, savedDocument: document, pendingSave: undefined } };
        status = "unsaved";
      } else if (remote.revision !== draft.account.revision) status = "conflict";
      else status = pending || unsupportedDraft ? "error" : "unsaved";
    } else {
      record = {
        schemaVersion: LOCAL_BOARD_SCHEMA_VERSION, id, title: board.title,
        objects: deserializeCanvasDocument(document), viewport: draft?.viewport ?? initialViewport,
        createdAt: board.createdAt ?? Date.now(), updatedAt: Date.now(),
        account: { ownerId, boardId: board.id, revision: remote.revision, savedDocument: document, savedTitle: board.title },
      };
    }
    await saveLocalBoard(record);
    const recovery = await loadLocalBoard(`${id}:recovery`);
    await this.replace(record, signal);
    if (!signal.aborted) this.update({ status: remote.revision === 0 && status === "saved" ? "unsaved" : status, hasRecovery: recovery !== null,
      error: unsupportedDraft ? "Image-containing documents are unsupported for account saves until durable asset storage is available. Your draft is kept on this device." : null });
  });

  back = () => this.operation(async (signal) => {
    const guest = await loadLocalBoard(CURRENT_BOARD_ID);
    if (!guest) throw new Error("The local board could not be opened. Your current draft is still available.");
    await this.replace(guest, signal);
    if (!signal.aborted) this.update({ status: "local", hasRecovery: false });
  });

  private create = (copy: boolean) => this.operation(async (signal) => {
    const ownerId = this.state.userId;
    if (!ownerId) throw new BoardSignInRequired();
    this.assertIdle();
    await waitForLocalBoardSave(signal);
    // Validate before POST: images are kept local until durable assets exist.
    const document = copy ? serializeDocumentSnapshot(useDocumentStore.getState().objects) : blankDocument();
    const title = copy ? titleNow() : DEFAULT_BOARD_TITLE;
    const remote = await this.queries.create(ownerId, title, signal);
    if (signal.aborted || this.state.userId !== ownerId) return;
    const record: LocalBoardRecord = {
      schemaVersion: LOCAL_BOARD_SCHEMA_VERSION, id: accountBoardStorageId(ownerId, remote.id),
      title, objects: deserializeCanvasDocument(document),
      viewport: copy ? useViewportStore.getState().viewport : initialViewport,
      createdAt: remote.createdAt ?? Date.now(), updatedAt: Date.now(),
      account: { ownerId, boardId: remote.id, revision: 0, savedDocument: blankDocument(), savedTitle: title },
    };
    await saveLocalBoard(record);
    await this.replace(record, signal);
    if (!signal.aborted) {
      this.update({ status: "unsaved", hasRecovery: false });
      // A blank new board needs an explicit first document write too.
      await this.save(true, signal);
    }
  });
  upload = () => this.create(true);
  createBlank = () => this.create(false);
  saveCopy = () => this.create(true);

  save = async (force = false, operationSignal?: AbortSignal): Promise<void> => {
    if (this.saving) return this.saving;
    const account = useBoardStore.getState().account;
    if (!account || this.state.userId !== account.ownerId || (!force && this.state.busy)) return;
    const controller = operationSignal ? null : new AbortController();
    const signal = operationSignal ?? controller!.signal;
    if (controller) this.request = controller;
    const id = useBoardStore.getState().id;
    const session = useBoardStore.getState().sessionVersion;
    const current = () => !signal.aborted && useBoardStore.getState().id === id && useBoardStore.getState().sessionVersion === session && this.state.userId === account.ownerId;
    const timeout = controller ? setTimeout(() => controller.abort(), 20000) : null;
    this.update({ status: "saving", error: null });
    this.saving = (async () => {
      try {
        let link: AccountBoardLink = account;
        if (link.pendingSave) {
          const remote = await this.readDocument(link.boardId, signal);
          if (!current()) return;
          const document: CanvasDocument = { schemaVersion: remote.schemaVersion, content: remote.content };
          if (remote.revision === link.pendingSave.expectedRevision + 1 && sameDocument(document, link.pendingSave.document)) {
            link = { ...link, revision: remote.revision, savedDocument: document, pendingSave: undefined };
          } else if (remote.revision === link.pendingSave.expectedRevision) link = { ...link, pendingSave: undefined };
          else throw new BoardApiError(409, "REVISION_CONFLICT", "This board changed elsewhere.", remote.revision);
          useBoardStore.getState().setAccount(link);
        }
        const document = serializeDocumentSnapshot(useDocumentStore.getState().objects);
        const title = titleNow();
        if (force || link.revision === 0 || !sameDocument(document, link.savedDocument)) {
          link = { ...link, pendingSave: { document, expectedRevision: link.revision } };
          useBoardStore.getState().setAccount(link);
          // Persist the submission marker before sending a write with an uncertain outcome.
          await waitForLocalBoardSave(signal);
          if (!current()) return;
          const remote = await this.queries.save(account.ownerId, link.boardId, document, link.revision, signal);
          if (!current()) return;
          link = { ...link, revision: remote.revision, savedDocument: { schemaVersion: remote.schemaVersion, content: remote.content }, pendingSave: undefined };
          useBoardStore.getState().setAccount(link);
        }
        if (title !== link.savedTitle) {
          const renamed = await this.queries.rename(account.ownerId, link.boardId, title, signal);
          if (!current()) return;
          link = { ...link, savedTitle: renamed.title };
          useBoardStore.getState().setAccount(link);
        }
        if (!current()) return;
        const dirty = titleNow() !== link.savedTitle || !sameDocument(serializeDocumentSnapshot(useDocumentStore.getState().objects), link.savedDocument);
        this.update({ status: dirty ? "unsaved" : "saved" });
      } catch (error) {
        if (current()) this.fail(error);
        else if (signal.aborted && useBoardStore.getState().id === id && this.state.userId === account.ownerId) this.update({ status: "error", error: "The save was interrupted. Retry to check whether it reached your account." });
      }
    })();
    await this.saving;
    this.saving = null;
    if (timeout) clearTimeout(timeout);
    if (controller && this.request === controller) this.request = null;
    if (current() && this.state.status === "unsaved" && !this.state.busy) void this.save();
  };

  reload = () => this.operation(async (signal) => {
    const board = useBoardStore.getState();
    if (!board.account || board.account.ownerId !== this.state.userId) throw new BoardSignInRequired();
    const remote = await this.readDocument(board.account.boardId, signal);
    const metadata = (await this.queries.list(board.account.ownerId, signal)).find((item) => item.id === board.account!.boardId);
    if (!metadata) throw new Error("This account board no longer exists.");
    const document: CanvasDocument = { schemaVersion: remote.schemaVersion, content: remote.content };
    const record: LocalBoardRecord = {
      ...captureLocalBoard(), title: metadata.title, objects: deserializeCanvasDocument(document),
      account: { ...board.account, revision: remote.revision, savedDocument: document, savedTitle: metadata.title, pendingSave: undefined },
    };
    // Keep the current draft intact until its backup and remote read succeed.
    await this.preserveAndReplace(record, signal);
    if (!signal.aborted) {
      this.update({ status: "saved", hasRecovery: true });
    }
  });

  restore = () => this.operation(async (signal) => {
    const board = useBoardStore.getState();
    if (!board.account || board.account.ownerId !== this.state.userId) throw new BoardSignInRequired();
    const recovery = await loadLocalBoard(`${board.id}:recovery`);
    if (!recovery) throw new Error("No previous draft is available on this device.");
    const record = { ...recovery, id: board.id };
    await this.preserveAndReplace(record, signal);
    if (!signal.aborted) this.update({ status: "conflict", hasRecovery: true });
  });

  rename = (board: ServerBoard, title: string) => this.operation(async (signal) => {
    const ownerId = this.state.userId;
    if (!ownerId) throw new BoardSignInRequired();
    if (useBoardStore.getState().account?.boardId === board.id) {
      useBoardStore.getState().setTitle(title);
      if (!["conflict", "error"].includes(this.state.status)) this.update({ status: "unsaved" });
    } else await this.queries.rename(ownerId, board.id, title, signal);
  });

  remove = (board: ServerBoard) => this.operation(async (signal) => {
    const ownerId = this.state.userId;
    if (!ownerId) throw new BoardSignInRequired();
    // Preserve any active draft before deletion; deleting never destroys IndexedDB records.
    await waitForLocalBoardSave(signal);
    await this.queries.remove(ownerId, board.id, signal);
    if (signal.aborted) return;
    if (useBoardStore.getState().account?.boardId === board.id) {
      const guest = await loadLocalBoard();
      if (!guest) throw new Error("Deleted from your account. Your draft stays on this device.");
      await this.replace(guest, signal);
      this.update({ status: "local", hasRecovery: false });
    }
  });
}

export function useAccountBoardSession() {
  const queryClient = useQueryClient();
  const [session] = useState(() => new AccountBoardSession(queryClient));
  const state = useSyncExternalStore(session.subscribe, session.getState);
  useEffect(() => session.start(), [session]);
  return { session, state };
}
