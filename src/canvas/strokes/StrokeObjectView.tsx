import {
  memo,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useBoardStore } from "../../store/boardStore";
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
import { CANCEL_TOUCH_INTERACTIONS_EVENT } from "../viewport/pointerInteractionEvents";
import { getStrokeGeometry } from "./strokeRenderer";
import { chooseStrokeDetail, simpleStrokeWidthStyle, strokeHitWidthStyle } from "./strokePresentation";

type StrokeObjectViewProps = {
  object: StrokeCanvasObject;
  zoom: number;
  visible: boolean;
};

type DragInteraction = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPositions: Record<string, Point>;
  nextPositions: Record<string, Point>;
  elements: Map<string, MovementElement>;
};

export const StrokeObjectView = memo(function StrokeObjectView({ object, zoom, visible }: StrokeObjectViewProps) {
  const opacity = useObjectOpacity(object.id, object.opacity);
  const dragRef = useRef<DragInteraction | null>(null);
  const simpleRef = useRef(false);
  const activeTool = useUiStore((state) => state.activeTool);
  const isMultiSelectMode = useUiStore((state) => state.isMultiSelectMode);
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
    if (event.shiftKey || isMultiSelectMode) {
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
    if (useBoardStore.getState().readOnly) return;
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

  useEffect(() => {
    const cancelTouchInteraction = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      clearMovementTransforms(drag.elements);
      const path = document.querySelector<SVGPathElement>(
        `[data-stroke-object-id="${object.id}"] .stroke-hit-area`,
      );
      if (path?.hasPointerCapture(drag.pointerId)) {
        path.releasePointerCapture(drag.pointerId);
      }
    };
    window.addEventListener(
      CANCEL_TOUCH_INTERACTIONS_EVENT,
      cancelTouchInteraction,
    );
    return () =>
      window.removeEventListener(
        CANCEL_TOUCH_INTERACTIONS_EVENT,
        cancelTouchInteraction,
      );
  }, [object.id]);

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

  if (!visible && !isSelected) return <g className="stroke-object" data-stroke-object-id={object.id} />;
  const geometry = getStrokeGeometry(object);
  simpleRef.current = object.mode !== "solid" && chooseStrokeDetail(object.strokeWidth, object.inputKind, zoom, simpleRef.current);
  const simple = simpleRef.current;
  const solid = object.mode === "solid" || simple;
  const centerlinePath = geometry.centerlinePath;
  const strokePath = solid ? centerlinePath : geometry.outlinePath;
  return (
    <g
      className={`stroke-object${isSelected ? " is-selected" : ""}`}
      data-stroke-object-id={object.id}
    >
      <path
        className="stroke-hit-area"
        d={centerlinePath}
        strokeWidth={Math.max(14, object.strokeWidth + 10)}
        style={{ strokeWidth: strokeHitWidthStyle(object.strokeWidth) }}
        onPointerDown={beginDrag}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={handleLostPointerCapture}
      />
      <path
        className="stroke-shape"
        data-simple={simple}
        d={strokePath}
        fill={solid ? "none" : object.color}
        stroke={solid ? object.color : "none"}
        style={simple ? { strokeWidth: simpleStrokeWidthStyle(object.strokeWidth, object.inputKind) } : undefined}
        strokeWidth={object.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
      />
    </g>
  );
});
