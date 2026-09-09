export const COLOR_PALETTE = [
  { name: "Black", value: "#252622" },
  { name: "Dark gray", value: "#3f413d" },
  { name: "Gray", value: "#8b8e88" },
  { name: "White", value: "#ffffff" },
  { name: "Red", value: "#dc4545" },
  { name: "Orange", value: "#e88635" },
  { name: "Yellow", value: "#e9bd32" },
  { name: "Brown", value: "#946449" },
  { name: "Green", value: "#41965e" },
  { name: "Teal", value: "#249c94" },
  { name: "Sky", value: "#47a9d1" },
  { name: "Blue", value: "#3878d5" },
  { name: "Indigo", value: "#5854ca" },
  { name: "Purple", value: "#9958c8" },
  { name: "Pink", value: "#dc639e" },
  { name: "Rose", value: "#ba5067" },
] as const;

export const PEN_WIDTHS = { small: 4, large: 10, xl: 20 } as const;
export const TEXT_SIZES = { small: 17, medium: 24, large: 36, xl: 52 } as const;
export const TEXT_WEIGHTS = { regular: 400, medium: 500, bold: 700 } as const;

export type PenToolSettings = {
  mode: "draw" | "solid";
  color: string;
  size: keyof typeof PEN_WIDTHS;
  opacity: number;
};

export type TextToolSettings = {
  color: string;
  size: keyof typeof TEXT_SIZES;
  opacity: number;
  weight: keyof typeof TEXT_WEIGHTS;
  align: "left" | "center" | "right";
};

export const DEFAULT_PEN_SETTINGS: PenToolSettings = {
  mode: "draw",
  color: "#3f413d",
  size: "small",
  opacity: 1,
};
export const DEFAULT_TEXT_SETTINGS: TextToolSettings = {
  color: "#252622",
  size: "small",
  opacity: 1,
  weight: "regular",
  align: "left",
};

export function isPresetColor(value: unknown): value is string {
  return COLOR_PALETTE.some((color) => color.value === value);
}

export function isOpacity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

// Read individual fields defensively so one stale preference doesn't discard others.
export function parseToolPreferences(value: unknown) {
  const pen = { ...DEFAULT_PEN_SETTINGS };
  const text = { ...DEFAULT_TEXT_SETTINGS };
  if (!value || typeof value !== "object") return { pen, text };
  const data = value as Record<string, unknown>;
  if (data.pen && typeof data.pen === "object") {
    const p = data.pen as Record<string, unknown>;
    if (p.mode === "draw" || p.mode === "solid") pen.mode = p.mode;
    if (isPresetColor(p.color)) pen.color = p.color;
    if (p.size === "small" || p.size === "large" || p.size === "xl")
      pen.size = p.size;
    if (isOpacity(p.opacity)) pen.opacity = p.opacity;
  }
  if (data.text && typeof data.text === "object") {
    const t = data.text as Record<string, unknown>;
    if (isPresetColor(t.color)) text.color = t.color;
    if (
      t.size === "small" ||
      t.size === "medium" ||
      t.size === "large" ||
      t.size === "xl"
    )
      text.size = t.size;
    if (isOpacity(t.opacity)) text.opacity = t.opacity;
    if (t.weight === "regular" || t.weight === "medium" || t.weight === "bold")
      text.weight = t.weight;
    if (t.align === "left" || t.align === "center" || t.align === "right")
      text.align = t.align;
  }
  return { pen, text };
}
