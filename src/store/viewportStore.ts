import { create } from "zustand";
import type { Viewport } from "../canvas/viewport/viewportMath";

type ViewportState = {
  viewport: Viewport;
  setViewport: (viewport: Viewport) => void;
};

export const initialViewport: Viewport = {
  x: 0,
  y: 0,
  zoom: 1,
};

/** Persistent viewport state. Pointer movement stays transient until it settles. */
export const useViewportStore = create<ViewportState>((set) => ({
  viewport: initialViewport,
  setViewport: (viewport) => set({ viewport }),
}));
