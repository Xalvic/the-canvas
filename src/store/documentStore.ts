import { create } from "zustand";
import {
  isCanvasSpatialObject,
  isConnectorObject,
  isStrokeObject,
  type CanvasObject,
} from "../canvas/objects/types";
import type { Point } from "../canvas/viewport/viewportMath";

export type DocumentSnapshot = Record<string, CanvasObject>;

export type HistoryEntry = {
  objects: DocumentSnapshot;
  label: string;
};

type DocumentState = {
  objects: DocumentSnapshot;
  past: HistoryEntry[];
  future: HistoryEntry[];
  loadDocument: (objects: DocumentSnapshot) => void;
  addObject: (object: CanvasObject, label?: string) => void;
  addObjects: (objects: CanvasObject[], label?: string) => void;
  updateObject: (
    id: string,
    updates: Partial<CanvasObject>,
    label?: string,
  ) => void;
  updateObjectPositions: (
    positions: Record<string, Point>,
    label?: string,
  ) => void;
  setObjectGroup: (
    ids: Iterable<string>,
    groupId: string | null,
    label?: string,
  ) => void;
  deleteObjects: (ids: Iterable<string>, label?: string) => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
  getNextZIndex: () => number;
};

export const MAX_HISTORY_ENTRIES = 100;

function pushHistory(
  history: HistoryEntry[],
  entry: HistoryEntry,
): HistoryEntry[] {
  return [...history, entry].slice(-MAX_HISTORY_ENTRIES);
}

function creationLabel(object: CanvasObject): string {
  if (object.type === "card") return "Create note";
  if (object.type === "text") return "Create text";
  if (object.type === "frame") return "Create frame";
  if (object.type === "stroke") return "Draw stroke";
  if (object.type === "image") return "Insert image";
  return "Create connector";
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  objects: {},
  past: [],
  future: [],

  loadDocument: (objects) => set({ objects, past: [], future: [] }),

  addObject: (object, label) =>
    get().addObjects([object], label ?? creationLabel(object)),

  addObjects: (objects, label = "Add objects") =>
    set((state) => {
      if (objects.length === 0) return state;
      const nextObjects = { ...state.objects };
      for (const object of objects) nextObjects[object.id] = object;

      return {
        objects: nextObjects,
        past: pushHistory(state.past, { objects: state.objects, label }),
        future: [],
      };
    }),

  updateObject: (id, updates, label = "Edit object") =>
    set((state) => {
      const object = state.objects[id];
      if (!object) return state;
      const changed = Object.entries(updates).some(
        ([key, value]) =>
          (object as unknown as Record<string, unknown>)[key] !== value,
      );
      if (!changed) return state;

      return {
        objects: {
          ...state.objects,
          [id]: {
            ...object,
            ...updates,
            updatedAt: Date.now(),
          } as CanvasObject,
        },
        past: pushHistory(state.past, { objects: state.objects, label }),
        future: [],
      };
    }),

  updateObjectPositions: (positions, label = "Move selection") =>
    set((state) => {
      const nextObjects = { ...state.objects };
      const updatedAt = Date.now();
      let changed = false;

      for (const [id, position] of Object.entries(positions)) {
        const object = nextObjects[id];
        if (
          !object ||
          !isCanvasSpatialObject(object) ||
          (object.x === position.x && object.y === position.y)
        ) {
          continue;
        }
        if (isStrokeObject(object)) {
          const deltaX = position.x - object.x;
          const deltaY = position.y - object.y;
          nextObjects[id] = {
            ...object,
            ...position,
            points: object.points.map((point) => ({
              ...point,
              x: point.x + deltaX,
              y: point.y + deltaY,
            })),
            updatedAt,
          };
        } else {
          nextObjects[id] = { ...object, ...position, updatedAt };
        }
        changed = true;
      }

      if (!changed) return state;
      return {
        objects: nextObjects,
        past: pushHistory(state.past, { objects: state.objects, label }),
        future: [],
      };
    }),

  setObjectGroup: (ids, groupId, label = "Group objects") =>
    set((state) => {
      const nextObjects = { ...state.objects };
      const updatedAt = Date.now();
      let changed = false;

      for (const id of ids) {
        const object = nextObjects[id];
        if (
          !object ||
          !isCanvasSpatialObject(object) ||
          (object.groupId ?? null) === groupId
        ) {
          continue;
        }
        const nextObject = { ...object, updatedAt };
        if (groupId) nextObject.groupId = groupId;
        else delete nextObject.groupId;
        nextObjects[id] = nextObject;
        changed = true;
      }

      if (!changed) return state;
      return {
        objects: nextObjects,
        past: pushHistory(state.past, { objects: state.objects, label }),
        future: [],
      };
    }),

  deleteObjects: (ids, label = "Delete selection") =>
    set((state) => {
      const nextObjects = { ...state.objects };
      const deletedIds = new Set(ids);
      for (const object of Object.values(state.objects)) {
        if (
          isConnectorObject(object) &&
          (deletedIds.has(object.from.objectId) ||
            deletedIds.has(object.to.objectId))
        ) {
          deletedIds.add(object.id);
        }
      }
      let changed = false;

      for (const id of deletedIds) {
        if (id in nextObjects) {
          delete nextObjects[id];
          changed = true;
        }
      }

      if (!changed) return state;
      return {
        objects: nextObjects,
        past: pushHistory(state.past, { objects: state.objects, label }),
        future: [],
      };
    }),

  undo: () =>
    set((state) => {
      const entry = state.past.at(-1);
      if (!entry) return state;

      return {
        objects: entry.objects,
        past: state.past.slice(0, -1),
        future: pushHistory(state.future, {
          objects: state.objects,
          label: entry.label,
        }),
      };
    }),

  redo: () =>
    set((state) => {
      const entry = state.future.at(-1);
      if (!entry) return state;

      return {
        objects: entry.objects,
        past: pushHistory(state.past, {
          objects: state.objects,
          label: entry.label,
        }),
        future: state.future.slice(0, -1),
      };
    }),

  clearHistory: () => set({ past: [], future: [] }),

  getNextZIndex: () => {
    const objects = Object.values(get().objects);
    return objects.length === 0
      ? 1
      : Math.max(...objects.map((object) => object.zIndex)) + 1;
  },
}));
