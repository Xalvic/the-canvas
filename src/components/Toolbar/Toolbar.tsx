import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  ConnectorIcon,
  FrameIcon,
  HandIcon,
  NoteIcon,
  PenIcon,
  SelectIcon,
  TextIcon,
} from "../icons";
import { useUiStore, type ActiveTool } from "../../store/uiStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useDocumentStore } from "../../store/documentStore";
import { useInteractionStore } from "../../store/interactionStore";
import { ToolOptions } from "../ToolOptions/ToolOptions";

const tools: Array<{
  id: ActiveTool;
  label: string;
  shortcut: string;
  icon: typeof SelectIcon;
}> = [
  { id: "select", label: "Select", shortcut: "V", icon: SelectIcon },
  { id: "hand", label: "Hand", shortcut: "H", icon: HandIcon },
  { id: "card", label: "Note", shortcut: "N", icon: NoteIcon },
  { id: "text", label: "Text", shortcut: "T", icon: TextIcon },
  {
    id: "connector",
    label: "Connect",
    shortcut: "C",
    icon: ConnectorIcon,
  },
  { id: "frame", label: "Frame", shortcut: "F", icon: FrameIcon },
  { id: "pen", label: "Pen", shortcut: "P", icon: PenIcon },
];

export function Toolbar() {
  const activeTool = useUiStore((state) => state.activeTool);
  const setActiveTool = useUiStore((state) => state.setActiveTool);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const selectedId = selectedIds.size === 1 ? [...selectedIds][0] : undefined;
  const selectedObject = useDocumentStore((state) =>
    selectedId ? state.objects[selectedId] : undefined,
  );
  const isEditing = useInteractionStore(
    (state) => state.mode === "editingText",
  );
  const [appearanceId, setAppearanceId] = useState<string | null>(null);
  const editable =
    !isEditing &&
    activeTool === "select" &&
    (selectedObject?.type === "text" || selectedObject?.type === "stroke")
      ? selectedObject
      : undefined;
  useEffect(() => {
    setAppearanceId(null);
  }, [activeTool, selectedId, isEditing]);

  return (
    <>
      <div className="toolbar-area">
        <div
          className="tool-dock"
          role="toolbar"
          aria-label="Canvas tools"
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter")
              event.stopPropagation();
          }}
        >
          {tools.map(({ id, label, shortcut, icon: Icon }, index) => (
            <div className="tool-slot" key={id}>
              {index === 2 && (
                <span className="tool-divider" aria-hidden="true" />
              )}
              <button
                className={`tool-button${activeTool === id ? " is-active" : ""}`}
                type="button"
                aria-label={`${label} tool`}
                aria-keyshortcuts={shortcut}
                aria-describedby={`tooltip-${id}`}
                aria-pressed={activeTool === id}
                onClick={() => {
                  setAppearanceId(null);
                  setActiveTool(id);
                }}
              >
                <Icon />
              </button>
              <span
                id={`tooltip-${id}`}
                role="tooltip"
                className="tool-tooltip"
              >
                {label} <kbd>{shortcut}</kbd>
              </span>
            </div>
          ))}
          {editable && (
            <div className="tool-slot">
              <span className="tool-divider" aria-hidden="true" />
              <button
                type="button"
                className="tool-button"
                aria-label="Edit appearance"
                aria-expanded={appearanceId === editable.id}
                aria-describedby="tooltip-appearance"
                onClick={() =>
                  setAppearanceId(
                    appearanceId === editable.id ? null : editable.id,
                  )
                }
              >
                <SlidersHorizontal />
              </button>
              <span
                id="tooltip-appearance"
                role="tooltip"
                className="tool-tooltip"
              >
                Edit appearance
              </span>
            </div>
          )}
        </div>
      </div>
      {(activeTool === "pen" || activeTool === "text") && (
        <ToolOptions
          key={activeTool}
          tool={activeTool}
          onClose={() => setActiveTool("select")}
        />
      )}
      {editable && appearanceId === editable.id && (
        <ToolOptions
          key={editable.id}
          tool={editable.type === "stroke" ? "pen" : "text"}
          object={editable}
          onClose={() => setAppearanceId(null)}
        />
      )}
    </>
  );
}
