import { useEffect, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  MoreHorizontal,
  Moon,
  Pencil,
  SlidersHorizontal,
  Sun,
  Trash2,
} from "lucide-react";
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
import { useBoardStore } from "../../store/boardStore";
import { useDocumentStore } from "../../store/documentStore";
import { useInteractionStore } from "../../store/interactionStore";
import {
  useThemeStore,
  type ThemePreference,
} from "../../store/themeStore";
import { duplicateSelection } from "../../clipboard/clipboardCommands";
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

const mobilePrimaryTools = tools.filter(({ id }) =>
  (["select", "card", "text", "pen"] as ActiveTool[]).includes(id),
);
const mobileMoreTools = tools.filter(({ id }) =>
  (["hand", "connector", "frame"] as ActiveTool[]).includes(id),
);

function ThemePicker({ onSelect }: { onSelect?: () => void }) {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  const choices: Array<{
    id: ThemePreference;
    label: string;
    icon: typeof Sun;
  }> = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
  ];

  return (
    <div className="theme-picker" role="group" aria-label="Color theme">
      {choices.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={preference === id}
          onClick={() => {
            setPreference(id);
            onSelect?.();
          }}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function DesktopThemeControl() {
  const preference = useThemeStore((state) => state.preference);
  const [open, setOpen] = useState(false);
  const Icon = preference === "dark" ? Moon : Sun;

  return (
    <div className="tool-slot desktop-theme-control">
      <span className="tool-divider" aria-hidden="true" />
      <button
        type="button"
        className="tool-button"
        aria-label={`Theme: ${preference}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon aria-hidden="true" />
      </button>
      {open && (
        <div className="toolbar-popover toolbar-popover--theme">
          <strong>Theme</strong>
          <ThemePicker onSelect={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function ToolButton({
  id,
  label,
  shortcut,
  icon: Icon,
  activeTool,
  mobile = false,
  onSelect,
}: {
  id: ActiveTool;
  label: string;
  shortcut: string;
  icon: typeof SelectIcon;
  activeTool: ActiveTool;
  mobile?: boolean;
  onSelect: (tool: ActiveTool) => void;
}) {
  const readOnly = useBoardStore((state) => state.readOnly);
  return (
    <div className={`tool-slot${mobile ? " mobile-tool-slot" : ""}`}>
      <button
        className={`tool-button${mobile ? " mobile-tool-button" : ""}${activeTool === id ? " is-active" : ""}`}
        type="button"
        aria-label={`${label} tool`}
        aria-keyshortcuts={shortcut}
        aria-describedby={mobile ? undefined : `tooltip-${id}`}
        disabled={readOnly && id !== "select" && id !== "hand"}
        aria-pressed={activeTool === id}
        onClick={() => onSelect(id)}
      >
        <Icon aria-hidden="true" />
        {mobile && <span>{label}</span>}
      </button>
      {!mobile && (
        <span id={`tooltip-${id}`} role="tooltip" className="tool-tooltip">
          {label} <kbd>{shortcut}</kbd>
        </span>
      )}
    </div>
  );
}

function SelectionAction({
  label,
  icon,
  pressed,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={pressed ? "is-active" : undefined}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function Toolbar() {
  const readOnly = useBoardStore((state) => state.readOnly);
  const activeTool = useUiStore((state) => state.activeTool);
  const setActiveTool = useUiStore((state) => state.setActiveTool);
  const isMultiSelectMode = useUiStore((state) => state.isMultiSelectMode);
  const setMultiSelectMode = useUiStore((state) => state.setMultiSelectMode);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const selectedId = selectedIds.size === 1 ? [...selectedIds][0] : undefined;
  const selectedObject = useDocumentStore((state) =>
    selectedId ? state.objects[selectedId] : undefined,
  );
  const isEditing = useInteractionStore(
    (state) => state.mode === "editingText",
  );
  const [appearanceId, setAppearanceId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [collapsedPanels, setCollapsedPanels] = useState({
    pen: false,
    text: false,
    appearance: false,
  });
  const editable =
    !readOnly && !isEditing &&
    activeTool === "select" &&
    (selectedObject?.type === "text" || selectedObject?.type === "stroke")
      ? selectedObject
      : undefined;

  useEffect(() => {
    setAppearanceId(null);
    setMoreOpen(false);
  }, [activeTool, selectedId, isEditing]);

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 767px)");
    const collapseContextPanels = (matches: boolean) => {
      if (!matches) return;
      setCollapsedPanels((state) => ({
        ...state,
        pen: true,
        text: true,
      }));
    };
    collapseContextPanels(compact.matches);
    const handleChange = (event: MediaQueryListEvent) =>
      collapseContextPanels(event.matches);
    compact.addEventListener("change", handleChange);
    return () => compact.removeEventListener("change", handleChange);
  }, []);

  const chooseTool = (tool: ActiveTool) => {
    setAppearanceId(null);
    setMoreOpen(false);
    setActiveTool(tool);
  };

  const deleteSelected = () => {
    const selection = useSelectionStore.getState();
    useDocumentStore.getState().deleteObjects(selection.selectedIds);
    selection.clearSelection();
    useInteractionStore.getState().endInteraction();
  };

  return (
    <>
      <div className="toolbar-area">
        <div
          className="tool-dock desktop-tool-dock"
          role="toolbar"
          aria-label="Canvas tools"
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter")
              event.stopPropagation();
          }}
        >
          {tools.map((tool, index) => (
            <div className="desktop-tool-entry" key={tool.id}>
              {index === 2 && (
                <span className="tool-divider" aria-hidden="true" />
              )}
              <ToolButton
                {...tool}
                activeTool={activeTool}
                onSelect={chooseTool}
              />
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
                <SlidersHorizontal aria-hidden="true" />
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
          <DesktopThemeControl />
        </div>

        <div className="mobile-toolbar-wrap">
          {dockCollapsed ? (
            <button
              type="button"
              className="show-tools-button"
              aria-label="Show tool dock"
              onClick={() => setDockCollapsed(false)}
            >
              <ChevronUp aria-hidden="true" />
              Tools
            </button>
          ) : (
            <div
              className="tool-dock mobile-tool-dock"
              role="toolbar"
              aria-label="Canvas tools"
            >
              {mobilePrimaryTools.map((tool) => (
                <ToolButton
                  key={tool.id}
                  {...tool}
                  mobile
                  activeTool={activeTool}
                  onSelect={chooseTool}
                />
              ))}
              <div className="tool-slot mobile-tool-slot">
                <button
                  className={`tool-button mobile-tool-button${mobileMoreTools.some(({ id }) => id === activeTool) ? " is-active" : ""}`}
                  type="button"
                  aria-label="More tools"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((value) => !value)}
                >
                  <MoreHorizontal aria-hidden="true" />
                  <span>More</span>
                </button>
                {moreOpen && (
                  <div className="toolbar-popover mobile-more-menu">
                    <div className="mobile-more-tools">
                      {mobileMoreTools.map(({ id, label, icon: Icon }) => (
                        <button
                          key={id}
                          type="button"
                          className={activeTool === id ? "is-active" : undefined}
                          aria-label={`${label} tool`}
                          disabled={readOnly && id !== "select" && id !== "hand"}
                          aria-pressed={activeTool === id}
                          onClick={() => chooseTool(id)}
                        >
                          <Icon aria-hidden="true" />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                    <strong>Theme</strong>
                    <ThemePicker onSelect={() => setMoreOpen(false)} />
                  </div>
                )}
              </div>
              <button
                type="button"
                className="mobile-dock-collapse"
                aria-label="Collapse tool dock"
                onClick={() => {
                  setMoreOpen(false);
                  setDockCollapsed(true);
                }}
              >
                <ChevronDown aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>

      {!readOnly && !isEditing && activeTool === "select" && selectedIds.size > 0 && (
        <div className="mobile-selection-actions" aria-label="Selection actions">
          <SelectionAction
            label="Multi-select"
            icon={<SelectIcon aria-hidden="true" />}
            pressed={isMultiSelectMode}
            onClick={() => setMultiSelectMode(!isMultiSelectMode)}
          />
          {selectedObject &&
            ["text", "card", "frame"].includes(selectedObject.type) && (
              <SelectionAction
                label="Edit"
                icon={<Pencil aria-hidden="true" />}
                onClick={() =>
                  useInteractionStore
                    .getState()
                    .beginInteraction("editingText", selectedObject.id)
                }
              />
            )}
          {editable && (
            <SelectionAction
              label="Style"
              icon={<SlidersHorizontal aria-hidden="true" />}
              pressed={appearanceId === editable.id}
              onClick={() =>
                setAppearanceId(
                  appearanceId === editable.id ? null : editable.id,
                )
              }
            />
          )}
          <SelectionAction
            label="Duplicate"
            icon={<Copy aria-hidden="true" />}
            onClick={duplicateSelection}
          />
          <SelectionAction
            label="Delete"
            icon={<Trash2 aria-hidden="true" />}
            onClick={deleteSelected}
          />
        </div>
      )}

      {!readOnly && (activeTool === "pen" || activeTool === "text") && (
        <ToolOptions
          key={activeTool}
          tool={activeTool}
          collapsed={collapsedPanels[activeTool]}
          onToggleCollapsed={() =>
            setCollapsedPanels((state) => ({
              ...state,
              [activeTool]: !state[activeTool],
            }))
          }
          onClose={() => setActiveTool("select")}
        />
      )}
      {editable && appearanceId === editable.id && (
        <ToolOptions
          key={editable.id}
          tool={editable.type === "stroke" ? "pen" : "text"}
          object={editable}
          collapsed={collapsedPanels.appearance}
          onToggleCollapsed={() =>
            setCollapsedPanels((state) => ({
              ...state,
              appearance: !state.appearance,
            }))
          }
          onClose={() => setAppearanceId(null)}
        />
      )}
    </>
  );
}
