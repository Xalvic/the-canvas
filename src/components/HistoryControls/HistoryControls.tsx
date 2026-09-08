import { performRedo, performUndo } from "../../history/historyCommands";
import { useDocumentStore } from "../../store/documentStore";
import { RedoIcon, UndoIcon } from "../icons";

export function HistoryControls() {
  const undoLabel = useDocumentStore((state) => state.past.at(-1)?.label);
  const redoLabel = useDocumentStore((state) => state.future.at(-1)?.label);

  return (
    <div className="history-controls" role="group" aria-label="History controls">
      <button
        className="icon-button"
        type="button"
        onClick={performUndo}
        disabled={!undoLabel}
        aria-label={undoLabel ? `Undo ${undoLabel}` : "Nothing to undo"}
        title={undoLabel ? `Undo ${undoLabel} (Ctrl/⌘ Z)` : "Nothing to undo"}
      >
        <UndoIcon />
      </button>
      <button
        className="icon-button"
        type="button"
        onClick={performRedo}
        disabled={!redoLabel}
        aria-label={redoLabel ? `Redo ${redoLabel}` : "Nothing to redo"}
        title={
          redoLabel
            ? `Redo ${redoLabel} (Ctrl/⌘ Shift Z)`
            : "Nothing to redo"
        }
      >
        <RedoIcon />
      </button>
    </div>
  );
}
