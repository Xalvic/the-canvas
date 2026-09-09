import { useEffect, useId, useRef, type ReactNode } from "react";
import { AlignLeft, AlignCenter, AlignRight, Check, X } from "lucide-react";
import {
  COLOR_PALETTE,
  PEN_WIDTHS,
  TEXT_SIZES,
  TEXT_WEIGHTS,
  type PenToolSettings,
  type TextToolSettings,
} from "../../tools/toolSettings";
import { useToolPreferencesStore } from "../../store/toolPreferencesStore";
import {
  useAppearancePreviewStore,
  useObjectOpacity,
} from "../../store/appearancePreviewStore";
import { useDocumentStore } from "../../store/documentStore";
import type {
  StrokeCanvasObject,
  TextCanvasObject,
} from "../../canvas/objects/types";
import { getStrokeBounds } from "../../canvas/strokes/strokeGeometry";
import { measureStyledTextHeight } from "../../canvas/objects/textAppearance";
import { performRedo, performUndo } from "../../history/historyCommands";

const SHORT_LABELS: Record<string, string> = {
  small: "S",
  medium: "M",
  large: "L",
  xl: "XL",
  regular: "R",
  bold: "B",
};
const ALIGNMENT_ICONS = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
};

function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
  renderOption,
}: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  onChange: (value: T) => void;
  renderOption?: (value: T) => ReactNode;
}) {
  return (
    <fieldset className="option-field">
      <legend>{label}</legend>
      <div className="option-segments">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={
              option === "xl" ? "XL" : option[0].toUpperCase() + option.slice(1)
            }
            title={
              option === "xl" ? "XL" : option[0].toUpperCase() + option.slice(1)
            }
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {renderOption
              ? renderOption(option)
              : (SHORT_LABELS[option] ??
                option[0].toUpperCase() + option.slice(1))}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function ColorPalette({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <fieldset className="option-field">
      <legend>Color</legend>
      <div className="color-palette">
        {COLOR_PALETTE.map((color) => (
          <button
            key={color.value}
            type="button"
            className="color-swatch"
            style={{ backgroundColor: color.value }}
            aria-label={color.name}
            title={color.name}
            aria-pressed={value === color.value}
            onClick={() => onChange(color.value)}
          >
            {value === color.value && (
              <Check
                size={15}
                strokeWidth={3}
                aria-hidden="true"
                color={
                  ["#ffffff", "#e9bd32"].includes(color.value)
                    ? "#252622"
                    : "#ffffff"
                }
              />
            )}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function OpacitySlider({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const pointerActive = useRef(false);
  return (
    <div className="option-field opacity-field">
      <label htmlFor={id}>
        Opacity <output htmlFor={id}>{Math.round(value * 100)}%</output>
      </label>
      <input
        id={id}
        type="range"
        min="0"
        max="100"
        step="1"
        value={Math.round(value * 100)}
        aria-valuetext={`${Math.round(value * 100)}%`}
        onPointerDown={(event) => {
          pointerActive.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onChange={(event) => {
          onChange(Number(event.target.value) / 100);
        }}
        onPointerUp={() => {
          pointerActive.current = false;
          onCommit?.();
        }}
        onPointerCancel={() => {
          pointerActive.current = false;
          onCancel?.();
        }}
        onLostPointerCapture={() => {
          if (pointerActive.current) {
            pointerActive.current = false;
            onCommit?.();
          }
        }}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
    </div>
  );
}

type AppearanceObject = StrokeCanvasObject | TextCanvasObject;
type ToolOptionsProps = {
  tool: "pen" | "text";
  object?: AppearanceObject;
  onClose?: () => void;
};

export function ToolOptions({ tool, object, onClose }: ToolOptionsProps) {
  const pen = useToolPreferencesStore((state) => state.pen);
  const text = useToolPreferencesStore((state) => state.text);
  const error = useToolPreferencesStore((state) => state.saveError);
  const opacity = useObjectOpacity(
    object?.id ?? "",
    object
      ? (object.opacity ?? 1)
      : tool === "pen"
        ? pen.opacity
        : text.opacity,
  );
  const preview = useAppearancePreviewStore.getState();

  useEffect(
    () => () => useAppearancePreviewStore.getState().cancel(),
    [object?.id],
  );

  const changePen = (updates: Partial<PenToolSettings>) => {
    if (object?.type !== "stroke") {
      useToolPreferencesStore.getState().setPen(updates);
      return;
    }
    const { size, ...appearance } = updates;
    useDocumentStore.getState().updateObject(
      object.id,
      {
        ...appearance,
        ...(size
          ? {
              strokeWidth: PEN_WIDTHS[size],
              ...getStrokeBounds(object.points, PEN_WIDTHS[size]),
            }
          : {}),
      },
      "Style stroke",
    );
  };
  const changeText = (updates: Partial<TextToolSettings>) => {
    if (object?.type !== "text") {
      useToolPreferencesStore.getState().setText(updates);
      return;
    }
    const { size, weight, align, ...appearance } = updates;
    const next = {
      ...object,
      ...appearance,
      ...(size ? { fontSize: TEXT_SIZES[size] } : {}),
      ...(weight ? { fontWeight: TEXT_WEIGHTS[weight] } : {}),
      ...(align ? { textAlign: align } : {}),
    };
    useDocumentStore.getState().updateObject(
      object.id,
      {
        ...next,
        height: measureStyledTextHeight(next),
      },
      "Style text",
    );
  };
  const p =
    object?.type === "stroke"
      ? {
          mode: object.mode ?? "draw",
          color: object.color,
          size: (Object.keys(PEN_WIDTHS) as PenToolSettings["size"][]).find(
            (key) => PEN_WIDTHS[key] === object.strokeWidth,
          ),
        }
      : pen;
  const t =
    object?.type === "text"
      ? {
          color: object.color ?? "#252622",
          size: (Object.keys(TEXT_SIZES) as TextToolSettings["size"][]).find(
            (key) => TEXT_SIZES[key] === (object.fontSize ?? 17),
          ),
          weight: (
            Object.keys(TEXT_WEIGHTS) as TextToolSettings["weight"][]
          ).find((key) => TEXT_WEIGHTS[key] === (object.fontWeight ?? 550)),
          align: object.textAlign ?? "left",
        }
      : text;

  return (
    <section
      className="tool-options"
      aria-label={
        object
          ? "Object appearance"
          : `${tool === "pen" ? "Pen" : "Text"} settings`
      }
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          ["z", "y"].includes(event.key.toLowerCase())
        ) {
          event.preventDefault();
          preview.commit();
          if (event.key.toLowerCase() === "y" || event.shiftKey) performRedo();
          else performUndo();
        }
        if (event.key === "Escape") {
          preview.cancel();
          onClose?.();
        }
        // Space/arrows activate controls; letter shortcuts must not change tools
        // while interacting with the panel.
        event.stopPropagation();
      }}
    >
      {object && (
        <div className="appearance-heading">
          <strong>
            {object.type === "stroke" ? "Stroke" : "Text"} appearance
          </strong>
          <button
            type="button"
            className="icon-button"
            aria-label="Close appearance"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {tool === "pen" ? (
        <>
          <Choices
            label="Mode"
            value={p.mode}
            options={["draw", "solid"]}
            onChange={(mode) => changePen({ mode })}
          />
          <ColorPalette
            value={p.color}
            onChange={(color) => changePen({ color })}
          />
          <Choices
            label="Thickness"
            value={p.size}
            options={["small", "large", "xl"]}
            onChange={(size) => changePen({ size })}
          />
        </>
      ) : (
        <>
          <ColorPalette
            value={t.color}
            onChange={(color) => changeText({ color })}
          />
          <Choices
            label="Size"
            value={t.size}
            options={["small", "medium", "large", "xl"]}
            onChange={(size) => changeText({ size })}
          />
          <Choices
            label="Weight"
            value={t.weight}
            options={["regular", "medium", "bold"]}
            onChange={(weight) => changeText({ weight })}
          />
          <Choices
            label="Alignment"
            value={t.align}
            options={["left", "center", "right"]}
            renderOption={(align) => {
              const Icon = ALIGNMENT_ICONS[align];
              return <Icon size={16} aria-hidden="true" />;
            }}
            onChange={(align) => changeText({ align })}
          />
        </>
      )}
      <OpacitySlider
        value={opacity}
        onChange={(value) => {
          if (object) preview.setOpacity(object.id, value);
          else if (tool === "pen") changePen({ opacity: value });
          else changeText({ opacity: value });
        }}
        onCommit={object ? preview.commit : undefined}
        onCancel={object ? preview.cancel : undefined}
      />
      {!object && error && (
        <p className="preference-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
