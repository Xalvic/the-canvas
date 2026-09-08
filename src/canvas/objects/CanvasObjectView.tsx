import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useDocumentStore } from "../../store/documentStore";
import { useInteractionStore } from "../../store/interactionStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useUiStore } from "../../store/uiStore";
import { useViewportStore } from "../../store/viewportStore";
import { CardObject } from "./CardObject";
import { TextObject } from "./TextObject";
import type { CanvasObject } from "./types";
import type { Point } from "../viewport/viewportMath";

type CanvasObjectViewProps = {
  object: CanvasObject;
};

type DragInteraction = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPositions: Record<string, Point>;
  nextPositions: Record<string, Point>;
  elements: Map<string, HTMLElement>;
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
  const activeTool = useUiStore((state) => state.activeTool);
  const isSelected = useSelectionStore((state) =>
    state.selectedIds.has(object.id),
  );
  const isSoleSelection = useSelectionStore(
    (state) => state.selectedIds.size === 1 && state.selectedIds.has(object.id),
  );
  const isEditing = useInteractionStore(
    (state) => state.mode === "editingText" && state.objectId === object.id,
  );
  const selectOnly = useSelectionStore((state) => state.selectOnly);
  const toggleSelection = useSelectionStore((state) => state.toggleSelection);
  const updateObject = useDocumentStore((state) => state.updateObject);
  const updateObjectPositions = useDocumentStore(
    (state) => state.updateObjectPositions,
  );
  const beginInteraction = useInteractionStore(
    (state) => state.beginInteraction,
  );
  const endInteraction = useInteractionStore((state) => state.endInteraction);

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const isSpacePressed =
      event.currentTarget.closest<HTMLElement>(".canvas-viewport")?.dataset
        .spacePressed === "true";
    if (event.button !== 0 || activeTool === "hand" || isSpacePressed) return;

    event.stopPropagation();
    if (activeTool !== "select" || isEditing) return;

    event.preventDefault();
    if (event.shiftKey) {
      toggleSelection(object.id);
      return;
    }

    const selection = useSelectionStore.getState().selectedIds;
    const movingIds = selection.has(object.id) ? [...selection] : [object.id];
    if (!selection.has(object.id)) selectOnly(object.id);

    const documentObjects = useDocumentStore.getState().objects;
    const startPositions: Record<string, Point> = {};
    for (const id of movingIds) {
      const movingObject = documentObjects[id];
      if (movingObject) {
        startPositions[id] = { x: movingObject.x, y: movingObject.y };
      }
    }

    const elements = new Map<string, HTMLElement>();
    document
      .querySelectorAll<HTMLElement>("[data-object-id]")
      .forEach((element) => {
        const id = element.dataset.objectId;
        if (id && id in startPositions) elements.set(id, element);
      });

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPositions,
      nextPositions: { ...startPositions },
      elements,
    };
    beginInteraction("dragging", object.id);
  };

  const continueInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId === event.pointerId) {
      const zoom = useViewportStore.getState().viewport.zoom;
      const deltaX = (event.clientX - drag.startClientX) / zoom;
      const deltaY = (event.clientY - drag.startClientY) / zoom;

      for (const [id, start] of Object.entries(drag.startPositions)) {
        const next = { x: start.x + deltaX, y: start.y + deltaY };
        drag.nextPositions[id] = next;
        const element = drag.elements.get(id);
        if (element) {
          element.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
        }
      }
      return;
    }

    const resize = resizeRef.current;
    if (resize?.pointerId === event.pointerId && elementRef.current) {
      const zoom = useViewportStore.getState().viewport.zoom;
      const minWidth = object.type === "text" ? MIN_TEXT_WIDTH : MIN_CARD_WIDTH;
      resize.nextWidth = Math.max(
        minWidth,
        resize.startWidth + (event.clientX - resize.startClientX) / zoom,
      );
      resize.nextHeight =
        object.type === "text"
          ? object.height
          : Math.max(
              MIN_CARD_HEIGHT,
              resize.startHeight + (event.clientY - resize.startClientY) / zoom,
            );
      elementRef.current.style.width = `${resize.nextWidth}px`;
      elementRef.current.style.height = `${resize.nextHeight}px`;
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
      updateObjectPositions(drag.nextPositions);
    } else if (resize) {
      updateObject(object.id, {
        width: resize.nextWidth,
        height: resize.nextHeight,
      });
    }
    endInteraction();
  };

  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
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
    if (activeTool !== "select") return;
    event.preventDefault();
    event.stopPropagation();
    selectOnly(object.id);
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
        transform: `translate3d(${object.x}px, ${object.y}px, 0)`,
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
      ) : (
        <CardObject object={object} isEditing={isEditing} />
      )}

      {isSoleSelection && !isEditing && (
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
