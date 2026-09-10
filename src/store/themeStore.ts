import { create } from "zustand";

export type ThemePreference = "light" | "dark";

export const THEME_STORAGE_KEY = "scribble:theme";

const isThemePreference = (value: string | null): value is ThemePreference =>
  value === "light" || value === "dark";

function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    return "light";
  } catch {
    return "light";
  }
}

export function applyTheme(preference: ThemePreference) {
  document.documentElement.dataset.theme = preference;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = preference;
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute(
      "content",
      preference === "dark" ? "#20211f" : "#f7f7f4",
    );
}

type ThemeState = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const initialPreference = readThemePreference();
applyTheme(initialPreference);

export const useThemeStore = create<ThemeState>((set) => ({
  preference: initialPreference,
  setPreference: (preference) => {
    set({ preference });
    applyTheme(preference);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Theme still applies for this visit when storage is unavailable.
    }
  },
}));
