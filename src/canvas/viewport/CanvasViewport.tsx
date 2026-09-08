import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ObjectLayer } from "../layers/ObjectLayer";
import { SelectionLayer } from "../layers/SelectionLayer";
import {
  createCardObject,
  createTextObject,
} from "../objects/objectFactories";
import type { CanvasObjectType } from "../objects/types";
import { Toolbar } from "../../components/Toolbar/Toolbar";
import { ZoomControls } from "../../components/ZoomControls/ZoomControls";
import { useDocumentStore } from "../../store/documentStore";
import { useInteractionStore } from "../../store/interactionStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useUiStore } from "../../store/uiStore";
import { useViewportStore } from "../../store/viewportStore";
import {
  boundsIntersect,
  getObjectBounds,
  type Bounds,
} from "../../utils/geometry";
import {
  panViewport,
  screenToWorld,
  zoomViewportAtPoint,
  type Point,
  type Viewport,
} from "./viewportMath";

type PanInteraction = {
  pointerId: number;
  lastClientPoint: Point;
};

type MarqueeInteraction = {
  pointerId: number;
  startPoint: Point;
  currentPoint: Point;
  initialSelectedIds: Set<string>;
  liveSelectedIds: Set<string>;
  additive: boolean;
  moved: boolean;
};

const GRID_SIZE = 24;
const ZOOM_STEP = 1.2;

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

function normalizedWheelDelta(event: WheelEvent): Point {
  const scale =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? window.innerHeight
        : 1;

  return { x: event.deltaX * scale, y: event.deltaY * scale };
}

