import { useDocumentStore } from "../../store/documentStore";
import { memo, useMemo } from "react";
import { StrokeObjectView } from "../strokes/StrokeObjectView";
import { isStrokeObject } from "../objects/types";
import { useSelectionStore } from "../../store/selectionStore";
import { getMovementIds } from "../groups/grouping";
import { strokeIntersectsWindow, type StrokeRenderWindow } from "../strokes/strokeVisibility";

export const StrokeLayer = memo(function StrokeLayer({ zoom, window }: { zoom: number; window: StrokeRenderWindow | null }) {
  const objects = useDocumentStore((state) => state.objects);
  const strokes = useMemo(() => Object.values(objects).filter(isStrokeObject), [objects]);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  // Use the existing selection's group/frame movement semantics. Keep stable
  // group elements for transient DOM movement even when their paths are culled.
  const pinnedIds = useMemo(() => getMovementIds(selectedIds, objects), [selectedIds, objects]);
  return (
    <svg className="stroke-layer" aria-label="Freehand strokes">
      {strokes.map((object) => (
        <StrokeObjectView key={object.id} object={object} zoom={zoom}
          visible={pinnedIds.has(object.id) || strokeIntersectsWindow(object, window)} />
      ))}
    </svg>
  );
});
