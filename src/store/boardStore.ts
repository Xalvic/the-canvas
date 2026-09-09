import { create } from "zustand";
import { CURRENT_BOARD_ID } from "../persistence/localBoardStorage";

export type BoardSaveStatus = "loading" | "saving" | "saved" | "error";

export type BoardMetadata = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

type BoardState = BoardMetadata & {
  isHydrated: boolean;
  hasSavedViewport: boolean;
  saveStatus: BoardSaveStatus;
  saveError: string | null;
  hydrate: (metadata: BoardMetadata, hasSavedViewport: boolean) => void;
  hydrateWithError: (message: string) => void;
  setTitle: (title: string) => void;
  markSaving: () => void;
  markSaved: (updatedAt: number) => void;
  markSaveError: (message: string) => void;
};

const startedAt = Date.now();
export const DEFAULT_BOARD_TITLE = "Untitled board";

export const useBoardStore = create<BoardState>((set) => ({
  id: CURRENT_BOARD_ID,
  title: DEFAULT_BOARD_TITLE,
  createdAt: startedAt,
  updatedAt: startedAt,
  isHydrated: false,
  hasSavedViewport: false,
  saveStatus: "loading",
  saveError: null,

  hydrate: (metadata, hasSavedViewport) => set({
    ...metadata,
    isHydrated: true,
    hasSavedViewport,
    saveStatus: "saved",
    saveError: null,
  }),

  hydrateWithError: (message) => set({
    isHydrated: true,
    saveStatus: "error",
    saveError: message,
  }),

  setTitle: (title) => set({ title }),
  markSaving: () => set({ saveStatus: "saving", saveError: null }),
  markSaved: (updatedAt) => set({
    updatedAt,
    saveStatus: "saved",
    saveError: null,
  }),
  markSaveError: (message) => set({
    saveStatus: "error",
    saveError: message,
  }),
}));
