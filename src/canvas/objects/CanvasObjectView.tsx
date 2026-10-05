import {
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
import { CardObject } from "./CardObject";
import { FrameObject } from "./FrameObject";
import { ImageObject } from "./ImageObject";
import { TextObject } from "./TextObject";
import {
  isCanvasSpatialObject,
  isCanvasNodeObject,
  type CanvasDomObject,
} from "./types";
import type { Point } from "../viewport/viewportMath";
import { CANCEL_TOUCH_INTERACTIONS_EVENT } from "../viewport/pointerInteractionEvents";
import { ConnectionAnchors } from "../connectors/ConnectionAnchors";
import { refreshConnectorGeometryFromDom } from "../connectors/connectorDom";
import {
  expandIdsToGroups,
  getMovementIds,
  toggleObjectOrGroup,
} from "../groups/grouping";
import {
  MIN_FRAME_HEIGHT,
  MIN_FRAME_WIDTH,
} from "./objectFactories";
import {
  clearMovementTransforms,
  collectMovementElements,
  paintMovementElements,
  type MovementElement,
} from "./transientMovement";
import {
  getProportionalImageSize,
  MIN_IMAGE_SIZE,
} from "./imageGeometry";

type CanvasObjectViewProps = {
  object: CanvasDomObject;
};

type DragInteraction = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPositions: Record<string, Point>;
  nextPositions: Record<string, Point>;
  elements: Map<string, MovementElement>;
};

type ResizeInteraction = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startWidth: number;
  startHeight: number;
  nextWidth: number;
  nextHeight: number;
};

const MIN_CARD_WIDTH = 188;
const MIN_CARD_HEIGHT = 128;
const MIN_TEXT_WIDTH = 96;

