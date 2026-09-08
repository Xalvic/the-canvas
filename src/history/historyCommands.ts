import { useDocumentStore } from "../store/documentStore";
import { useInteractionStore } from "../store/interactionStore";
import { useSelectionStore } from "../store/selectionStore";

function reconcileSelection(): void {
  const objectIds = new Set(Object.keys(useDocumentStore.getState().objects));
  const selection = useSelectionStore.getState();
  const retainedIds = [...selection.selectedIds].filter((id) =>
    objectIds.has(id),
  );

  if (retainedIds.length !== selection.selectedIds.size) {
    selection.setSelection(retainedIds);
  }
  useInteractionStore.getState().endInteraction();
}

export function performUndo(): void {
  useDocumentStore.getState().undo();
  reconcileSelection();
}

export function performRedo(): void {
  useDocumentStore.getState().redo();
  reconcileSelection();
}
