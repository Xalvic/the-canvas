import { useEffect } from "react";
import { useBoardStore, DEFAULT_BOARD_TITLE } from "../store/boardStore";
import { useDocumentStore } from "../store/documentStore";
import { useSelectionStore } from "../store/selectionStore";
import { useViewportStore } from "../store/viewportStore";
import {
  CURRENT_BOARD_ID,
  LOCAL_BOARD_SCHEMA_VERSION,
  loadLocalBoard,
  saveLocalBoard, saveDetachedRecovery, latestDetachedRecovery,
  type LocalBoardRecord,
} from "./localBoardStorage";

import { boardTabCoordinator, BOARD_TAB_READ_ONLY_MESSAGE, BOARD_TAB_UNVERIFIED_MESSAGE } from "./boardTabCoordinator";
import { activeBoardLeaseId } from "./accountEditorJournals";
import { useInteractionStore } from "../store/interactionStore";
import { useAppearancePreviewStore } from "../store/appearancePreviewStore";
import { useUiStore } from "../store/uiStore";
import { waitForLocalBoardSave } from "./waitForLocalBoardSave";
import { CANCEL_TOUCH_INTERACTIONS_EVENT, COMMIT_CANVAS_INTERACTIONS_EVENT, REQUEST_GUEST_EDIT_EVENT } from "../canvas/viewport/pointerInteractionEvents";

let flushActiveSave: (() => Promise<void>) | null = null;
let requestGuestOwnership: ((explicit: boolean) => Promise<boolean>) | null = null;
export function continueGuestEditing() { return requestGuestOwnership?.(true) ?? Promise.resolve(false); }
export async function flushLocalBoardSave() { await flushActiveSave?.(); }

/** Explicit takeover always loads disk again before admitting edits. */
export async function reopenLocalBoard(): Promise<void> {
  const session = useBoardStore.getState();
  if (session.account || session.navigationPending) return;
  const lease = await boardTabCoordinator.acquire(CURRENT_BOARD_ID);
  if (!lease) { useBoardStore.getState().setTabOwnership(boardTabCoordinator.status(CURRENT_BOARD_ID)); return; }
  try {
    const [record, recovery] = await Promise.all([loadLocalBoard(), latestDetachedRecovery(CURRENT_BOARD_ID)]);
    if (!record) throw new Error("The local board is not available yet. Retry after the other tab saves.");
    const current = useBoardStore.getState();
    if (current.id !== session.id || current.sessionVersion !== session.sessionVersion || current.account || current.navigationPending) {
      await boardTabCoordinator.releaseOthers(activeBoardLeaseId(current.id));
      return;
    }
    useBoardStore.setState({ isHydrated: false });
    window.dispatchEvent(new Event(CANCEL_TOUCH_INTERACTIONS_EVENT));
    useInteractionStore.getState().endInteraction();
    useDocumentStore.getState().loadDocument(record.objects);
    useViewportStore.getState().setViewport(record.viewport);
    useSelectionStore.getState().clearSelection();
    useBoardStore.getState().hydrate(record, true);
    useBoardStore.getState().setTabReadOnly(false);
    useBoardStore.setState({ tabRecoveryId: recovery?.id ?? null });
  } catch (error) {
    const current = useBoardStore.getState();
    if (current.id === session.id && current.sessionVersion === session.sessionVersion) {
      current.setTabOwnership("unverified");
      await boardTabCoordinator.release(CURRENT_BOARD_ID);
    } else await boardTabCoordinator.releaseOthers(activeBoardLeaseId(current.id));
    throw error;
  }
}

