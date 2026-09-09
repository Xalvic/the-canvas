import { create } from "zustand";
import { useDocumentStore } from "./documentStore";

type AppearancePreview = { objectId: string; opacity: number };
type AppearancePreviewState = {
  preview: AppearancePreview | null;
  setOpacity: (objectId: string, opacity: number) => void;
  commit: () => void;
  cancel: () => void;
};

// Slider previews never enter the document or autosave. The final value uses
// the existing history command once, including keyboard and focus interactions.
export const useAppearancePreviewStore = create<AppearancePreviewState>(
  (set, get) => ({
    preview: null,
    setOpacity: (objectId, opacity) => set({ preview: { objectId, opacity } }),
    commit: () => {
      const preview = get().preview;
      if (!preview) return;
      const object = useDocumentStore.getState().objects[preview.objectId];
      if (
        object &&
        (object.type === "text" || object.type === "stroke") &&
        (object.opacity ?? 1) !== preview.opacity
      ) {
        useDocumentStore
          .getState()
          .updateObject(
            preview.objectId,
            { opacity: preview.opacity },
            "Change opacity",
          );
      }
      set({ preview: null });
    },
    cancel: () => set({ preview: null }),
  }),
);

export function useObjectOpacity(objectId: string, opacity = 1) {
  return useAppearancePreviewStore((state) =>
    state.preview?.objectId === objectId ? state.preview.opacity : opacity,
  );
}
