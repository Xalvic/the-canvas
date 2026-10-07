import { boardTabCoordinator, BOARD_TAB_READ_ONLY_MESSAGE } from "./boardTabCoordinator";
import { accountEditorJournals, activeBoardLeaseId, journalIsDirty } from "./accountEditorJournals";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  BoardApiError, BoardSignInRequired, getServerBoard, getServerBoardDocument, type BoardRole,
  type ServerBoard,
} from "../api/boards";
import { AccountBoardQueries } from "../api/accountBoardQueries";
import { useBoardStore, DEFAULT_BOARD_TITLE } from "../store/boardStore";
import { useDocumentStore } from "../store/documentStore";
import { useViewportStore, initialViewport } from "../store/viewportStore";
import { useSelectionStore } from "../store/selectionStore";
import { useInteractionStore } from "../store/interactionStore";
import { useAppearancePreviewStore } from "../store/appearancePreviewStore";
import { useUiStore } from "../store/uiStore";
import { CANCEL_TOUCH_INTERACTIONS_EVENT } from "../canvas/viewport/pointerInteractionEvents";
import { deserializeCanvasDocument, serializeDocumentSnapshot } from "./canvasDocumentAdapters";
import type { CanvasDocument } from "./canvasDocument";
import {
  accountBoardStorageId, CURRENT_BOARD_ID, LOCAL_BOARD_SCHEMA_VERSION,
  loadLocalBoard, loadLegacyLocalBoard, saveLocalBoard, latestDetachedRecovery, type AccountBoardLink, type LocalBoardRecord,
} from "./localBoardStorage";
import { captureLocalBoard } from "./useLocalBoardPersistence";
import { waitForLocalBoardSave } from "./waitForLocalBoardSave";
import { getAsset } from "../assets/assetStore";
import { MAX_CLOUD_IMAGE_BYTES } from "../api/assets";
import { authorizeAccountImages, missingAccountImages, PendingImageUpload, uploadAccountImage } from "./accountImageUploads";
import { clearCloudImageAccess } from "../assets/cloudImageAccess";
import { sendBoardPresence } from "../api/collaboration";
import { z } from "zod";
import type { Viewport } from "../canvas/viewport/viewportMath";
import { documentChanges, mergeCollaborativeDocuments, sameObject } from "./collaborationMerge";
import { useCollaborationStore } from "../store/collaborationStore";

type CloudStatus = "local" | "saved" | "unsaved" | "saving" | "pending" | "consent" | "conflict" | "error" | "signed-out" | "read-only";
type SessionState = {
  userId: string | null;
  busy: boolean;
  status: CloudStatus;
  error: string | null;
  hasRecovery: boolean;
  accountVersion: number;
  imageUpload: { completed: number; total: number } | null;
  editorDrafts: { id: string; title: string; updatedAt: number }[];
};

const blankDocument = (): CanvasDocument => serializeDocumentSnapshot({});
const sameDocument = (a: CanvasDocument, b: CanvasDocument) => JSON.stringify(a) === JSON.stringify(b);
const titleNow = () => useBoardStore.getState().title.trim() || DEFAULT_BOARD_TITLE;
const message = (error: unknown) => error instanceof z.ZodError ? error.issues[0]?.message ?? "The draft contains an unsupported value."
  : error instanceof Error ? error.message : "Couldn’t save your account board.";
const accountDocument = (objects: Parameters<typeof serializeDocumentSnapshot>[0], account: AccountBoardLink) =>
  serializeDocumentSnapshot(objects, { boardId: account.boardId, imageAssets: account.imageAssets });
const liveRevisionSchema = z.object({ revision: z.number().int().nonnegative(), role: z.enum(["owner", "editor", "viewer"]) });
const livePresenceSchema = z.object({ participants: z.array(z.object({
  clientId: z.uuid(), userId: z.uuid(), displayName: z.string().max(320).nullable(),
  cursor: z.object({ x: z.number().finite().min(-1e9).max(1e9), y: z.number().finite().min(-1e9).max(1e9) }).nullable(),
  selectedIds: z.array(z.string().min(1).max(256)).max(100),
})).max(32) });

/** Only committed store changes enter this queue. Pointer previews stay in the editor. */
export class AccountBoardSession {
  private state: SessionState = { userId: null, busy: false, status: "local", error: null, hasRecovery: false, accountVersion: 0, imageUpload: null, editorDrafts: [] };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempts = 0;
  private retryNotBefore = 0;
  private request: AbortController | null = null;
  private pendingOperationRequest: AbortController | null = null;
  private saving: Promise<void> | null = null;
  private operationSession = 0;
  private returnToGuest = false;
  private queries: AccountBoardQueries;
  private liveStream: EventSource | null = null;
  private liveKey = "";
  private liveRetry: ReturnType<typeof setTimeout> | null = null;
  private liveAttempts = 0;
  private liveRefreshPending = false;
  private liveReading = false;
  private applyingRemote = false;
  private readonly clientId = crypto.randomUUID();
  // Installed by the mounted workspace controller; legacy callers remain usable.
  onPageDeleted: (() => Promise<void>) | null = null;
  private failure: unknown = null;
  getFailure = () => this.failure;

  constructor(queryClient: QueryClient, private live = false) {
    this.queries = new AccountBoardQueries(queryClient);
  }