export async function restoreInterruptedLocalBoard(): Promise<void> {
  const board = useBoardStore.getState();
  if (board.account || board.tabReadOnly || !board.tabRecoveryId) return;
  if (useInteractionStore.getState().mode !== "idle") throw new Error("Finish the current canvas interaction before restoring a draft.");
  await waitForLocalBoardSave(new AbortController().signal);
  if (!await boardTabCoordinator.renew(board.id)) return;
  const recovery = await loadLocalBoard(board.tabRecoveryId);
  if (!recovery) throw new Error("The interrupted draft is unavailable");
  if (useBoardStore.getState().sessionVersion !== board.sessionVersion || useInteractionStore.getState().mode !== "idle") throw new Error("The active canvas changed. Please restore the draft again.");
  await saveLocalBoard({ ...captureLocalBoard(), id: `${board.id}:recovery` });
  const record = { ...recovery, id: board.id, updatedAt: Date.now() };
  await saveLocalBoard(record);
  if (useBoardStore.getState().sessionVersion !== board.sessionVersion) return;
  useBoardStore.setState({ isHydrated: false });
  useDocumentStore.getState().loadDocument(record.objects);
  useViewportStore.getState().setViewport(record.viewport);
  useSelectionStore.getState().clearSelection();
  useBoardStore.getState().hydrate(record, true);
}

const AUTOSAVE_DELAY_MS = 500;
const RETRY_LOCAL_SAVE = "scribble:retry-device-save";
// Retry enters the same serial queue; it cannot race a separate persistence write.
export function retryLocalBoardSave() { window.dispatchEvent(new Event(RETRY_LOCAL_SAVE)); }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Local save failed";
}

export function captureLocalBoard(updatedAt = Date.now()): LocalBoardRecord {
  const board = useBoardStore.getState();
  return {
    schemaVersion: LOCAL_BOARD_SCHEMA_VERSION,
    id: board.id,
    title: board.title.trim() || DEFAULT_BOARD_TITLE,
    objects: useDocumentStore.getState().objects,
    viewport: useViewportStore.getState().viewport,
    createdAt: board.createdAt,
    updatedAt,
    ...(board.account ? { account: board.account } : {}),
  };
}

