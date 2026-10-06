import { create } from "zustand";
import { CURRENT_BOARD_ID, type AccountBoardLink } from "../persistence/localBoardStorage";
import type { BoardRole } from "../api/boards";
import type { BoardTabOwnership } from "../persistence/boardTabCoordinator";

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
  accessRole: BoardRole | "none" | null;
  readOnly: boolean;
  tabReadOnly: boolean;
  tabOwnership: BoardTabOwnership;
  tabRecoveryId: string | null;
  setTabReadOnly: (value: boolean) => void;
  setTabOwnership: (value: BoardTabOwnership) => void;
  setAccessRole: (role: BoardRole | "none" | null) => void;
  isHydrated: boolean;
  navigationPending: boolean;
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
  accessRole: null,
  readOnly: false,
  tabReadOnly: false,
  tabOwnership: "acquiring",
  tabRecoveryId: null,
  setTabReadOnly: (value) => set((state) => ({ tabReadOnly: value, tabOwnership: value ? "contended" : "owned", readOnly: value || state.accessRole === "viewer" || state.accessRole === "none" })),
  setTabOwnership: (value) => set((state) => ({ tabOwnership: value, tabReadOnly: value !== "owned", readOnly: value !== "owned" || state.accessRole === "viewer" || state.accessRole === "none" })),
  setAccessRole: (role) => set((state) => ({ accessRole: role, readOnly: state.tabReadOnly || role === "viewer" || role === "none" })),
  isHydrated: false,
  navigationPending: false,
  sessionVersion: 0,
  hasSavedViewport: false,
  saveStatus: "loading",
  saveError: null,

  hydrate: (metadata, hasSavedViewport) => set((state) => ({
    ...metadata,
    account: metadata.account ?? null,
    tabRecoveryId: null,
    accessRole: metadata.account ? "none" : null,
    readOnly: state.tabReadOnly || !!metadata.account,
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

  setTitle: (title) => set((state) => state.readOnly ? state : { title }),
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