export function CanvasViewport() {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const marqueeOverlayRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport>(useViewportStore.getState().viewport);
  const frameRef = useRef<number | null>(null);
  const panRef = useRef<PanInteraction | null>(null);
  const marqueeRef = useRef<MarqueeInteraction | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const spacePressedRef = useRef(false);
  const suppressDoubleClickUntilRef = useRef(0);
  const [displayZoom, setDisplayZoom] = useState(viewportRef.current.zoom);
  const [isPanning, setIsPanning] = useState(false);
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const activeTool = useUiStore((state) => state.activeTool);
  const objectCount = useDocumentStore(
    (state) => Object.keys(state.objects).length,
  );

  const paintViewport = useCallback((viewport: Viewport) => {
    if (worldRef.current) {
      worldRef.current.style.transform = `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`;
    }

    if (gridRef.current) {
      const gridSize = GRID_SIZE * viewport.zoom;
      gridRef.current.style.backgroundPosition = `${viewport.x}px ${viewport.y}px`;
      gridRef.current.style.backgroundSize = `${gridSize}px ${gridSize}px`;
      gridRef.current.style.setProperty(
        "--grid-opacity",
        String(Math.min(1, Math.max(0.42, viewport.zoom))),
      );
    }
  }, []);

  const scheduleViewport = useCallback(
    (nextViewport: Viewport) => {
      viewportRef.current = nextViewport;

      if (frameRef.current !== null) return;

      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        paintViewport(viewportRef.current);
      });
    },
    [paintViewport],
  );

  const commitViewport = useCallback(() => {
    useViewportStore.getState().setViewport(viewportRef.current);
  }, []);

  const zoomAt = useCallback(
    (screenPoint: Point, requestedZoom: number) => {
      const next = zoomViewportAtPoint(
        viewportRef.current,
        screenPoint,
        requestedZoom,
      );
      scheduleViewport(next);
      setDisplayZoom(next.zoom);
      commitViewport();
    },
    [commitViewport, scheduleViewport],
  );

  const zoomAtCenter = useCallback(
    (factor: number) => {
      const element = surfaceRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      zoomAt(
        { x: rect.width / 2, y: rect.height / 2 },
        viewportRef.current.zoom * factor,
      );
    },
    [zoomAt],
  );

  const resetViewport = useCallback(() => {
    const element = surfaceRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const next = { x: rect.width / 2, y: rect.height / 2, zoom: 1 };

    scheduleViewport(next);
    setDisplayZoom(1);
    commitViewport();
  }, [commitViewport, scheduleViewport]);

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const previous = sizeRef.current;
      const isFirstMeasurement = previous.width === 0 && previous.height === 0;

      const next = isFirstMeasurement
        ? { x: width / 2, y: height / 2, zoom: viewportRef.current.zoom }
        : panViewport(viewportRef.current, {
            x: (width - previous.width) / 2,
            y: (height - previous.height) / 2,
          });

      sizeRef.current = { width, height };
      scheduleViewport(next);
      commitViewport();
    });

    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [commitViewport, scheduleViewport]);

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = normalizedWheelDelta(event);
      const rect = element.getBoundingClientRect();
      const isPinchGesture = event.ctrlKey || event.metaKey;

      if (isPinchGesture) {
        const factor = Math.exp(-delta.y * 0.006);
        zoomAt(
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          viewportRef.current.zoom * factor,
        );
        return;
      }

      const horizontalDelta = event.shiftKey && delta.x === 0 ? delta.y : delta.x;
      scheduleViewport(
        panViewport(viewportRef.current, {
          x: -horizontalDelta,
          y: event.shiftKey ? 0 : -delta.y,
        }),
      );
      commitViewport();
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [commitViewport, scheduleViewport, zoomAt]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;

      if (event.code === "Space") {
        event.preventDefault();
        spacePressedRef.current = true;
        setIsSpacePressed(true);
      }

      const shortcut = event.key.toLowerCase();
      if (shortcut === "v") useUiStore.getState().setActiveTool("select");
      if (shortcut === "h") useUiStore.getState().setActiveTool("hand");
      if (shortcut === "t") useUiStore.getState().setActiveTool("text");
      if (shortcut === "n") useUiStore.getState().setActiveTool("card");

      if (event.key === "Escape") {
        useUiStore.getState().setActiveTool("select");
        useSelectionStore.getState().clearSelection();
        useInteractionStore.getState().endInteraction();
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        const selection = useSelectionStore.getState();
        if (selection.selectedIds.size > 0) {
          event.preventDefault();
          useDocumentStore.getState().deleteObjects(selection.selectedIds);
          selection.clearSelection();
          useInteractionStore.getState().endInteraction();
        }
      }

      if (event.key === "0") {
        event.preventDefault();
        resetViewport();
      }

      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomAtCenter(ZOOM_STEP);
      }

      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomAtCenter(1 / ZOOM_STEP);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        spacePressedRef.current = false;
        setIsSpacePressed(false);
      }
    };

    const handleBlur = () => {
      spacePressedRef.current = false;
      setIsSpacePressed(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [resetViewport, zoomAtCenter]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const createObjectAt = (
    type: CanvasObjectType,
    clientPoint: Point,
    suppressFollowingDoubleClick = false,
  ) => {
    const element = surfaceRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const worldPoint = screenToWorld(
      { x: clientPoint.x - rect.left, y: clientPoint.y - rect.top },
      viewportRef.current,
    );
    const documentStore = useDocumentStore.getState();
    const object =
      type === "text"
        ? createTextObject(worldPoint, documentStore.getNextZIndex())
        : createCardObject(worldPoint, documentStore.getNextZIndex());

    documentStore.addObject(object);
    useSelectionStore.getState().selectOnly(object.id);
    useInteractionStore
      .getState()
      .beginInteraction("editingText", object.id);
    useUiStore.getState().setActiveTool("select");

    if (suppressFollowingDoubleClick) {
      suppressDoubleClickUntilRef.current = performance.now() + 450;
    }
  };

  const clearTransientSelectionStyles = () => {
    surfaceRef.current
      ?.querySelectorAll<HTMLElement>("[data-transient-selected]")
      .forEach((element) => element.removeAttribute("data-transient-selected"));
  };

  const paintMarquee = (interaction: MarqueeInteraction) => {
    const left = Math.min(interaction.startPoint.x, interaction.currentPoint.x);
    const top = Math.min(interaction.startPoint.y, interaction.currentPoint.y);
    const right = Math.max(interaction.startPoint.x, interaction.currentPoint.x);
    const bottom = Math.max(interaction.startPoint.y, interaction.currentPoint.y);

    if (marqueeOverlayRef.current) {
      marqueeOverlayRef.current.style.display = "block";
      marqueeOverlayRef.current.style.width = `${right - left}px`;
      marqueeOverlayRef.current.style.height = `${bottom - top}px`;
      marqueeOverlayRef.current.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    }

    const topLeft = screenToWorld({ x: left, y: top }, viewportRef.current);
    const bottomRight = screenToWorld(
      { x: right, y: bottom },
      viewportRef.current,
    );
    const marqueeBounds: Bounds = {
      left: topLeft.x,
      top: topLeft.y,
      right: bottomRight.x,
      bottom: bottomRight.y,
    };
    const hitIds = Object.values(useDocumentStore.getState().objects)
      .filter((object) =>
        boundsIntersect(marqueeBounds, getObjectBounds(object)),
      )
      .map((object) => object.id);
    const nextSelection = interaction.additive
      ? new Set([...interaction.initialSelectedIds, ...hitIds])
      : new Set(hitIds);

    interaction.liveSelectedIds = nextSelection;
    surfaceRef.current
      ?.querySelectorAll<HTMLElement>("[data-object-id]")
      .forEach((element) => {
        const id = element.dataset.objectId;
        element.dataset.transientSelected = String(
          id !== undefined && nextSelection.has(id),
        );
      });
  };

  const beginMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const initialSelectedIds = new Set(
      useSelectionStore.getState().selectedIds,
    );

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    marqueeRef.current = {
      pointerId: event.pointerId,
      startPoint: point,
      currentPoint: point,
      initialSelectedIds,
      liveSelectedIds: new Set(initialSelectedIds),
      additive: event.shiftKey,
      moved: false,
    };
    setIsMarqueeSelecting(true);
    useInteractionStore.getState().beginInteraction("marquee");
  };

  const beginSurfaceInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const isPrimaryButton = event.button === 0;
    const isMiddleButton = event.button === 1;
    if (!isPrimaryButton && !isMiddleButton) return;

    if (
      isPrimaryButton &&
      useInteractionStore.getState().mode === "editingText"
    ) {
      useSelectionStore.getState().clearSelection();
      return;
    }

    const shouldForcePan = isMiddleButton || spacePressedRef.current;
    if (
      isPrimaryButton &&
      !shouldForcePan &&
      (activeTool === "text" || activeTool === "card")
    ) {
      event.preventDefault();
      createObjectAt(activeTool, { x: event.clientX, y: event.clientY }, true);
      return;
    }

    if (!shouldForcePan && activeTool !== "hand" && activeTool !== "select") {
      return;
    }

    if (activeTool === "select" && !shouldForcePan) {
      beginMarquee(event);
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      lastClientPoint: { x: event.clientX, y: event.clientY },
    };
    setIsPanning(true);
    useInteractionStore.getState().beginInteraction("panning");
  };

  const continueSurfaceInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const marquee = marqueeRef.current;
    if (marquee?.pointerId === event.pointerId) {
      const element = surfaceRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      marquee.currentPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const distance = Math.hypot(
        marquee.currentPoint.x - marquee.startPoint.x,
        marquee.currentPoint.y - marquee.startPoint.y,
      );
      if (distance >= 3) {
        marquee.moved = true;
        paintMarquee(marquee);
      }
      return;
    }

    const interaction = panRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;

    const point = { x: event.clientX, y: event.clientY };
    const delta = {
      x: point.x - interaction.lastClientPoint.x,
      y: point.y - interaction.lastClientPoint.y,
    };
    interaction.lastClientPoint = point;
    scheduleViewport(panViewport(viewportRef.current, delta));
  };

  const endSurfaceInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const marquee = marqueeRef.current;
    if (marquee?.pointerId === event.pointerId) {
      marqueeRef.current = null;
      const wasCancelled = event.type === "pointercancel";
      if (wasCancelled) {
        useSelectionStore.getState().setSelection(marquee.initialSelectedIds);
      } else if (marquee.moved) {
        useSelectionStore.getState().setSelection(marquee.liveSelectedIds);
        suppressDoubleClickUntilRef.current = performance.now() + 450;
      } else if (!marquee.additive) {
        useSelectionStore.getState().clearSelection();
      }

      clearTransientSelectionStyles();
      if (marqueeOverlayRef.current) {
        marqueeOverlayRef.current.style.display = "none";
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setIsMarqueeSelecting(false);
      useInteractionStore.getState().endInteraction();
      return;
    }

    const interaction = panRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;

    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
    commitViewport();
    useInteractionStore.getState().endInteraction();
  };

  const handleLostPointerCapture = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const marquee = marqueeRef.current;
    if (marquee?.pointerId === event.pointerId) {
      marqueeRef.current = null;
      useSelectionStore.getState().setSelection(marquee.initialSelectedIds);
      clearTransientSelectionStyles();
      if (marqueeOverlayRef.current) {
        marqueeOverlayRef.current.style.display = "none";
      }
      setIsMarqueeSelecting(false);
      useInteractionStore.getState().endInteraction();
      return;
    }

    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setIsPanning(false);
    commitViewport();
    useInteractionStore.getState().endInteraction();
  };

  const handleSurfaceDoubleClick = (
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    if (performance.now() < suppressDoubleClickUntilRef.current) return;
    createObjectAt("card", { x: event.clientX, y: event.clientY });
  };

  return (
    <section
      ref={surfaceRef}
      className="canvas-viewport"
      data-panning={isPanning ? "true" : "false"}
      data-space-pressed={isSpacePressed ? "true" : "false"}
      data-marquee-selecting={isMarqueeSelecting ? "true" : "false"}
      data-active-tool={activeTool}
      aria-label="Infinite canvas"
      onPointerDown={beginSurfaceInteraction}
      onPointerMove={continueSurfaceInteraction}
      onPointerUp={endSurfaceInteraction}
      onPointerCancel={endSurfaceInteraction}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleSurfaceDoubleClick}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div ref={gridRef} className="grid-layer" aria-hidden="true" />

      <div ref={worldRef} className="world-layer">
        <span className="world-origin-dot" aria-hidden="true" />
        <ObjectLayer />
        <SelectionLayer />
      </div>

      <div
        ref={marqueeOverlayRef}
        className="marquee-selection"
        aria-hidden="true"
      />

      {objectCount === 0 && (
        <div className="empty-prompt" aria-hidden="true">
          <span className="empty-prompt-icon">+</span>
          <div>
            <strong>Add your first idea</strong>
            <span>Double-click anywhere to create a note</span>
          </div>
        </div>
      )}

      <header className="brand-mark" onPointerDown={(event) => event.stopPropagation()}>
        <span className="brand-symbol" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span>The Canvas</span>
      </header>

      <div onPointerDown={(event) => event.stopPropagation()}>
        <Toolbar />
      </div>

      <aside className="canvas-hint" aria-label="Canvas navigation help">
        <span><strong>Drag empty space</strong> to select</span>
        <i aria-hidden="true" />
        <span><strong>Shift-click</strong> to add or remove</span>
        <i aria-hidden="true" />
        <span><strong>Space-drag</strong> to pan</span>
      </aside>

      <div
        className="zoom-dock"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ZoomControls
          zoom={displayZoom}
          onZoomIn={() => zoomAtCenter(ZOOM_STEP)}
          onZoomOut={() => zoomAtCenter(1 / ZOOM_STEP)}
          onReset={resetViewport}
        />
      </div>
    </section>
  );
}