export function useLocalBoardPersistence(): void {
  const isHydrated = useBoardStore((state) => state.isHydrated);

  useEffect(() => {
    let cancelled = false;
    let hydratedSuccessfully = false;
    let hydrating = false;
    let requesting: Promise<boolean> | null = null;
    let outgoingRequest = false;
    let handingOff = false;
    let composing = false;
    let syncing = false;
    boardTabCoordinator.start();
    useBoardStore.getState().setTabOwnership("acquiring");
    const unsubscribeLease = boardTabCoordinator.subscribe(({ id, lost, state, error, retained }) => {
      const board = useBoardStore.getState();
      if (activeBoardLeaseId(board.id) !== id || !board.isHydrated) return;
      if (state === "owned") {
        // A new claim must load disk before enabling edits. Only an unchanged
        // token recovering from a storage outage can continue this live session.
        if (retained && hydratedSuccessfully && board.tabOwnership === "unavailable") {
          board.setTabOwnership("owned");
          retryLocalBoardSave();
        }
        return;
      }
      if (!lost) {
        if (!board.account && state === "contended") { board.setTabOwnership("passive"); return; }
        board.setTabOwnership(state);
        if (state === "unavailable") board.markSaveError(errorMessage(error));
        return;
      }
      // Preserve the visible interrupted ink/text in a detached draft before
      // disabling mutations. The changed durable token still rejects all
      // canonical writes, including any save queued by this final commit.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.dispatchEvent(new Event(COMMIT_CANVAS_INTERACTIONS_EVENT));
      const draft = captureLocalBoard();
      board.setTabOwnership(state);
      window.dispatchEvent(new Event(CANCEL_TOUCH_INTERACTIONS_EVENT));
      useInteractionStore.getState().endInteraction();
      useAppearancePreviewStore.getState().cancel();
      useUiStore.getState().setActiveTool("select");
      useDocumentStore.getState().clearHistory();
      board.markSaveError(state === "contended" ? BOARD_TAB_READ_ONLY_MESSAGE : BOARD_TAB_UNVERIFIED_MESSAGE);
      void saveDetachedRecovery(draft).then((recoveryId) => {
        if (useBoardStore.getState().id === board.id) useBoardStore.setState({ tabRecoveryId: recoveryId });
      }).catch((error) => { if (useBoardStore.getState().id === board.id) board.markSaveError(errorMessage(error)); });
    });
    const syncGuest = async () => {
      const before = useBoardStore.getState();
      if (syncing || cancelled || !before.isHydrated || before.account || before.navigationPending || before.id !== CURRENT_BOARD_ID || before.tabOwnership !== "passive") return;
      syncing = true;
      try {
        const record = await loadLocalBoard();
        const current = useBoardStore.getState();
        if (!record || cancelled || current.sessionVersion !== before.sessionVersion || current.account || current.navigationPending || current.tabOwnership !== "passive") return;
        if (JSON.stringify(record.objects) !== JSON.stringify(useDocumentStore.getState().objects)) {
          useDocumentStore.getState().loadDocument(record.objects);
          useSelectionStore.getState().clearSelection();
        }
        useBoardStore.setState({ title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt, saveStatus: "saved", saveError: null });
      } catch (error) { if (!cancelled && useBoardStore.getState().sessionVersion === before.sessionVersion) before.markSaveError(errorMessage(error)); }
      finally { syncing = false; }
    };
    const requestOwnership = (explicit: boolean): Promise<boolean> => {
      if (requesting) return requesting;
      const board = useBoardStore.getState();
      if (!board.isHydrated || board.account || board.navigationPending || board.id !== CURRENT_BOARD_ID) return Promise.resolve(false);
      if (boardTabCoordinator.owns(board.id) && !board.tabReadOnly) return Promise.resolve(true);
      if (handingOff || board.tabOwnership === "acquiring") return Promise.resolve(false);
      // An outage retains this editor's token and pending document. Renew it
      // without reopening disk, which would replace those edits and history.
      if (board.tabOwnership === "unavailable" && boardTabCoordinator.hasLease(board.id)) {
        return boardTabCoordinator.renew(board.id);
      }
      requesting = (async () => {
        const version = board.sessionVersion;
        const deadline = performance.now() + 2_000;
        board.setTabOwnership("acquiring");
        try {
          boardTabCoordinator.signal("handoff", CURRENT_BOARD_ID);
          do {
            const current = useBoardStore.getState();
            if (cancelled || current.account || current.navigationPending || current.sessionVersion !== version) return false;
            if (!document.hasFocus()) { current.setTabOwnership("passive"); return false; }
            if (await boardTabCoordinator.acquire(CURRENT_BOARD_ID)) {
              await reopenLocalBoard();
              return !useBoardStore.getState().tabReadOnly;
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 75));
          } while (performance.now() < deadline);
          const current = useBoardStore.getState();
          if (!current.account && current.sessionVersion === version) current.setTabOwnership(explicit ? "contended" : "passive");
          return false;
        } catch (error) {
          if (!useBoardStore.getState().account && useBoardStore.getState().sessionVersion === version) {
            board.setTabOwnership("unavailable"); board.markSaveError(errorMessage(error));
          }
          return false;
        }
      })().finally(() => { requesting = null; });
      return requesting;
    };
    requestGuestOwnership = requestOwnership;
    const handoffGuest = async () => {
      const board = useBoardStore.getState();
      if (!outgoingRequest || handingOff || composing || board.account || !board.isHydrated ||
          board.id !== CURRENT_BOARD_ID || !boardTabCoordinator.owns(board.id)) return;
      handingOff = true;
      try {
        if (!["idle", "drawing", "panning", "editingText"].includes(useInteractionStore.getState().mode)) return;
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.dispatchEvent(new Event(COMMIT_CANVAS_INTERACTIONS_EVENT));
        if (useInteractionStore.getState().mode !== "idle") return;
        useAppearancePreviewStore.getState().cancel();
        // Capture/queue the committed draft before blocking further mutations.
        const flushed = flushLocalBoardSave();
        board.setTabOwnership("acquiring");
        await flushed;
        const current = useBoardStore.getState();
        if (current.id !== board.id || current.sessionVersion !== board.sessionVersion || current.account) return;
        await boardTabCoordinator.release(CURRENT_BOARD_ID);
        current.setTabOwnership("passive");
        outgoingRequest = false;
        void syncGuest();
      } catch (error) { board.setTabOwnership("unavailable"); board.markSaveError(errorMessage(error)); }
      finally { handingOff = false; }
    };
    const unsubscribeSignals = boardTabCoordinator.subscribeSignals((signal) => {
      if (signal.id !== CURRENT_BOARD_ID) return;
      if (signal.type === "handoff") { outgoingRequest = true; void handoffGuest(); }
      else void syncGuest();
    });
    const unsubscribeInteraction = useInteractionStore.subscribe((state) => { if (state.mode === "idle" && outgoingRequest) void handoffGuest(); });
    const startComposition = () => { composing = true; };
    const endComposition = () => { composing = false; setTimeout(() => { void handoffGuest(); }, 0); };
    const blurGuest = () => { void handoffGuest(); };
    const attemptGuestEdit = () => { void requestOwnership(true); };
    const verifyLease = () => {
      void boardTabCoordinator.renewAll().then(() => {
        if (cancelled) return;
        const board = useBoardStore.getState();
        if (document.hasFocus() && ["passive", "contended", "unverified", "unavailable"].includes(board.tabOwnership)) void requestOwnership(false);
        else void syncGuest();
      });
    };
    const verifyVisibleLease = () => { if (document.visibilityState === "visible") verifyLease(); };
    window.addEventListener("focus", verifyLease);
    window.addEventListener("pageshow", verifyLease);
    document.addEventListener("visibilitychange", verifyVisibleLease);
    window.addEventListener("blur", blurGuest);
    window.addEventListener(REQUEST_GUEST_EDIT_EVENT, attemptGuestEdit);
    document.addEventListener("compositionstart", startComposition);
    document.addEventListener("compositionend", endComposition);
    const guestPoll = window.setInterval(() => { void syncGuest(); }, 1_500);

    const hydrate = async () => {
      if (hydrating) return;
      hydrating = true;
      try {
        const lease = await boardTabCoordinator.acquire(CURRENT_BOARD_ID);
        let board = await loadLocalBoard();
        const hasSavedBoard = board !== null;
        if (!board) {
          const timestamp = Date.now();
          board = {
            schemaVersion: LOCAL_BOARD_SCHEMA_VERSION,
            id: CURRENT_BOARD_ID,
            title: DEFAULT_BOARD_TITLE,
            objects: {},
            viewport: useViewportStore.getState().viewport,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          if (lease) await saveLocalBoard(board);
        }
        if (cancelled) return;

        useDocumentStore.getState().loadDocument(board.objects);
        if (hasSavedBoard) {
          useViewportStore.getState().setViewport(board.viewport);
        }
        useSelectionStore.getState().clearSelection();
        useBoardStore.getState().hydrate({
          id: board.id,
          title: board.title,
          createdAt: board.createdAt,
          updatedAt: board.updatedAt,
          account: board.account,
        }, hasSavedBoard);
        useBoardStore.getState().setTabOwnership(lease ? "owned" : "passive");
        const recovery = await latestDetachedRecovery(CURRENT_BOARD_ID);
        if (!cancelled && useBoardStore.getState().id === CURRENT_BOARD_ID) useBoardStore.setState({ tabRecoveryId: recovery?.id ?? null });
        hydratedSuccessfully = true;
        if (!lease && document.hasFocus()) void requestOwnership(false);
      } catch (error) {
        if (!cancelled) {
          useBoardStore.getState().setTabOwnership("unavailable");
          useBoardStore.getState().hydrateWithError(errorMessage(error));
        }
      } finally { hydrating = false; }
    };

    const retryOwnership = () => {
      if (!hydratedSuccessfully) void hydrate();
      else verifyLease();
    };
    window.addEventListener(RETRY_LOCAL_SAVE, retryOwnership);

    void hydrate();
    return () => {
      cancelled = true;
      unsubscribeLease();
      unsubscribeSignals(); unsubscribeInteraction();
      window.clearInterval(guestPoll);
      window.removeEventListener("blur", blurGuest);
      window.removeEventListener(REQUEST_GUEST_EDIT_EVENT, attemptGuestEdit);
      document.removeEventListener("compositionstart", startComposition);
      document.removeEventListener("compositionend", endComposition);
      if (requestGuestOwnership === requestOwnership) requestGuestOwnership = null;
      window.removeEventListener("focus", verifyLease);
      window.removeEventListener("pageshow", verifyLease);
      document.removeEventListener("visibilitychange", verifyVisibleLease);
      window.removeEventListener(RETRY_LOCAL_SAVE, retryOwnership);
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    let saveTimer: number | null = null;
    let revision = 0;
    let saveQueue = Promise.resolve();
    let pendingSession: { id: string; version: number } | null = null;

    const isCurrentSession = (id: string, version: number) => {
      const current = useBoardStore.getState();
      return current.isHydrated && current.id === id && current.sessionVersion === version;
    };

    const queueSave = () => {
      const session = pendingSession;
      pendingSession = null;
      if (!session || !isCurrentSession(session.id, session.version) || useBoardStore.getState().tabReadOnly) return;
      const queuedRevision = revision;
      const board = captureLocalBoard();
      saveQueue = saveQueue
        .catch(() => undefined)
        .then(() => saveLocalBoard(board))
        .then(() => {
          if (queuedRevision === revision && isCurrentSession(board.id, session.version)) {
            useBoardStore.getState().markSaved(board.updatedAt);
          }
        })
        .catch((error) => {
          if (queuedRevision === revision && isCurrentSession(board.id, session.version)) {
            useBoardStore.getState().markSaveError(errorMessage(error));
          }
        });
    };

    const scheduleSave = () => {
      const board = useBoardStore.getState();
      if (!board.isHydrated || board.tabReadOnly) return;
      revision += 1;
      pendingSession = { id: board.id, version: board.sessionVersion };
      useBoardStore.getState().markSaving();
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        saveTimer = null;
        queueSave();
      }, AUTOSAVE_DELAY_MS);
    };

    const flushPendingSave = () => {
      if (saveTimer === null) return;
      window.clearTimeout(saveTimer);
      saveTimer = null;
      queueSave();
    };
    const flushSave = async () => {
      flushPendingSave();
      await saveQueue;
      if (useBoardStore.getState().saveStatus === "error") throw new Error(useBoardStore.getState().saveError ?? "Could not flush this device draft");
    };
    flushActiveSave = flushSave;

    const unsubscribeDocument = useDocumentStore.subscribe((state, previous) => {
      if (state.objects !== previous.objects) scheduleSave();
    });
    const unsubscribeViewport = useViewportStore.subscribe((state, previous) => {
      if (state.viewport !== previous.viewport) scheduleSave();
    });
    const unsubscribeBoard = useBoardStore.subscribe((state, previous) => {
      if (
        state.isHydrated && previous.isHydrated &&
        state.id === previous.id && state.sessionVersion === previous.sessionVersion &&
        (state.title !== previous.title || state.account !== previous.account)
      ) scheduleSave();
    });
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPendingSave();
    };

    window.addEventListener("pagehide", flushPendingSave);
    window.addEventListener(RETRY_LOCAL_SAVE, scheduleSave);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      unsubscribeDocument();
      unsubscribeViewport();
      unsubscribeBoard();
      window.removeEventListener("pagehide", flushPendingSave);
      window.removeEventListener(RETRY_LOCAL_SAVE, scheduleSave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushPendingSave();
      if (flushActiveSave === flushSave) flushActiveSave = null;
    };
  }, [isHydrated]);
}
