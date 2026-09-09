import { create } from "zustand";
import {
  parseToolPreferences,
  type PenToolSettings,
  type TextToolSettings,
} from "../tools/toolSettings";

export const TOOL_PREFERENCES_KEY = "the-canvas:tool-preferences:v1";

function readPreferences() {
  try {
    return parseToolPreferences(
      JSON.parse(localStorage.getItem(TOOL_PREFERENCES_KEY) ?? "null"),
    );
  } catch {
    return parseToolPreferences(null);
  }
}

type ToolPreferencesState = {
  pen: PenToolSettings;
  text: TextToolSettings;
  saveError: string | null;
  setPen: (updates: Partial<PenToolSettings>) => void;
  setText: (updates: Partial<TextToolSettings>) => void;
};

export const useToolPreferencesStore = create<ToolPreferencesState>(
  (set, get) => {
    const save = () => {
      const { pen, text } = get();
      try {
        localStorage.setItem(
          TOOL_PREFERENCES_KEY,
          JSON.stringify({ pen, text }),
        );
        set({ saveError: null });
      } catch {
        set({
          saveError: "Tool preferences could not be saved on this device.",
        });
      }
    };
    return {
      ...readPreferences(),
      saveError: null,
      setPen: (updates) => {
        set((state) => ({ pen: { ...state.pen, ...updates } }));
        save();
      },
      setText: (updates) => {
        set((state) => ({ text: { ...state.text, ...updates } }));
        save();
      },
    };
  },
);
