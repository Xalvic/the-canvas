import { useEffect } from "react";
import { useBoardStore, DEFAULT_BOARD_TITLE } from "../store/boardStore";
import { useDocumentStore } from "../store/documentStore";
import { useSelectionStore } from "../store/selectionStore";
import { useViewportStore } from "../store/viewportStore";
import {
  CURRENT_BOARD_ID,
  LOCAL_BOARD_SCHEMA_VERSION,
  loadLocalBoard,
  saveLocalBoard,
  type LocalBoardRecord,
} from "./localBoardStorage";

const AUTOSAVE_DELAY_MS = 500;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Local save failed";
}

function captureBoard(updatedAt = Date.now()): LocalBoardRecord {
  const board = useBoardStore.getState();
  return {
    schemaVersion: LOCAL_BOARD_SCHEMA_VERSION,
    id: board.id,
    title: board.title.trim() || DEFAULT_BOARD_TITLE,
    objects: useDocumentStore.getState().objects,
    viewport: useViewportStore.getState().viewport,
    createdAt: board.createdAt,
    updatedAt,
  };
}

export function useLocalBoardPersistence(): void {
  const isHydrated = useBoardStore((state) => state.isHydrated);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
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
          await saveLocalBoard(board);
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
        }, hasSavedBoard);
      } catch (error) {
        if (!cancelled) {
          useBoardStore.getState().hydrateWithError(errorMessage(error));
        }
      }
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    let saveTimer: number | null = null;
    let revision = 0;
    let saveQueue = Promise.resolve();

    const queueSave = () => {
      const queuedRevision = revision;
      const board = captureBoard();
      saveQueue = saveQueue
        .catch(() => undefined)
        .then(() => saveLocalBoard(board))
        .then(() => {
          if (queuedRevision === revision) {
            useBoardStore.getState().markSaved(board.updatedAt);
          }
        })
        .catch((error) => {
          if (queuedRevision === revision) {
            useBoardStore.getState().markSaveError(errorMessage(error));
          }
        });
    };

    const scheduleSave = () => {
      revision += 1;
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
      if (state.title !== previous.title) scheduleSave();
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
