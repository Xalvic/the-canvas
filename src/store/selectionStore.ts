import { create } from "zustand";

type SelectionState = {
  selectedIds: Set<string>;
  selectOnly: (id: string) => void;
  setSelection: (ids: Iterable<string>) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
};

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedIds: new Set(),
  selectOnly: (id) => set({ selectedIds: new Set([id]) }),
  setSelection: (ids) => set({ selectedIds: new Set(ids) }),
  toggleSelection: (id) =>
    set((state) => {
      const selectedIds = new Set(state.selectedIds);
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      return { selectedIds };
    }),
  clearSelection: () => set({ selectedIds: new Set() }),
}));
