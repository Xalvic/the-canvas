import { create } from "zustand";
import type { CanvasObject } from "../canvas/objects/types";

type ClipboardState = {
  objects: CanvasObject[];
  pasteGeneration: number;
  copyObjects: (objects: CanvasObject[]) => void;
  nextPasteGeneration: () => number;
};

export const useClipboardStore = create<ClipboardState>((set) => ({
  objects: [],
  pasteGeneration: 0,
  copyObjects: (objects) =>
    set({
      objects: objects.map((object) => ({ ...object })),
      pasteGeneration: 0,
    }),
  nextPasteGeneration: () => {
    let generation = 1;
    set((state) => {
      generation = state.pasteGeneration + 1;
      return { pasteGeneration: generation };
    });
    return generation;
  },
}));
