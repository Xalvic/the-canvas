import { create } from "zustand";
import type { CanvasObject } from "../canvas/objects/types";
import type { Point } from "../canvas/viewport/viewportMath";

type DocumentState = {
  objects: Record<string, CanvasObject>;
  addObject: (object: CanvasObject) => void;
  updateObject: (id: string, updates: Partial<CanvasObject>) => void;
  updateObjectPositions: (positions: Record<string, Point>) => void;
  deleteObjects: (ids: Iterable<string>) => void;
  getNextZIndex: () => number;
};

export const useDocumentStore = create<DocumentState>((set, get) => ({
  objects: {},

  addObject: (object) =>
    set((state) => ({
      objects: { ...state.objects, [object.id]: object },
    })),

  updateObject: (id, updates) =>
    set((state) => {
      const object = state.objects[id];
      if (!object) return state;

      return {
        objects: {
          ...state.objects,
          [id]: {
            ...object,
            ...updates,
            updatedAt: Date.now(),
          } as CanvasObject,
        },
      };
    }),

  updateObjectPositions: (positions) =>
    set((state) => {
      const nextObjects = { ...state.objects };
      const updatedAt = Date.now();
      let changed = false;

      for (const [id, position] of Object.entries(positions)) {
        const object = nextObjects[id];
        if (!object) continue;
        nextObjects[id] = { ...object, ...position, updatedAt };
        changed = true;
      }

      return changed ? { objects: nextObjects } : state;
    }),

  deleteObjects: (ids) =>
    set((state) => {
      const nextObjects = { ...state.objects };
      let changed = false;

      for (const id of ids) {
        if (id in nextObjects) {
          delete nextObjects[id];
          changed = true;
        }
      }

      return changed ? { objects: nextObjects } : state;
    }),

  getNextZIndex: () => {
    const objects = Object.values(get().objects);
    return objects.length === 0
      ? 1
      : Math.max(...objects.map((object) => object.zIndex)) + 1;
  },
}));