export function CanvasObjectView({ object }: CanvasObjectViewProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragInteraction | null>(null);
  const resizeRef = useRef<ResizeInteraction | null>(null);
  const readOnly = useBoardStore((state) => state.readOnly);
  const activeTool = useUiStore((state) => state.activeTool);
  const isMultiSelectMode = useUiStore((state) => state.isMultiSelectMode);
  const isSelected = useSelectionStore((state) =>
    state.selectedIds.has(object.id),
  );
  const isSoleSelection = useSelectionStore(
    (state) => state.selectedIds.size === 1 && state.selectedIds.has(object.id),
  );
  const isEditing = useInteractionStore(
    (state) => state.mode === "editingText" && state.objectId === object.id,
  );
  const setSelection = useSelectionStore((state) => state.setSelection);
  const updateObject = useDocumentStore((state) => state.updateObject);
  const updateObjectPositions = useDocumentStore(
    (state) => state.updateObjectPositions,
  );
  const beginInteraction = useInteractionStore(
    (state) => state.beginInteraction,
  );
  const endInteraction = useInteractionStore((state) => state.endInteraction);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest("[data-connection-anchor]")
    ) {
      return;
    }
    const isSpacePressed =
      event.currentTarget.closest<HTMLElement>(".canvas-viewport")?.dataset
        .spacePressed === "true";
    if (event.button !== 0 || activeTool === "hand" || isSpacePressed) return;
    if (activeTool === "pen") return;

    event.stopPropagation();
    if (activeTool !== "select" || isEditing) return;

    event.preventDefault();
    if (event.shiftKey || isMultiSelectMode) {
      setSelection(
        toggleObjectOrGroup(
          useSelectionStore.getState().selectedIds,
          object.id,
          useDocumentStore.getState().objects,
        ),
      );
      return;
    }

    const selection = useSelectionStore.getState().selectedIds;
    const documentObjects = useDocumentStore.getState().objects;
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
      const resize = resizeRef.current;
      dragRef.current = null;
      resizeRef.current = null;
      if (drag) clearMovementTransforms(drag.elements);
      if (resize && elementRef.current) {
        elementRef.current.style.width = `${object.width}px`;
        elementRef.current.style.height = `${object.height}px`;
      }
      const pointerId = drag?.pointerId ?? resize?.pointerId;
      if (
        pointerId !== undefined &&
        elementRef.current?.hasPointerCapture(pointerId)
      ) {
        elementRef.current.releasePointerCapture(pointerId);
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
  }, [object.height, object.width]);

  const continueInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      const zoom = useViewportStore.getState().viewport.zoom;
      const deltaX = (event.clientX - drag.startClientX) / zoom;
      const deltaY = (event.clientY - drag.startClientY) / zoom;

      for (const [id, start] of Object.entries(drag.startPositions)) {
        const next = { x: start.x + deltaX, y: start.y + deltaY };
        drag.nextPositions[id] = next;
      }
      paintMovementElements(
        drag.startPositions,
        drag.nextPositions,
        drag.elements,
      );
      refreshConnectorGeometryFromDom(useDocumentStore.getState().objects);
      return;
    }

    const resize = resizeRef.current;
    if (resize?.pointerId === event.pointerId && elementRef.current) {
      const zoom = useViewportStore.getState().viewport.zoom;
      const deltaX = (event.clientX - resize.startClientX) / zoom;
      const deltaY = (event.clientY - resize.startClientY) / zoom;

      if (object.type === "image" && !event.shiftKey) {
        const size = getProportionalImageSize(
          resize.startWidth,
          resize.startHeight,
          deltaX,
          deltaY,
        );
        resize.nextWidth = size.width;
        resize.nextHeight = size.height;
        elementRef.current.style.width = `${resize.nextWidth}px`;
        elementRef.current.style.height = `${resize.nextHeight}px`;
        return;
      }

      const minWidth =
        object.type === "text"
          ? MIN_TEXT_WIDTH
          : object.type === "image"
            ? MIN_IMAGE_SIZE
            : object.type === "frame"
              ? MIN_FRAME_WIDTH
              : MIN_CARD_WIDTH;
      resize.nextWidth = Math.max(
        minWidth,
        resize.startWidth + deltaX,
      );
      resize.nextHeight =
        object.type === "text"
          ? object.height
          : Math.max(
              object.type === "image"
                ? MIN_IMAGE_SIZE
                : object.type === "frame"
                  ? MIN_FRAME_HEIGHT
                  : MIN_CARD_HEIGHT,
              resize.startHeight + deltaY,
            );
      elementRef.current.style.width = `${resize.nextWidth}px`;
      elementRef.current.style.height = `${resize.nextHeight}px`;
      refreshConnectorGeometryFromDom(useDocumentStore.getState().objects);
    }
  };

  const endPointerInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const drag = dragRef.current;
    const resize = resizeRef.current;
    if (
      drag?.pointerId !== event.pointerId &&
      resize?.pointerId !== event.pointerId
    ) {
      return;
    }

    dragRef.current = null;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag) {
      clearMovementTransforms(drag.elements);
      updateObjectPositions(drag.nextPositions);
    } else if (resize) {
      updateObject(object.id, {
        width: resize.nextWidth,
        height: resize.nextHeight,
      }, `Resize ${object.type === "card" ? "note" : object.type}`);
    }
    endInteraction();
  };

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || useBoardStore.getState().readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.parentElement?.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: object.width,
      startHeight: object.height,
      nextWidth: object.width,
      nextHeight: object.height,
    };
    beginInteraction("resizing", object.id);
  };

  const beginEditing = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (useBoardStore.getState().readOnly || activeTool !== "select" || object.type === "image") return;
    event.preventDefault();
    event.stopPropagation();
    const objects = useDocumentStore.getState().objects;
    setSelection(expandIdsToGroups([object.id], objects));
    beginInteraction("editingText", object.id);
  };

  const handleLostPointerCapture = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (
      dragRef.current?.pointerId !== event.pointerId &&
      resizeRef.current?.pointerId !== event.pointerId
    ) {
      return;
    }
    endPointerInteraction(event);
  };

  return (
    <div
      ref={elementRef}
      className={`canvas-object canvas-object--${object.type}${isSelected ? " is-selected" : ""}${isEditing ? " is-editing" : ""}`}
      style={{
        width: object.width,
        height: object.height,
        zIndex: object.zIndex,
        left: object.x,
        top: object.y,
      }}
      data-object-id={object.id}
      onPointerDown={beginDrag}
      onPointerMove={continueInteraction}
      onPointerUp={endPointerInteraction}
      onPointerCancel={endPointerInteraction}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={beginEditing}
    >
      {object.type === "text" ? (
        <TextObject object={object} isEditing={isEditing} />
      ) : object.type === "image" ? (
        <ImageObject object={object} />
      ) : object.type === "frame" ? (
        <FrameObject object={object} isEditing={isEditing} />
      ) : (
        <CardObject object={object} isEditing={isEditing} />
      )}

      {!readOnly && isCanvasNodeObject(object) && <ConnectionAnchors objectId={object.id} />}

      {!readOnly && activeTool === "select" && isSoleSelection && !isEditing && (
        <button
          className={`resize-handle resize-handle--${object.type === "text" ? "east" : "corner"}`}
          type="button"
          aria-label={`Resize ${object.type}`}
          onPointerDown={beginResize}
          tabIndex={-1}
        />
      )}
    </div>
  );
}
