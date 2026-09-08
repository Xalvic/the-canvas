import { HandIcon, NoteIcon, SelectIcon, TextIcon } from "../icons";
import { useUiStore, type ActiveTool } from "../../store/uiStore";

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
];

export function Toolbar() {
  const activeTool = useUiStore((state) => state.activeTool);
  const setActiveTool = useUiStore((state) => state.setActiveTool);

  return (
    <div className="tool-dock" role="toolbar" aria-label="Canvas tools">
      {tools.map(({ id, label, shortcut, icon: Icon }, index) => (
        <div className="tool-slot" key={id}>
          {index === 2 && <span className="tool-divider" aria-hidden="true" />}
          <button
            className={`tool-button${activeTool === id ? " is-active" : ""}`}
            type="button"
            aria-label={`${label} tool`}
            aria-pressed={activeTool === id}
            title={`${label} tool (${shortcut})`}
            onClick={() => setActiveTool(id)}
          >
            <Icon />
            <span className="tool-label">{label}</span>
            <kbd>{shortcut}</kbd>
          </button>
        </div>
      ))}
    </div>
  );
}
