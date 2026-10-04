import { create } from "zustand";
import { CURRENT_BOARD_ID, type AccountBoardLink } from "../persistence/localBoardStorage";

export type BoardSaveStatus = "loading" | "saving" | "saved" | "error";

export type BoardMetadata = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  account?: AccountBoardLink;
};

type BoardState = Omit<BoardMetadata, "account"> & {
  account: AccountBoardLink | null;
  isHydrated: boolean;
  sessionVersion: number;
  hasSavedViewport: boolean;
  saveStatus: BoardSaveStatus;
  saveError: string | null;
  hydrate: (metadata: BoardMetadata, hasSavedViewport: boolean) => void;
  hydrateWithError: (message: string) => void;
  setTitle: (title: string) => void;
  setAccount: (account: AccountBoardLink | null) => void;
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
  account: null,
  isHydrated: false,
  sessionVersion: 0,
  hasSavedViewport: false,
  saveStatus: "loading",
  saveError: null,

  hydrate: (metadata, hasSavedViewport) => set((state) => ({
    ...metadata,
    account: metadata.account ?? null,
    isHydrated: true,
    sessionVersion: state.sessionVersion + 1,
    hasSavedViewport,
    saveStatus: "saved",
    saveError: null,
  })),

  hydrateWithError: (message) => set((state) => ({
    isHydrated: true,
    sessionVersion: state.sessionVersion + 1,
    saveStatus: "error",
    saveError: message,
  })),

  setTitle: (title) => set({ title }),
  setAccount: (account) => set({ account }),
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
