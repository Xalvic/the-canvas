import { create } from "zustand";

export type InteractionMode =
  | "idle"
  | "panning"
  | "marquee"
  | "dragging"
  | "resizing"
  | "editingText";

type InteractionState = {
  mode: InteractionMode;
  objectId: string | null;
  beginInteraction: (mode: InteractionMode, objectId?: string) => void;
  endInteraction: () => void;
};

export const useInteractionStore = create<InteractionState>((set) => ({
  mode: "idle",
  objectId: null,
  beginInteraction: (mode, objectId) =>
    set({ mode, objectId: objectId ?? null }),
  endInteraction: () => set({ mode: "idle", objectId: null }),
}));