  getState = () => this.state;
  /** Explicit user cancellation; completed writes/mappings stay recoverable. */
  cancelOperation = () => { this.clearRetry(); this.request?.abort(); this.pendingOperationRequest?.abort(); };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private clearTimer() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private clearRetry(reset = true) {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (reset) { this.retryAttempts = 0; this.retryNotBefore = 0; }
  }
  private online() { return typeof navigator === "undefined" || navigator.onLine !== false; }
  private armRetry() {
    if (!this.online() || this.retryTimer !== null || this.state.busy) return;
    const version = useBoardStore.getState().sessionVersion, user = this.state.userId;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (useBoardStore.getState().sessionVersion === version && this.state.userId === user && !this.state.busy) void this.save();
    }, Math.max(0, this.retryNotBefore - Date.now()));
  }
  private scheduleRetry(error: unknown) {
    const retryable = error instanceof PendingImageUpload ? error.retryable : error instanceof TypeError ||
      error instanceof BoardApiError && (error.status === 408 || error.status === 429 || error.status >= 500);
    if (!retryable || this.retryAttempts >= 3 || useBoardStore.getState().readOnly || !this.state.userId) {
      this.clearRetry(false); return;
    }
    const delay = Math.max(1000 * 2 ** this.retryAttempts,
      error instanceof PendingImageUpload || error instanceof BoardApiError ? error.retryAfterMs ?? 0 : 0);
    this.retryAttempts++;
    this.retryNotBefore = Math.max(this.retryNotBefore, Date.now() + delay);
    this.update({ status: "pending", error: null });
    this.clearRetry(false);
    this.armRetry();
  }
  retrySave = () => { this.clearRetry(); return this.save(); };

  private closeLive() {
    this.liveStream?.close(); this.liveStream = null;
    if (this.liveRetry) clearTimeout(this.liveRetry);
    this.liveRetry = null;
    if (this.live) useCollaborationStore.getState().clear();
  }

  private connectLive() {
    if (!this.live || typeof EventSource === "undefined") return;
    const board = useBoardStore.getState();
    const account = board.account;
    const key = account && board.isHydrated && this.state.userId === account.ownerId
      ? `${account.ownerId}:${account.boardId}:${board.sessionVersion}` : "";
    if (key === this.liveKey) return;
    this.closeLive(); this.liveKey = key; this.liveAttempts = 0;
    if (!key || !account) return;
    const connect = () => {
      if (this.liveKey !== key) return;
      useCollaborationStore.getState().setSession({ clientId: this.clientId, status: this.liveAttempts ? "reconnecting" : "connecting" });
      const stream = new EventSource(`/api/boards/${encodeURIComponent(account.boardId)}/events?clientId=${this.clientId}`);
      this.liveStream = stream;
      stream.onopen = () => {
        if (this.liveKey !== key) return;
        this.liveAttempts = 0;
        useCollaborationStore.getState().setSession({ clientId: this.clientId, status: "connected" });
        this.liveRefreshPending = true; void this.refreshLive();
      };
      stream.addEventListener("revision", (event) => {
        if (this.liveKey !== key) return;
        try {
          const data = liveRevisionSchema.parse(JSON.parse((event as MessageEvent).data));
          this.access(data.role);
          if (data.revision > (useBoardStore.getState().account?.revision ?? 0)) {
            this.liveRefreshPending = true; void this.refreshLive();
          }
        } catch { /* Malformed hints never change durable content. */ }
      });
      stream.addEventListener("presence", (event) => {
        if (this.liveKey !== key) return;
        try {
          const data = livePresenceSchema.parse(JSON.parse((event as MessageEvent).data));
          useCollaborationStore.getState().setParticipants(data.participants);
        } catch { /* A malformed presence frame is transient. */ }
      });
      stream.addEventListener("access", (event) => {
        if (this.liveKey !== key) return;
        stream.close(); this.liveStream = null;
        useCollaborationStore.getState().clear();
        try {
          if (JSON.parse((event as MessageEvent).data).code === "UNAUTHENTICATED") this.expire();
          else this.access("none");
        } catch { this.access("none"); }
      });
      stream.onerror = () => {
        stream.close(); if (this.liveKey !== key) return;
        this.liveStream = null;
        this.liveAttempts += 1;
        useCollaborationStore.getState().setSession({ clientId: this.clientId, status: this.liveAttempts > 8 ? "error" : "reconnecting" });
        if (this.liveAttempts <= 8) this.liveRetry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** (this.liveAttempts - 1)));
      };
    };
    connect();
  }

  publishPresence = (cursor: { x: number; y: number } | null, selectedIds: string[]) => {
    const board = useBoardStore.getState();
    if (!this.live || !board.account || this.state.userId !== board.account.ownerId || board.accessRole === "none") return;
    void sendBoardPresence(board.account.boardId, this.clientId, cursor, selectedIds).catch(() => undefined);
  };

  private applyLiveDocument(document: CanvasDocument, local: CanvasDocument, link: AccountBoardLink) {
    const existing = useDocumentStore.getState().objects;
    const normalized = new Map(local.content.objects.map((object) => [object.id, object]));
    const incoming = deserializeCanvasDocument(document, link.boardId);
    for (const object of document.content.objects) {
      if (Object.hasOwn(existing, object.id) && sameObject(normalized.get(object.id), object)) incoming[object.id] = existing[object.id];
    }
    this.applyingRemote = true;
    try { useDocumentStore.getState().applyRemoteDocument(incoming); }
    finally { this.applyingRemote = false; }
  }

  private async refreshLive() {
    if (!this.liveRefreshPending || this.liveReading) return;
    if (this.state.busy || this.saving || useInteractionStore.getState().mode !== "idle") return;
    const board = useBoardStore.getState(), link = board.account;
    if (!link || link.ownerId !== this.state.userId || link.pendingSave || link.pendingOperation || link.pendingTitle || ["conflict", "error"].includes(this.state.status)) return;
    if (missingAccountImages(useDocumentStore.getState().objects, link).length) return;
    this.liveReading = true; this.liveRefreshPending = false;
    const session = board.sessionVersion, controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const remote = await this.readDocument(link.boardId, controller.signal);
      if (this.state.userId !== link.ownerId || useBoardStore.getState().sessionVersion !== session) return;
      if (this.saving || this.state.busy || useInteractionStore.getState().mode !== "idle") { this.liveRefreshPending = true; return; }
      this.access(remote.role ?? "owner");
      if (remote.revision <= link.revision) return;
      const latest = useBoardStore.getState().account!;
      if (remote.revision <= latest.revision) return;
      const local = accountDocument(useDocumentStore.getState().objects, latest);
      const document: CanvasDocument = { schemaVersion: remote.schemaVersion, content: remote.content };
      const merged = mergeCollaborativeDocuments(latest.savedDocument, local, document);
      if (merged.conflicts.length) throw new BoardApiError(409, "COLLABORATION_CONFLICT", "Someone changed the same objects. Your draft stays on this device.", remote.revision);
      this.applyLiveDocument(merged.document, local, latest);
      useBoardStore.getState().setAccount({ ...latest, revision: remote.revision, savedDocument: document });
      if (!useBoardStore.getState().readOnly) this.update({ status: sameDocument(merged.document, document) && titleNow() === latest.savedTitle ? "saved" : "unsaved" });
    } catch (error) {
      if (this.state.userId === link.ownerId && useBoardStore.getState().sessionVersion === session) {
        if (error instanceof BoardApiError && error.code === "BOARD_NOT_FOUND") this.access("none");
        else this.fail(error);
      }
    } finally { clearTimeout(timeout); this.liveReading = false;
      if (this.liveRefreshPending) void this.refreshLive(); }
  }

  start() {
    const changed = () => {
      const board = useBoardStore.getState();
      if (this.applyingRemote) return;
      if (!board.isHydrated || !board.account || board.readOnly) return;
      if (this.state.userId !== board.account.ownerId) { this.update({ status: "signed-out" }); return; }
      if (["conflict", "error", "pending"].includes(this.state.status)) return;
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
      if (state.tabReadOnly && !previous.tabReadOnly) { this.clearTimer(); this.clearRetry(); this.request?.abort(); }
      if (!state.tabReadOnly && previous.tabOwnership === "unavailable") changed();
      if (state.sessionVersion !== previous.sessionVersion) this.clearRetry();
      if (state.sessionVersion !== previous.sessionVersion || state.isHydrated !== previous.isHydrated) this.connectLive();
      if (state.isHydrated && previous.isHydrated && state.sessionVersion === previous.sessionVersion &&
          state.title !== previous.title) changed();
    });
    const interactionUnsubscribe = useInteractionStore.subscribe((state) => {
      if (state.mode === "idle" && this.liveRefreshPending) void this.refreshLive();
    });
    const online = () => {
      this.closeLive(); this.liveKey = ""; this.liveAttempts = 0; this.connectLive();
      if (this.state.status === "pending") this.armRetry();
    };
    if (typeof window !== "undefined") window.addEventListener("online", online);
    this.connectLive();
    return () => { documentUnsubscribe(); boardUnsubscribe(); interactionUnsubscribe(); this.clearTimer(); this.cancelOperation(); this.closeLive();
      if (typeof window !== "undefined") window.removeEventListener("online", online); };
  }

  setUser = (userId: string | null) => {
    if (userId === this.state.userId) return;
    this.clearTimer(); this.cancelOperation();
    this.queries.clear();
    clearCloudImageAccess(userId);
    this.update({ userId, error: null, editorDrafts: [] });
    this.closeLive();
    this.liveKey = "";
    this.connectLive();
    const account = useBoardStore.getState().account;
    if (account && account.ownerId !== userId) {
      this.update({ status: "signed-out" });
      // Keep the scoped draft before returning to the guest canvas.
      this.returnToGuest = this.state.busy;
      if (!this.state.busy) void this.back();
    } else if (account && !useBoardStore.getState().readOnly) {
      this.update({ status: account.pendingSave ? "error" : "unsaved" });
      if (!account.pendingSave) void this.save();
    }
  };

  expire = () => {
    this.setUser(null);
    this.update({ accountVersion: this.state.accountVersion + 1 });
  };

  private access(role: BoardRole | "none") {
    const board = useBoardStore.getState();
    const wasReadOnly = board.accessRole === "viewer" || board.accessRole === "none";
    board.setAccessRole(role);
    if (role === "viewer" || role === "none") {
      this.clearTimer(); this.clearRetry();
      if (this.saving) this.request?.abort();
      if (typeof window !== "undefined") window.dispatchEvent(new Event(CANCEL_TOUCH_INTERACTIONS_EVENT));
      useInteractionStore.getState().endInteraction();
      useAppearancePreviewStore.getState().cancel();
      useUiStore.getState().setActiveTool("select");
      this.update({ status: "read-only", error: role === "none" ? "Access was removed. Your draft stays on this device." : null });
    } else if (wasReadOnly) {
      // Reopening checks revisions and preserves drafts before editing resumes.
      this.update({ status: "error", error: "Editing access restored. Reload the account version before saving." });
    }
  }

  refreshAccess = async () => {
    const board = useBoardStore.getState();
    if (!board.account || board.account.ownerId !== this.state.userId || this.state.busy) return;
    const id = board.id, version = board.sessionVersion, userId = this.state.userId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const current = () => useBoardStore.getState().id === id && useBoardStore.getState().sessionVersion === version && this.state.userId === userId;
    try {
      const metadata = await getServerBoard(board.account.boardId, controller.signal);
      if (current() && board.accessRole === "none" && this.state.status === "local") await this.open(metadata);
      else if (current()) this.access(metadata.role ?? "owner");
    } catch (error) {
      if (current() && error instanceof BoardSignInRequired) this.expire();
      else if (current() && error instanceof BoardApiError && error.code === "BOARD_NOT_FOUND") this.access("none");
    } finally { clearTimeout(timeout); }
  };

  refreshEditorDrafts = async () => {
    const board = useBoardStore.getState();
    if (!board.account || board.account.ownerId !== this.state.userId || !boardTabCoordinator.enabled) { this.update({ editorDrafts: [] }); return; }
    try {
      const journals = await accountEditorJournals.list(board.id);
      if (useBoardStore.getState().sessionVersion !== board.sessionVersion || this.state.userId !== board.account.ownerId) return;
      this.update({ editorDrafts: journals.filter((journal) => journal.id !== activeBoardLeaseId(board.id) && journalIsDirty(journal.board))
        .map((journal) => ({ id: journal.id, title: journal.board.title, updatedAt: journal.board.updatedAt })) });
    } catch (error) { if (useBoardStore.getState().sessionVersion === board.sessionVersion) this.update({ error: message(error) }); }
  };

  restoreEditorDraft = (key: string) => this.operation(async (signal) => {
    const board = useBoardStore.getState(), account = board.account;
    if (!account || account.ownerId !== this.state.userId || board.readOnly) throw new Error("Sign in with editing access before recovering a draft");
    this.assertIdle();
    await waitForLocalBoardSave(signal);
    const before = captureLocalBoard();
    const remote = await this.readDocument(account.boardId, signal);
    if (remote.role === "viewer") throw new Error("You can only view this page now. Its drafts were preserved.");
    const draft = await accountEditorJournals.reserve(board.id, key);
    this.assertIdle();
    if (signal.aborted || this.state.userId !== account.ownerId || useBoardStore.getState().sessionVersion !== board.sessionVersion ||
        useDocumentStore.getState().objects !== before.objects || titleNow() !== before.title) throw new Error("The canvas changed. Try recovering that draft again.");
    const document: CanvasDocument = { schemaVersion: remote.schemaVersion, content: remote.content };
    const link = draft.account!;
    let record = draft;
    let status: CloudStatus = link.pendingOperation ? (link.pendingOperation.conflicted ? "conflict" : "error") : link.pendingSave ? "error" : "unsaved";
    if (!link.pendingOperation && !link.pendingSave) {
      const local = accountDocument(draft.objects, link);
      const merged = mergeCollaborativeDocuments(link.savedDocument, local, document);
      if (merged.conflicts.length) status = "conflict";
      else record = { ...draft, objects: deserializeCanvasDocument(merged.document, link.boardId), account: { ...link, revision: remote.revision, savedDocument: document } };
    }
    // Current journal remains intact. Switch the selected journal and live
    // document together, with no await that could route old edits into it.
    accountEditorJournals.select(board.id, key);
    this.applyRecord(record, signal, true, remote.role ?? "owner");
    this.update({ status, error: null });
    await this.refreshEditorDrafts();
  });

  private fail(error: unknown) {
    this.failure = error;
    if (error instanceof BoardSignInRequired) { this.expire(); return; }
    const conflict = error instanceof BoardApiError && ["REVISION_CONFLICT", "COLLABORATION_CONFLICT"].includes(error.code);
    const account = useBoardStore.getState().account;
    if (conflict && account?.pendingOperation) useBoardStore.getState().setAccount({ ...account,
      pendingOperation: { ...account.pendingOperation, conflicted: true } });
    this.update({ status: useBoardStore.getState().account ? (conflict ? "conflict" : "error") : "local", error: message(error) });
  }

  private assertIdle() {
    if (useInteractionStore.getState().mode !== "idle") throw new Error("Finish the current canvas interaction before switching boards.");
  }

  private applyRecord(record: LocalBoardRecord, signal: AbortSignal, persist = false, role: BoardRole | "none" = "owner") {
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
    useBoardStore.getState().setTabOwnership(boardTabCoordinator.enabled ? boardTabCoordinator.status(activeBoardLeaseId(record.id)) : "owned");
    useBoardStore.getState().setAccessRole(record.account ? role : null);
    if (record.account && (role === "viewer" || role === "none")) this.access(role);
    this.operationSession = useBoardStore.getState().sessionVersion;
    // Loaded remote/recovery content uses the same serial local autosave queue.
    if (persist && record.account) useBoardStore.getState().setAccount({ ...record.account });
  }

  private async replace(record: LocalBoardRecord, signal: AbortSignal, persist = false, role: BoardRole | "none" = "owner") {
    await waitForLocalBoardSave(signal);
    this.applyRecord(record, signal, persist, role);
    if (boardTabCoordinator.enabled) await boardTabCoordinator.releaseOthers(activeBoardLeaseId(record.id));
  }

  private async preserveAndReplace(record: LocalBoardRecord, signal: AbortSignal, role: BoardRole | "none" = "owner") {
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
      this.applyRecord({ ...record, viewport: recovery.viewport }, signal, true, role);
      if (boardTabCoordinator.enabled) await boardTabCoordinator.releaseOthers(activeBoardLeaseId(record.id));
      return;
    }
  }

  private async operation(work: (signal: AbortSignal) => Promise<void>, timeoutMs = 20_000, externalSignal?: AbortSignal) {
    if (this.state.busy || externalSignal?.aborted) return false;
    this.failure = null;
    this.clearTimer();
    this.update({ busy: true, error: null });
    const controller = new AbortController();
    const cancel = () => controller.abort();
    externalSignal?.addEventListener("abort", cancel, { once: true });
    this.pendingOperationRequest = controller;
    const ownerId = this.state.userId;
    this.operationSession = useBoardStore.getState().sessionVersion;
    // Complete the current save before any metadata operation or board switch.
    await this.saving;
    this.request = controller;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let completed = false;
    try {
      controller.signal.throwIfAborted();
      if (this.state.userId !== ownerId) throw new Error("The account changed. Your draft stays on this device.");
      await work(controller.signal);
      completed = !controller.signal.aborted && this.state.userId === ownerId;
    }
    catch (error) {
      if (!controller.signal.aborted) this.fail(error);
      else if (this.request === controller) this.update({ error: "The request was interrupted. Your draft stays on this device.", status: useBoardStore.getState().account ? "error" : "local" });
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", cancel);
      if (this.pendingOperationRequest === controller) this.pendingOperationRequest = null;
      if (this.request === controller) { this.request = null; this.update({ busy: false }); }
      const account = useBoardStore.getState().account;
      if (this.returnToGuest && account && account.ownerId !== this.state.userId && !this.state.busy) {
        this.returnToGuest = false;
        void this.back();
      }
      else if (this.state.status === "unsaved" && !this.state.busy) void this.save();
      else if (this.state.status === "pending") this.armRetry();
      if (boardTabCoordinator.enabled) await boardTabCoordinator.releaseOthers(activeBoardLeaseId(useBoardStore.getState().id));
      if (this.liveRefreshPending) void this.refreshLive();
    }
    return completed;
  }

  private async readDocument(boardId: string, signal: AbortSignal) {
    const ownerId = this.state.userId;
    if (!ownerId) throw new BoardSignInRequired();
    try { return await this.queries.document(ownerId, boardId, signal); }
    catch (error) {
      if (error instanceof BoardApiError && error.code === "DOCUMENT_NOT_FOUND") {
        const metadata = await getServerBoard(boardId, signal);
        return { ...blankDocument(), boardId, revision: 0, updatedAt: Date.now(), role: metadata.role };
      }
      throw error;
    }
  }

  open = (board: ServerBoard, externalSignal?: AbortSignal, force = false, entryViewport?: Viewport, expectedAccountId?: string) => this.operation(async (signal) => {
    const ownerId = this.state.userId;
    if (!ownerId) throw new BoardSignInRequired();
    if (!force && useBoardStore.getState().account?.boardId === board.id && useBoardStore.getState().account?.ownerId === ownerId && !useBoardStore.getState().readOnly) return;
    this.assertIdle();
    const id = accountBoardStorageId(ownerId, board.id);
    await waitForLocalBoardSave(signal);
    const draft = boardTabCoordinator.enabled
      ? await accountEditorJournals.open(id, () => loadLegacyLocalBoard(id))
      : await loadLocalBoard(id);
    const writable = !boardTabCoordinator.enabled || boardTabCoordinator.owns(activeBoardLeaseId(id));
    const remote = expectedAccountId ? await getServerBoardDocument(board.id, signal, expectedAccountId) : await this.readDocument(board.id, signal);
    if (signal.aborted || this.state.userId !== ownerId) return;
    const document: CanvasDocument = { schemaVersion: remote.schemaVersion, content: remote.content };
    let unsupportedDraft = false;
    let draftDocument: CanvasDocument | null = null;
    if (draft) {
      try { draftDocument = draft.account ? accountDocument(draft.objects, draft.account) : serializeDocumentSnapshot(draft.objects); }
      catch { unsupportedDraft = true; }
    }
    const dirty = draft?.account && (
      draft.account.pendingSave || draft.account.pendingOperation || draft.account.pendingTitle || draft.title !== draft.account.savedTitle ||
      unsupportedDraft || (draftDocument !== null && !sameDocument(draftDocument, draft.account.savedDocument))
    );
    let record: LocalBoardRecord;
    let status: CloudStatus = "saved";
    if (writable && remote.role === "viewer" && dirty && draft) await saveLocalBoard({ ...draft, id: `${id}:recovery` });
    if (dirty && draft?.account && remote.role !== "viewer") {
      record = draft;
      const pending = draft.account.pendingSave;
      // A lost response can be confirmed after a reload without another write.
      if (pending && remote.revision === pending.expectedRevision + 1 && sameDocument(document, pending.document)) {
        record = { ...draft, account: { ...draft.account, revision: remote.revision, savedDocument: document, pendingSave: undefined } };
        status = "unsaved";
      } else if (draft.account.pendingOperation) status = draft.account.pendingOperation.conflicted ? "conflict" : "unsaved";
      else if (remote.revision !== draft.account.revision && draftDocument && !unsupportedDraft) {
        const merged = mergeCollaborativeDocuments(draft.account.savedDocument, draftDocument, document);
        if (merged.conflicts.length) status = "conflict";
        else {
          record = { ...draft, objects: deserializeCanvasDocument(merged.document, board.id), account: { ...draft.account, revision: remote.revision, savedDocument: document } };
          status = "unsaved";
        }
      }
      else status = pending ? "error" : "unsaved";
    } else {
      record = {
        schemaVersion: LOCAL_BOARD_SCHEMA_VERSION, id, title: board.title,
        objects: deserializeCanvasDocument(document, board.id), viewport: draft?.viewport ?? entryViewport ?? initialViewport,
        createdAt: board.createdAt ?? Date.now(), updatedAt: Date.now(),
        account: { ownerId, boardId: board.id, revision: remote.revision, savedDocument: document, savedTitle: board.title },
      };
    }
    if (writable) await saveLocalBoard(record);
    const recovery = await loadLocalBoard(`${id}:recovery`);
    const interrupted = boardTabCoordinator.enabled ? await latestDetachedRecovery(id) : null;
    await this.replace(record, signal, false, remote.role ?? "owner");
    const needsConsent = !!record.account && missingAccountImages(record.objects, record.account)
      .some((image) => !Object.hasOwn(record.account!.imageUploads ?? {}, image.assetId));
    if (!signal.aborted) useBoardStore.setState({ tabRecoveryId: interrupted?.id ?? null });
    if (!signal.aborted) this.update({ status: remote.role === "viewer" ? "read-only" : needsConsent ? "consent" : remote.revision === 0 && status === "saved" ? "unsaved" : status, hasRecovery: recovery !== null,
      error: !writable ? BOARD_TAB_READ_ONLY_MESSAGE : null });
  }, 20_000, externalSignal);

  back = (externalSignal?: AbortSignal) => this.operation(async (signal) => {
    await waitForLocalBoardSave(signal);
    if (boardTabCoordinator.enabled) await boardTabCoordinator.acquire(CURRENT_BOARD_ID);
    const guest = await loadLocalBoard(CURRENT_BOARD_ID);
    if (!guest) throw new Error("The local board could not be opened. Your current draft is still available.");
    await this.replace(guest, signal);
    if (!signal.aborted) this.update({ status: "local", hasRecovery: false });
  }, 20_000, externalSignal);

  private create = (copy: boolean) => this.operation(async (signal) => {
    const ownerId = this.state.userId;
    if (!ownerId) throw new BoardSignInRequired();
    this.assertIdle();
    await waitForLocalBoardSave(signal);
    const objects = copy ? structuredClone(useDocumentStore.getState().objects) : {};
    // Validate the wire shape before creating a board, with temporary identities
    // for images that this explicit action will upload to the new board.
    const temporaryAssets = Object.fromEntries(Object.values(objects).flatMap((object) =>
      object.type === "image" ? [[object.assetId, crypto.randomUUID()]] : []));
    serializeDocumentSnapshot(objects, { boardId: crypto.randomUUID(), imageAssets: temporaryAssets });
    // Missing/unsupported local files fail before creating account metadata.
    for (const image of Object.values(objects)) {
      if (image.type !== "image" || image.cloudAsset) continue;
      const blob = await getAsset(image.assetId);
      if (!blob) throw new Error(`“${image.name || "Image"}” is missing on this device. Restore its file before uploading.`);
      if (!["image/jpeg", "image/png", "image/webp"].includes(blob.type) || blob.size < 1 || blob.size > MAX_CLOUD_IMAGE_BYTES) {
        throw new Error("Cloud images must be JPEG, PNG or WebP and at most 5 MiB. Your local image stays on this device.");
      }
    }
    const title = copy ? titleNow() : DEFAULT_BOARD_TITLE;
    const remote = await this.queries.create(ownerId, title, signal);
    if (signal.aborted || this.state.userId !== ownerId) return;
    const record: LocalBoardRecord = {
      schemaVersion: LOCAL_BOARD_SCHEMA_VERSION, id: accountBoardStorageId(ownerId, remote.id),
      title, objects,
      viewport: copy ? useViewportStore.getState().viewport : initialViewport,
      createdAt: remote.createdAt ?? Date.now(), updatedAt: Date.now(),
      account: { ownerId, boardId: remote.id, revision: 0, savedDocument: blankDocument(), savedTitle: title },
    };
    if (boardTabCoordinator.enabled) await accountEditorJournals.open(record.id, () => loadLegacyLocalBoard(record.id));
    await saveLocalBoard(record);
    await this.replace(record, signal);
    if (!signal.aborted) {
      this.update({ status: "unsaved", hasRecovery: false });
      authorizeAccountImages(Object.values(objects));
      // A blank new board needs an explicit first document write too.
      await this.save(true, signal);
    }
  }, copy ? 10 * 60_000 : 20_000);
  upload = () => this.create(true);
  createBlank = () => this.create(false);
  saveCopy = () => this.create(true);

  private waitForIdle(signal: AbortSignal): Promise<void> {
    if (useInteractionStore.getState().mode === "idle") return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = () => { unsubscribe(); signal.removeEventListener("abort", abort); resolve(); };
      const abort = () => { unsubscribe(); signal.removeEventListener("abort", abort); reject(new Error("The save was interrupted. Your draft stays on this device.")); };
      const unsubscribe = useInteractionStore.subscribe((state) => { if (state.mode === "idle") finish(); });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }

  /** Explicit migration consent for images inserted before automatic uploads. */
  uploadImages = () => this.operation(async (signal) => {
    authorizeAccountImages(Object.values(useDocumentStore.getState().objects));
    await this.save(true, signal);
  }, 10 * 60_000);

  private async uploadImagesForActiveBoard(signal: AbortSignal) {
    const board = useBoardStore.getState();
    if (!board.account || board.account.ownerId !== this.state.userId) throw new BoardSignInRequired();
    if (board.readOnly) throw new Error("Editing access is required to upload images.");
    const { ownerId } = board.account;
    const session = board.sessionVersion;
    const current = () => !signal.aborted && this.state.userId === ownerId &&
      useBoardStore.getState().sessionVersion === session && !useBoardStore.getState().readOnly;
    const missing = missingAccountImages(useDocumentStore.getState().objects, board.account);
    if (!missing.length) return true;
    if (missing.some((image) => !Object.hasOwn(board.account!.imageUploads ?? {}, image.assetId))) {
      this.update({ status: "consent", error: null });
      return false;
    }
    this.update({ imageUpload: { completed: 0, total: missing.length } });
    try {
      for (const [index, image] of missing.entries()) {
        if (!current()) throw new Error("Image upload interrupted. Your draft stays on this device.");
        // An undone insertion remains authorized for redo but need not start an upload.
        if (!Object.values(useDocumentStore.getState().objects).some((object) => object.type === "image" && object.assetId === image.assetId)) continue;
        const assetId = await uploadAccountImage(image.assetId, useBoardStore.getState().account!.imageUploads![image.assetId], board.account, signal, async (intent) => {
          if (!current()) throw new DOMException("Image upload interrupted", "AbortError");
          const link = useBoardStore.getState().account!;
          useBoardStore.getState().setAccount({ ...link, imageUploads: { ...link.imageUploads, [image.assetId]: intent } });
          await waitForLocalBoardSave(signal);
          if (!current()) throw new DOMException("Image upload interrupted", "AbortError");
        });
        if (!current()) throw new Error("Image upload interrupted. Your draft stays on this device.");
        // Metadata lives outside editor history, so undo/redo keeps local blobs
        // and retry reuses every completed upload, even after a page reload.
        const link = useBoardStore.getState().account!;
        useBoardStore.getState().setAccount({ ...link, imageAssets: { ...link.imageAssets, [image.assetId]: assetId } });
        await waitForLocalBoardSave(signal);
        this.update({ imageUpload: { completed: index + 1, total: missing.length } });
      }
      return true;
    } finally { this.update({ imageUpload: null }); }
  }

  save = async (force = false, operationSignal?: AbortSignal): Promise<void> => {
    if (this.saving) return this.saving;
    const account = useBoardStore.getState().account;
    if (!account || useBoardStore.getState().readOnly || this.state.userId !== account.ownerId || (!force && this.state.busy)) return;
    if (!this.online()) { this.update({ status: "pending", error: null }); return; }
    const controller = operationSignal ? null : new AbortController();
    const signal = operationSignal ?? controller!.signal;
    if (controller) this.request = controller;
    const id = useBoardStore.getState().id;
    const session = useBoardStore.getState().sessionVersion;
    const current = () => !signal.aborted && !useBoardStore.getState().tabReadOnly && useBoardStore.getState().id === id && useBoardStore.getState().sessionVersion === session && this.state.userId === account.ownerId;
    let timedOut = false;
    const timeout = controller ? setTimeout(() => { timedOut = true; controller.abort(); },
      missingAccountImages(useDocumentStore.getState().objects, account).length ? 10 * 60_000 : 20_000) : null;
    const commitLink = (link: AccountBoardLink) => {
      const latest = useBoardStore.getState().account!;
      const merged = { ...link, imageAssets: latest.imageAssets, imageUploads: latest.imageUploads };
      useBoardStore.getState().setAccount(merged);
      return merged;
    };
    this.update({ status: "saving", error: null });
    this.saving = (async () => {
      try {
        if (!await this.uploadImagesForActiveBoard(signal)) return;
        let link: AccountBoardLink = useBoardStore.getState().account!;
        if (link.pendingTitle) {
          const pending = link.pendingTitle;
          const metadata = await getServerBoard(link.boardId, signal, account.ownerId);
          if (!current()) return;
          if (metadata.role === "viewer") { this.access("viewer"); return; }
          if (metadata.title !== pending.title && metadata.title !== pending.previousTitle)
            throw new BoardApiError(409, "REVISION_CONFLICT", "The page title changed elsewhere. Your title stays in this device draft.");
          link = commitLink({ ...link, savedTitle: metadata.title, pendingTitle: undefined });
        }
        if (link.pendingOperation) {
          const pending = link.pendingOperation;
          const remote = await this.queries.operation(account.ownerId, link.boardId, pending.input, signal);
          await this.waitForIdle(signal);
          if (!current()) return;
          if (!await this.uploadImagesForActiveBoard(signal)) return;
          link = { ...link, imageAssets: useBoardStore.getState().account!.imageAssets, imageUploads: useBoardStore.getState().account!.imageUploads };
          const local = accountDocument(useDocumentStore.getState().objects, link);
          const document: CanvasDocument = { schemaVersion: remote.schemaVersion, content: remote.content };
          const merged = mergeCollaborativeDocuments(pending.document, local, document);
          link = { ...link, revision: remote.revision, savedDocument: document, pendingOperation: undefined };
          link = commitLink(link);
          if (merged.conflicts.length) throw new BoardApiError(409, "COLLABORATION_CONFLICT", "Someone changed the same objects. Your draft stays on this device.", remote.revision);
          this.applyLiveDocument(merged.document, local, link);
        }
        if (link.pendingSave) {
          const remote = await this.readDocument(link.boardId, signal);
          if (!current()) return;
          if (remote.role === "viewer") { this.access("viewer"); return; }
          const document: CanvasDocument = { schemaVersion: remote.schemaVersion, content: remote.content };
          if (remote.revision === link.pendingSave.expectedRevision + 1 && sameDocument(document, link.pendingSave.document)) {
            link = { ...link, revision: remote.revision, savedDocument: document, pendingSave: undefined };
          } else if (remote.revision === link.pendingSave.expectedRevision) link = { ...link, pendingSave: undefined };
          else throw new BoardApiError(409, "REVISION_CONFLICT", "This board changed elsewhere.", remote.revision);
          link = commitLink(link);
        }
        if (!await this.uploadImagesForActiveBoard(signal)) return;
        link = { ...link, imageAssets: useBoardStore.getState().account!.imageAssets, imageUploads: useBoardStore.getState().account!.imageUploads };
        const document = accountDocument(useDocumentStore.getState().objects, link);
        const title = titleNow();
        if (force || link.revision === 0 || !sameDocument(document, link.savedDocument)) {
          if (this.live && link.revision > 0) {
            const changes = documentChanges(link.savedDocument, document);
            if (changes.length) {
              const input = { operationId: crypto.randomUUID(), baseRevision: link.revision, changes };
              link = { ...link, pendingOperation: { input, document } };
              link = commitLink(link);
              // Exact operation IDs survive reloads and uncertain responses.
              await waitForLocalBoardSave(signal);
              if (!current() || useBoardStore.getState().readOnly) return;
              const remote = await this.queries.operation(account.ownerId, link.boardId, input, signal);
              await this.waitForIdle(signal);
              if (!current()) return;
              if (!await this.uploadImagesForActiveBoard(signal)) return;
              link = { ...link, imageAssets: useBoardStore.getState().account!.imageAssets, imageUploads: useBoardStore.getState().account!.imageUploads };
              const newest = accountDocument(useDocumentStore.getState().objects, link);
              const accepted: CanvasDocument = { schemaVersion: remote.schemaVersion, content: remote.content };
              const merged = mergeCollaborativeDocuments(document, newest, accepted);
              link = { ...link, revision: remote.revision, savedDocument: accepted, pendingOperation: undefined };
              link = commitLink(link);
              if (merged.conflicts.length) throw new BoardApiError(409, "COLLABORATION_CONFLICT", "Someone changed the same objects. Your draft stays on this device.", remote.revision);
              this.applyLiveDocument(merged.document, newest, link);
            }
          } else {
            link = { ...link, pendingSave: { document, expectedRevision: link.revision } };
            link = commitLink(link);
            // Persist the submission marker before sending a write with an uncertain outcome.
            await waitForLocalBoardSave(signal);
            if (!current() || useBoardStore.getState().readOnly) return;
            const remote = await this.queries.save(account.ownerId, link.boardId, document, link.revision, signal);
            if (!current()) return;
            link = { ...link, revision: remote.revision, savedDocument: { schemaVersion: remote.schemaVersion, content: remote.content }, pendingSave: undefined };
            link = commitLink(link);
          }
        }
        if (title !== link.savedTitle) {
          if (useBoardStore.getState().readOnly) return;
          link = commitLink({ ...link, pendingTitle: { title, previousTitle: link.savedTitle } });
          await waitForLocalBoardSave(signal);
          if (!current() || useBoardStore.getState().readOnly) return;
          const renamed = await this.queries.rename(account.ownerId, link.boardId, title, signal);
          if (!current()) return;
          link = { ...link, savedTitle: renamed.title, pendingTitle: undefined };
          link = commitLink(link);
        }
        if (!current()) return;
        let dirty = titleNow() !== link.savedTitle;
        try { dirty ||= !sameDocument(accountDocument(useDocumentStore.getState().objects, link), link.savedDocument); }
        catch { dirty = true; }
        if (!useBoardStore.getState().readOnly) { this.clearRetry(); this.update({ status: dirty ? "unsaved" : "saved" }); }
      } catch (error) {
        if (current() && error instanceof BoardApiError && ["BOARD_FORBIDDEN", "BOARD_NOT_FOUND"].includes(error.code)) this.access(error.code === "BOARD_FORBIDDEN" ? "viewer" : "none");
        else if (current()) { this.fail(error); this.scheduleRetry(error); }
        else if (timedOut && !useBoardStore.getState().readOnly && useBoardStore.getState().sessionVersion === session && this.state.userId === account.ownerId) {
          const timeoutError = new TypeError("The save timed out. Its original request is retained.");
          this.fail(timeoutError); this.scheduleRetry(timeoutError);
        }
        else if (signal.aborted && !useBoardStore.getState().readOnly && useBoardStore.getState().id === id && useBoardStore.getState().sessionVersion === session && this.state.userId === account.ownerId) this.update({ status: "error", error: "The save was interrupted. Retry to check whether it reached your account." });
      }
    })();
    await this.saving;
    this.saving = null;
    if (timeout) clearTimeout(timeout);
    if (controller && this.request === controller) this.request = null;
    if (this.liveRefreshPending) void this.refreshLive();
    if (current() && this.state.status === "unsaved" && !this.state.busy) void this.save();
  };

  reload = () => this.operation(async (signal) => {
    const board = useBoardStore.getState();
    if (!board.account || board.account.ownerId !== this.state.userId) throw new BoardSignInRequired();
    if (board.tabReadOnly) throw new Error(BOARD_TAB_READ_ONLY_MESSAGE);
    const remote = await this.readDocument(board.account.boardId, signal);
    const metadata = (await this.queries.list(board.account.ownerId, signal)).find((item) => item.id === board.account!.boardId);
    if (!metadata) throw new Error("This account board no longer exists.");
    const document: CanvasDocument = { schemaVersion: remote.schemaVersion, content: remote.content };
    const record: LocalBoardRecord = {
      ...captureLocalBoard(), title: metadata.title, objects: deserializeCanvasDocument(document, board.account.boardId),
      account: { ...board.account, revision: remote.revision, savedDocument: document, savedTitle: metadata.title, pendingSave: undefined, pendingOperation: undefined, pendingTitle: undefined },
    };
    // Keep the current draft intact until its backup and remote read succeed.
    await this.preserveAndReplace(record, signal, remote.role ?? "owner");
    if (!signal.aborted) {
      this.update({ status: remote.role === "viewer" ? "read-only" : "saved", hasRecovery: true });
    }
  });

  restore = () => this.operation(async (signal) => {
    const board = useBoardStore.getState();
    if (!board.account || board.account.ownerId !== this.state.userId) throw new BoardSignInRequired();
    if (board.tabReadOnly) throw new Error(BOARD_TAB_READ_ONLY_MESSAGE);
    const recovery = await loadLocalBoard(`${board.id}:recovery`);
    if (!recovery) throw new Error("No previous draft is available on this device.");
    const record = { ...recovery, id: board.id };
    await this.preserveAndReplace(record, signal, board.accessRole ?? "none");
    if (!signal.aborted) this.update({ status: board.readOnly ? "read-only" : "conflict", hasRecovery: true });
  });

  restoreInterrupted = () => this.operation(async (signal) => {
    const board = useBoardStore.getState();
    if (!board.account || board.account.ownerId !== this.state.userId) throw new BoardSignInRequired();
    if (board.tabReadOnly || !board.tabRecoveryId) throw new Error(BOARD_TAB_READ_ONLY_MESSAGE);
    const remote = await this.readDocument(board.account.boardId, signal);
    if (remote.role === "viewer") { this.access("viewer"); return; }
    const recovery = await loadLocalBoard(board.tabRecoveryId);
    if (!recovery) throw new Error("The interrupted draft is unavailable");
    await this.preserveAndReplace({ ...recovery, id: board.id }, signal, remote.role ?? "owner");
    this.update({ status: "conflict", hasRecovery: true });
  });

  rename = (board: ServerBoard, title: string) => this.operation(async (signal) => {
    const ownerId = this.state.userId;
    if (!ownerId) throw new BoardSignInRequired();
    if (useBoardStore.getState().account?.boardId === board.id) {
      if (useBoardStore.getState().readOnly) return;
      useBoardStore.getState().setTitle(title);
      if (!["conflict", "error"].includes(this.state.status)) this.update({ status: "unsaved" });
    } else await this.queries.rename(ownerId, board.id, title, signal);
  });

  remove = async (board: ServerBoard) => {
    let activeDeleted = false;
    const completed = await this.operation(async (signal) => {
      const ownerId = this.state.userId;
      if (!ownerId) throw new BoardSignInRequired();
      // Preserve any active draft before deletion; deleting never destroys IndexedDB records.
      await waitForLocalBoardSave(signal);
      await this.queries.remove(ownerId, board.id, signal);
      if (signal.aborted) return;
      if (useBoardStore.getState().account?.boardId === board.id) {
        activeDeleted = true;
        if (this.onPageDeleted) return;
        if (boardTabCoordinator.enabled) await boardTabCoordinator.acquire(CURRENT_BOARD_ID);
        const guest = await loadLocalBoard();
        if (!guest) throw new Error("Deleted from your account. Your draft stays on this device.");
        await this.replace(guest, signal);
        this.update({ status: "local", hasRecovery: false });
      }
    });
    if (completed && activeDeleted) await this.onPageDeleted?.();
    return completed;
  };
}

export function useAccountBoardSession() {
  const queryClient = useQueryClient();
  const [session] = useState(() => new AccountBoardSession(queryClient, true));
  const state = useSyncExternalStore(session.subscribe, session.getState);
  useEffect(() => session.start(), [session]);
  return { session, state };
}
