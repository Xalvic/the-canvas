import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useDocumentStore } from "../../store/documentStore";
import { useInteractionStore } from "../../store/interactionStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useUiStore } from "../../store/uiStore";
import { useViewportStore } from "../../store/viewportStore";
import { useObjectOpacity } from "../../store/appearancePreviewStore";
import { refreshConnectorGeometryFromDom } from "../connectors/connectorDom";
import {
  expandIdsToGroups,
  getMovementIds,
  toggleObjectOrGroup,
} from "../groups/grouping";
import {
  clearMovementTransforms,
  collectMovementElements,
  paintMovementElements,
  type MovementElement,
} from "../objects/transientMovement";
import {
  isCanvasSpatialObject,
  type StrokeCanvasObject,
} from "../objects/types";
import type { Point } from "../viewport/viewportMath";
import {
  buildSmoothedStrokePath,
  buildVariableWidthStrokePath,
} from "./strokeGeometry";

type StrokeObjectViewProps = {
  object: StrokeCanvasObject;
};

type DragInteraction = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPositions: Record<string, Point>;
  nextPositions: Record<string, Point>;
  elements: Map<string, MovementElement>;
};

export function StrokeObjectView({ object }: StrokeObjectViewProps) {
  const opacity = useObjectOpacity(object.id, object.opacity);
  const dragRef = useRef<DragInteraction | null>(null);
  const activeTool = useUiStore((state) => state.activeTool);
  const isSelected = useSelectionStore((state) =>
    state.selectedIds.has(object.id),
  );
  const setSelection = useSelectionStore((state) => state.setSelection);
  const updateObjectPositions = useDocumentStore(
    (state) => state.updateObjectPositions,
  );
  const beginInteraction = useInteractionStore(
    (state) => state.beginInteraction,
  );
  const endInteraction = useInteractionStore((state) => state.endInteraction);

  const beginDrag = (event: ReactPointerEvent<SVGPathElement>) => {
    const isSpacePressed =
      event.currentTarget.closest<HTMLElement>(".canvas-viewport")?.dataset
        .spacePressed === "true";
    if (event.button !== 0 || activeTool === "hand" || isSpacePressed) return;
    if (activeTool !== "select") return;

    event.preventDefault();
    event.stopPropagation();
    const documentObjects = useDocumentStore.getState().objects;
    const selection = useSelectionStore.getState().selectedIds;
    if (event.shiftKey) {
      setSelection(
        toggleObjectOrGroup(selection, object.id, documentObjects),
      );
      return;
    }

    const baseSelection = selection.has(object.id)
      ? expandIdsToGroups(selection, documentObjects)
      : expandIdsToGroups([object.id], documentObjects);
    if (!selection.has(object.id) || baseSelection.size !== selection.size) {
      setSelection(baseSelection);
    }
    const movingIds = getMovementIds(baseSelection, documentObjects);
    const startPositions: Record<string, Point> = {};
    for (const id of movingIds) {
      const movingObject = documentObjects[id];
      if (movingObject && isCanvasSpatialObject(movingObject)) {
        startPositions[id] = { x: movingObject.x, y: movingObject.y };
      }
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPositions,
      nextPositions: { ...startPositions },
      elements: collectMovementElements(startPositions),
    };
    beginInteraction("dragging", object.id);
  };

  const continueDrag = (event: ReactPointerEvent<SVGPathElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    const zoom = useViewportStore.getState().viewport.zoom;
    const deltaX = (event.clientX - drag.startClientX) / zoom;
    const deltaY = (event.clientY - drag.startClientY) / zoom;
    for (const [id, start] of Object.entries(drag.startPositions)) {
      drag.nextPositions[id] = {
        x: start.x + deltaX,
        y: start.y + deltaY,
      };
    }
    paintMovementElements(
      drag.startPositions,
      drag.nextPositions,
      drag.elements,
    );
    refreshConnectorGeometryFromDom(useDocumentStore.getState().objects);
  };

  const endDrag = (event: ReactPointerEvent<SVGPathElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    clearMovementTransforms(drag.elements);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    updateObjectPositions(drag.nextPositions);
    endInteraction();
  };

  const handleLostPointerCapture = (
    event: ReactPointerEvent<SVGPathElement>,
  ) => {
    if (dragRef.current?.pointerId === event.pointerId) endDrag(event);
  };

  const centerlinePath = buildSmoothedStrokePath(object.points);
  const strokePath = object.mode === "solid" ? centerlinePath : buildVariableWidthStrokePath(
    object.points,
    object.strokeWidth,
  );
  return (
    <g
      className={`stroke-object${isSelected ? " is-selected" : ""}`}
      data-stroke-object-id={object.id}
    >
      <path
        className="stroke-hit-area"
        d={centerlinePath}
        strokeWidth={Math.max(14, object.strokeWidth + 10)}
        onPointerDown={beginDrag}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={handleLostPointerCapture}
      />
      <path
        className="stroke-shape"
        d={strokePath}
        fill={object.mode === "solid" ? "none" : object.color}
        stroke={object.mode === "solid" ? object.color : "none"}
        strokeWidth={object.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
      />
    </g>
  );
}
