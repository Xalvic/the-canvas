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

import { boardTabCoordinator, BOARD_TAB_READ_ONLY_MESSAGE } from "./boardTabCoordinator";
import { useInteractionStore } from "../store/interactionStore";
import { useAppearancePreviewStore } from "../store/appearancePreviewStore";
import { useUiStore } from "../store/uiStore";
import { waitForLocalBoardSave } from "./waitForLocalBoardSave";
import { CANCEL_TOUCH_INTERACTIONS_EVENT } from "../canvas/viewport/pointerInteractionEvents";

/** Explicit takeover always loads disk again before admitting edits. */
export async function reopenLocalBoard(): Promise<void> {
  const session = useBoardStore.getState();
  if (session.account) return;
  const lease = await boardTabCoordinator.acquire(CURRENT_BOARD_ID);
  if (!lease) { useBoardStore.getState().setTabReadOnly(true); return; }
  try {
    const [record, recovery] = await Promise.all([loadLocalBoard(), latestDetachedRecovery(CURRENT_BOARD_ID)]);
    if (!record) throw new Error("The local board is not available yet. Retry after the other tab saves.");
    const current = useBoardStore.getState();
    if (current.id !== session.id || current.sessionVersion !== session.sessionVersion || current.account) {
      await boardTabCoordinator.releaseOthers(current.id);
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
      current.setTabReadOnly(true);
      await boardTabCoordinator.release(CURRENT_BOARD_ID);
    } else await boardTabCoordinator.releaseOthers(current.id);
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
    boardTabCoordinator.start();
    useBoardStore.getState().setTabReadOnly(true);
    const unsubscribeLease = boardTabCoordinator.subscribe(({ id, lost }) => {
      const board = useBoardStore.getState();
      if (!lost || board.id !== id || !board.isHydrated) return;
      const draft = captureLocalBoard();
      board.setTabReadOnly(true);
      window.dispatchEvent(new Event(CANCEL_TOUCH_INTERACTIONS_EVENT));
      useInteractionStore.getState().endInteraction();
      useAppearancePreviewStore.getState().cancel();
      useUiStore.getState().setActiveTool("select");
      useDocumentStore.getState().clearHistory();
      board.markSaveError(BOARD_TAB_READ_ONLY_MESSAGE);
      void saveDetachedRecovery(draft).then((recoveryId) => {
        if (useBoardStore.getState().id === id) useBoardStore.setState({ tabRecoveryId: recoveryId });
      }).catch((error) => { if (useBoardStore.getState().id === id) board.markSaveError(errorMessage(error)); });
    });
    const verifyLease = () => { void boardTabCoordinator.renewAll(); };
    window.addEventListener("focus", verifyLease);

    const hydrate = async () => {
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
        useBoardStore.getState().setTabReadOnly(!lease);
        const recovery = await latestDetachedRecovery(CURRENT_BOARD_ID);
        if (!cancelled && useBoardStore.getState().id === CURRENT_BOARD_ID) useBoardStore.setState({ tabRecoveryId: recovery?.id ?? null });
      } catch (error) {
        if (!cancelled) {
          useBoardStore.getState().hydrateWithError(errorMessage(error));
        }
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
      unsubscribeLease();
      window.removeEventListener("focus", verifyLease);
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
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      unsubscribeDocument();
      unsubscribeViewport();
      unsubscribeBoard();
      window.removeEventListener("pagehide", flushPendingSave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushPendingSave();
    };
  }, [isHydrated]);
}
