import { useDocumentStore } from "../../store/documentStore";
import { useInteractionStore } from "../../store/interactionStore";
import { useSelectionStore } from "../../store/selectionStore";
import { getCombinedBounds } from "../../utils/geometry";

export function SelectionLayer() {
  const objects = useDocumentStore((state) => state.objects);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const isDragging = useInteractionStore((state) => state.mode === "dragging");
  const selectedObjects = [...selectedIds]
    .map((id) => objects[id])
    .filter((object) => object !== undefined);

  if (selectedObjects.length < 2) return null;
  const bounds = getCombinedBounds(selectedObjects);
  if (!bounds) return null;

  return (
    <div
      className={`multi-selection-bounds${isDragging ? " is-dragging" : ""}`}
      style={{
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
        transform: `translate3d(${bounds.left}px, ${bounds.top}px, 0)`,
      }}
      aria-hidden="true"
    >
      <span>{selectedObjects.length} objects</span>
    </div>
  );
}
