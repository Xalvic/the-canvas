import { create } from "zustand";

export type ActiveTool = "select" | "hand" | "text" | "card";

type UiState = {
  activeTool: ActiveTool;
  setActiveTool: (tool: ActiveTool) => void;
};

export const useUiStore = create<UiState>((set) => ({
  activeTool: "select",
  setActiveTool: (activeTool) => set({ activeTool }),
}));
