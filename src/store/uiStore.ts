import { create } from "zustand";

export type ActiveTool =
  | "select"
  | "hand"
  | "text"
  | "card"
  | "connector"
  | "frame"
  | "pen";

type UiState = {
  activeTool: ActiveTool;
  isMultiSelectMode: boolean;
  setActiveTool: (tool: ActiveTool) => void;
  setMultiSelectMode: (enabled: boolean) => void;
};

export const useUiStore = create<UiState>((set) => ({
  activeTool: "select",
  isMultiSelectMode: false,
  setActiveTool: (activeTool) =>
    set((state) => ({
      activeTool,
      isMultiSelectMode:
        activeTool === "select" ? state.isMultiSelectMode : false,
    })),
  setMultiSelectMode: (isMultiSelectMode) => set({ isMultiSelectMode }),
}));
