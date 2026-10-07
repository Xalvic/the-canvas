import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ObjectLayer } from "../layers/ObjectLayer";
import { FrameLayer } from "../layers/FrameLayer";
import { StrokeLayer } from "../layers/StrokeLayer";
import { SelectionLayer } from "../layers/SelectionLayer";
import { ConnectorLayer } from "../layers/ConnectorLayer";
import { createConnectorObject } from "../connectors/connectorFactories";
import {
  buildConnectorPath,
  getAnchorPoint,
  getEndpointPoint,
  inferAnchorToward,
} from "../connectors/connectorGeometry";
import {
  createCardObject,
  createFrameObject,
  createTextObject,
  DEFAULT_FRAME_HEIGHT,
  DEFAULT_FRAME_WIDTH,
} from "../objects/objectFactories";
import {
  isFrameObject,
  isConnectorObject,
  type ConnectionAnchor,
  type ConnectionEndpoint,
} from "../objects/types";
import {
  groupSelection,
  ungroupSelection,
} from "../groups/groupCommands";
import { expandIdsToGroups } from "../groups/grouping";
import { createStrokeObject } from "../strokes/strokeFactories";
import { getStrokeGeometry } from "../strokes/strokeRenderer";
import { chooseStrokeDetail, simpleStrokeWidthStyle, strokeZoomBucket } from "../strokes/strokePresentation";
import { updateStrokeRenderWindow, type StrokeRenderWindow } from "../strokes/strokeVisibility";
import { createInkDynamics, strokeInputKind, type InkDynamics } from "../strokes/strokeDynamics";
import { appendInkSample, getConfirmedPointerSamples, isProvisionalTouch, trackStrokeTravel, type StrokeContact } from "../strokes/strokeInput";
import { PEN_WIDTHS, type PenToolSettings } from "../../tools/toolSettings";
import { useToolPreferencesStore } from "../../store/toolPreferencesStore";
import type { StrokePoint } from "../objects/types";
import { Toolbar } from "../../components/Toolbar/Toolbar";
import { ZoomControls } from "../../components/ZoomControls/ZoomControls";
import {
  createImportedImageObject,
  getClipboardImageFiles,
  getDroppedFiles,
  prepareImageAsset,
} from "../../assets/imageImport";
import {
  copySelection,
  duplicateSelection,
  pasteClipboard,
} from "../../clipboard/clipboardCommands";
import { performRedo, performUndo } from "../../history/historyCommands";
import { useDocumentStore } from "../../store/documentStore";
import { useInteractionStore } from "../../store/interactionStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useUiStore } from "../../store/uiStore";
import { useViewportStore } from "../../store/viewportStore";
import { useBoardStore } from "../../store/boardStore";
import { useClipboardStore } from "../../store/clipboardStore";
import {
  boundsIntersect,
  getNodeObjects,
  getObjectBounds,
  type Bounds,
} from "../../utils/geometry";
import {
  panViewport,
  screenToWorld,
  worldToScreen,
  zoomViewportAtPoint,
  type Point,
  type Viewport,
} from "./viewportMath";
import { CANCEL_TOUCH_INTERACTIONS_EVENT, COMMIT_CANVAS_INTERACTIONS_EVENT, REQUEST_GUEST_EDIT_EVENT } from "./pointerInteractionEvents";

type PanInteraction = {
  pointerId: number;
  lastClientPoint: Point;
  startClientPoint: Point;
  moved: boolean;
  clearSelectionOnTap: boolean;
};

type PinchInteraction = {
  pointerIds: [number, number];
  lastMidpoint: Point;
  lastDistance: number;
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

type ConnectorInteraction = {
  pointerId: number;
  connectorId: string | null;
  movingEnd: "from" | "to";
  fixedEndpoint: ConnectionEndpoint;
  currentPoint: Point;
  candidate: ConnectionEndpoint | null;
};

type FrameCreationInteraction = {
  pointerId: number;
  startPoint: Point;
  currentPoint: Point;
  moved: boolean;
};

type StrokeInteraction = StrokeContact & {
  pointerId: number;
  pointerType: string;
  dynamics: InkDynamics;
  settings: PenToolSettings;
  points: StrokePoint[];
  simple: boolean;
};

const GRID_SIZE = 24;
const ZOOM_STEP = 1.2;
const MULTI_IMAGE_OFFSET = 24;
const CONNECTION_ANCHORS: ConnectionAnchor[] = [
  "top",
  "right",
  "bottom",
  "left",
];

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

function isChromeTarget(target: EventTarget | null): boolean {
  return !!document.querySelector("dialog[open]") || target instanceof Element &&
    !!target.closest(".board-header, .page-sidebar, .toolbar-area, .tool-options, .mobile-selection-actions, .zoom-dock");
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
  const connectorDraftRef = useRef<SVGPathElement>(null);
  const strokeDraftRef = useRef<SVGPathElement>(null);
  const frameDraftRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport>(useViewportStore.getState().viewport);
  const frameRef = useRef<number | null>(null);
  const panRef = useRef<PanInteraction | null>(null);
  const touchPointsRef = useRef(new Map<number, Point>());
  const ignoredContactsRef = useRef(new Set<number>());
  const pinchRef = useRef<PinchInteraction | null>(null);
  const marqueeRef = useRef<MarqueeInteraction | null>(null);
  const connectorRef = useRef<ConnectorInteraction | null>(null);
  const frameCreationRef = useRef<FrameCreationInteraction | null>(null);
  const strokeRef = useRef<StrokeInteraction | null>(null);
  const strokePaintRef = useRef<number | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const spacePressedRef = useRef(false);
  const suppressDoubleClickUntilRef = useRef(0);
  const pointerLocationRef = useRef<{
    clientPoint: Point;
    isOverCanvas: boolean;
  } | null>(null);
  const dragDepthRef = useRef(0);
  const noticeTimerRef = useRef<number | null>(null);
  const [displayZoom, setDisplayZoom] = useState(viewportRef.current.zoom);
  const [strokeZoom, setStrokeZoom] = useState(strokeZoomBucket(viewportRef.current.zoom));
  const [strokeWindow, setStrokeWindow] = useState<StrokeRenderWindow | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isPinching, setIsPinching] = useState(false);
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCreatingFrame, setIsCreatingFrame] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isImageDragOver, setIsImageDragOver] = useState(false);
  const [canvasNotice, setCanvasNotice] = useState<string | null>(null);
  const readOnly = useBoardStore((state) => state.readOnly);
  const selectedTool = useUiStore((state) => state.activeTool);
  const activeTool = readOnly && selectedTool !== "select" && selectedTool !== "hand" ? "select" : selectedTool;
  const isEditingText = useInteractionStore(
    (state) => state.mode === "editingText",
  );
  const isBoardHydrated = useBoardStore((state) => state.isHydrated);
  const objects = useDocumentStore((state) => state.objects);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const objectCount = Object.keys(objects).length;
  const selectedCount = selectedIds.size;
  const selectedConnectorIds = [...selectedIds].filter((id) => {
    const object = objects[id];
    return object !== undefined && isConnectorObject(object);
  });
  const selectedFrameIds = [...selectedIds].filter((id) => {
    const object = objects[id];
    return object !== undefined && isFrameObject(object);
  });
  const selectedStrokeIds = [...selectedIds].filter(
    (id) => objects[id]?.type === "stroke",
  );

  const showCanvasNotice = useCallback((message: string) => {
    setCanvasNotice(message);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setCanvasNotice(null);
    }, 4200);
  }, []);

  const getImageInsertionPoint = useCallback((clientPoint?: Point): Point | null => {
    const element = surfaceRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const recentPointer = pointerLocationRef.current;
    const target = clientPoint ?? (
      recentPointer?.isOverCanvas
        ? recentPointer.clientPoint
        : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    );
    return screenToWorld(
      { x: target.x - rect.left, y: target.y - rect.top },
      viewportRef.current,
    );
  }, []);

  const insertImageFiles = useCallback(async (
    files: File[],
    source: "paste" | "drop",
    clientPoint?: Point,
  ) => {
    if (useBoardStore.getState().readOnly || files.length === 0) return;
    const insertionSession = useBoardStore.getState().sessionVersion;
    const insertionPoint = getImageInsertionPoint(clientPoint);
    if (!insertionPoint) return;

    const results = await Promise.allSettled(files.map(prepareImageAsset));
    const imported = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );

    if (imported.length > 0 && !useBoardStore.getState().readOnly && useBoardStore.getState().sessionVersion === insertionSession) {
      const documentStore = useDocumentStore.getState();
      const firstZIndex = documentStore.getNextZIndex();
      const imageObjects = imported.map((asset, index) =>
        createImportedImageObject(
          asset,
          {
            x: insertionPoint.x + index * MULTI_IMAGE_OFFSET,
            y: insertionPoint.y + index * MULTI_IMAGE_OFFSET,
          },
          firstZIndex + index,
        ),
      );
      documentStore.addObjects(
        imageObjects,
        source === "drop"
          ? imported.length === 1 ? "Drop image" : "Drop images"
          : imported.length === 1 ? "Paste image" : "Paste images",
      );
      useSelectionStore.getState().setSelection(
        imageObjects.map((object) => object.id),
      );
      useInteractionStore.getState().endInteraction();
      useUiStore.getState().setActiveTool("select");
    }

    if (failures.length > 0) {
      const firstFailure = failures[0];
      const message = firstFailure instanceof Error
        ? firstFailure.message
        : "One or more images could not be added";
      showCanvasNotice(
        failures.length === 1
          ? message
          : `${message} (${failures.length} files skipped)`,
      );
    }
  }, [getImageInsertionPoint, showCanvasNotice]);

  useEffect(
    () => () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    },
    [],
  );
  const selectedGroupIds = new Set(
    [...selectedIds]
      .map((id) => objects[id]?.groupId)
      .filter((groupId): groupId is string => groupId !== undefined),
  );

  const clearConnectorPreview = useCallback(() => {
    connectorRef.current = null;
    if (connectorDraftRef.current) {
      connectorDraftRef.current.style.display = "none";
      connectorDraftRef.current.removeAttribute("d");
    }
    surfaceRef.current
      ?.querySelectorAll(".connection-anchor.is-target")
      .forEach((element) => element.classList.remove("is-target"));
    setIsConnecting(false);
  }, []);

  const clearFramePreview = useCallback(() => {
    frameCreationRef.current = null;
    if (frameDraftRef.current) frameDraftRef.current.style.display = "none";
    setIsCreatingFrame(false);
  }, []);

  const clearStrokePreview = useCallback(() => {
    if (strokePaintRef.current !== null) {
      cancelAnimationFrame(strokePaintRef.current);
      strokePaintRef.current = null;
    }
    strokeRef.current = null;
    if (strokeDraftRef.current) {
      strokeDraftRef.current.style.display = "none";
      strokeDraftRef.current.removeAttribute("d");
    }
    setIsDrawing(false);
  }, []);

  const settleStroke = useCallback((preserve: boolean) => {
    const stroke = strokeRef.current;
    if (!stroke) return;
    // Finalize before releasing capture: lost capture can be dispatched again.
    clearStrokePreview();
    touchPointsRef.current.delete(stroke.pointerId);
    const surface = surfaceRef.current;
    if (surface?.hasPointerCapture(stroke.pointerId)) surface.releasePointerCapture(stroke.pointerId);
    if (preserve && stroke.points.length && !useBoardStore.getState().readOnly) {
      const store = useDocumentStore.getState();
      store.addObject(createStrokeObject([...stroke.points], store.getNextZIndex(), stroke.settings, strokeInputKind(stroke.pointerType)));
      suppressDoubleClickUntilRef.current = performance.now() + 450;
    }
    useInteractionStore.getState().endInteraction();
  }, [clearStrokePreview]);

  useEffect(() => {
    if (!import.meta.env.DEV || !surfaceRef.current) return;
    let cleanup: (() => void) | undefined;
    let mounted = true;
    void import("../strokes/penDiagnostics").then(({ installPenDiagnostics }) => {
      if (mounted && surfaceRef.current) cleanup = installPenDiagnostics(surfaceRef.current, () => ({
        owner: strokeRef.current?.pointerId ?? null,
        contacts: touchPointsRef.current.size, pinching: pinchRef.current !== null,
      }));
    });
    return () => { mounted = false; cleanup?.(); };
  }, []);

  useEffect(() => {
    const interrupt = () => {
      settleStroke(true);
      if (pinchRef.current || panRef.current) useViewportStore.getState().setViewport(viewportRef.current);
      touchPointsRef.current.clear();
      ignoredContactsRef.current.clear();
      pinchRef.current = null;
      panRef.current = null;
      setIsPinching(false);
      setIsPanning(false);
    };
    const visibility = () => { if (document.hidden) interrupt(); };
    window.addEventListener("blur", interrupt);
    window.addEventListener(COMMIT_CANVAS_INTERACTIONS_EVENT, interrupt);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", interrupt);
      window.removeEventListener(COMMIT_CANVAS_INTERACTIONS_EVENT, interrupt);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [settleStroke]);

  useEffect(() => {
    if (activeTool !== "pen" || readOnly) settleStroke(false);
  }, [activeTool, readOnly, settleStroke]);

  useEffect(() => useBoardStore.subscribe((state, previous) => {
    if (state.sessionVersion !== previous.sessionVersion) {
      settleStroke(false);
      touchPointsRef.current.clear();
      ignoredContactsRef.current.clear();
    }
  }), [settleStroke]);

  const paintViewport = useCallback((viewport: Viewport) => {
    if (worldRef.current) {
      worldRef.current.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
      worldRef.current.style.setProperty("--stroke-zoom", String(viewport.zoom));
    }
    setStrokeZoom(strokeZoomBucket(viewport.zoom));
    setStrokeWindow((previous) => updateStrokeRenderWindow(previous, viewport, sizeRef.current));

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
      if (strokeRef.current) return;
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
    if (strokeRef.current) return;
    const element = surfaceRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const next = { x: rect.width / 2, y: rect.height / 2, zoom: 1 };

    scheduleViewport(next);
    setDisplayZoom(1);
    commitViewport();
  }, [commitViewport, scheduleViewport]);

  useEffect(() => {
    return useViewportStore.subscribe((state, previous) => {
      if (state.viewport === previous.viewport) return;
      viewportRef.current = state.viewport;
      setDisplayZoom(state.viewport.zoom);
      paintViewport(state.viewport);
    });
  }, [paintViewport]);

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const previous = sizeRef.current;
      if (strokeRef.current) {
        sizeRef.current = { width, height };
        return;
      }
      const isFirstMeasurement = previous.width === 0 && previous.height === 0;
      const hasSavedViewport = useBoardStore.getState().hasSavedViewport;

      const next = isFirstMeasurement
        ? hasSavedViewport
          ? viewportRef.current
          : { x: width / 2, y: height / 2, zoom: viewportRef.current.zoom }
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
      if (strokeRef.current) return;
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
      const commandKey = event.ctrlKey || event.metaKey;
      const shortcut = event.key.toLowerCase();
      if (document.querySelector("dialog[open]") || isTypingTarget(event.target)) return;
      const editingShortcut = commandKey
        ? ["g", "z", "y", "d"].includes(shortcut)
        : ["a", "m", "n", "t", "c", "f", "p", "delete", "backspace"].includes(shortcut);
      if (useBoardStore.getState().readOnly && editingShortcut) {
        event.preventDefault();
        return;
      }

      if (commandKey && !event.altKey) {
        if (shortcut === "g") {
          event.preventDefault();
          if (event.shiftKey) ungroupSelection();
          else groupSelection();
          return;
        }
        if (shortcut === "z") {
          event.preventDefault();
          if (event.shiftKey) performRedo();
          else performUndo();
          return;
        }
        if (shortcut === "y") {
          event.preventDefault();
          performRedo();
          return;
        }
        if (shortcut === "c") {
          return;
        }
        if (shortcut === "v") {
          return;
        }
        if (shortcut === "d") {
          event.preventDefault();
          duplicateSelection();
          return;
        }
      }

      if (event.code === "Space") {
        event.preventDefault();
        spacePressedRef.current = true;
        setIsSpacePressed(true);
      }

      if (!commandKey && !event.altKey) {
        if (shortcut === "m") {
          const selection = useSelectionStore.getState().selectedIds;
          const selectedFrames = [...selection]
            .map((id) => useDocumentStore.getState().objects[id])
            .filter((object) => object !== undefined && isFrameObject(object));
          if (selectedFrames.length === 1 && selection.size === 1) {
            event.preventDefault();
            const frame = selectedFrames[0];
            useDocumentStore.getState().updateObject(
              frame.id,
              { moveContents: !frame.moveContents },
              frame.moveContents
                ? "Keep frame contents fixed"
                : "Move frame contents",
            );
            return;
          }
        }
        if (shortcut === "a") {
          const selection = useSelectionStore.getState().selectedIds;
          const selectedConnectors = [...selection]
            .map((id) => useDocumentStore.getState().objects[id])
            .filter(
              (object) => object !== undefined && isConnectorObject(object),
            );
          if (selectedConnectors.length === 1 && selection.size === 1) {
            event.preventDefault();
            const connector = selectedConnectors[0];
            useDocumentStore.getState().updateObject(
              connector.id,
              { directed: !connector.directed },
              connector.directed ? "Remove arrowhead" : "Add arrowhead",
            );
            return;
          }
        }
        if (shortcut === "v") useUiStore.getState().setActiveTool("select");
        if (shortcut === "h") useUiStore.getState().setActiveTool("hand");
        if (shortcut === "t") useUiStore.getState().setActiveTool("text");
        if (shortcut === "n") useUiStore.getState().setActiveTool("card");
        if (shortcut === "f") useUiStore.getState().setActiveTool("frame");
        if (shortcut === "p") useUiStore.getState().setActiveTool("pen");
        if (shortcut === "c")
          useUiStore.getState().setActiveTool("connector");
      }

      if (event.key === "Escape") {
        const connection = connectorRef.current;
        if (
          connection &&
          surfaceRef.current?.hasPointerCapture(connection.pointerId)
        ) {
          surfaceRef.current.releasePointerCapture(connection.pointerId);
        }
        clearConnectorPreview();
        const frameCreation = frameCreationRef.current;
        if (
          frameCreation &&
          surfaceRef.current?.hasPointerCapture(frameCreation.pointerId)
        ) {
          surfaceRef.current.releasePointerCapture(frameCreation.pointerId);
        }
        clearFramePreview();
        settleStroke(false);
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
  }, [
    clearConnectorPreview,
    clearFramePreview,
    clearStrokePreview,
    settleStroke,
    resetViewport,
    zoomAtCenter,
  ]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (strokePaintRef.current !== null) cancelAnimationFrame(strokePaintRef.current);
    },
    [],
  );

  const createObjectAt = (
    type: "text" | "card",
    clientPoint: Point,
    suppressFollowingDoubleClick = false,
  ) => {
    if (useBoardStore.getState().readOnly) return;
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
        ? createTextObject(worldPoint, documentStore.getNextZIndex(), useToolPreferencesStore.getState().text)
        : createCardObject(worldPoint, documentStore.getNextZIndex());

    documentStore.addObject(object);
    useUiStore.getState().setActiveTool("select");
    useSelectionStore.getState().selectOnly(object.id);
    useInteractionStore
      .getState()
      .beginInteraction("editingText", object.id);

    if (suppressFollowingDoubleClick) {
      suppressDoubleClickUntilRef.current = performance.now() + 450;
    }
  };

  const getFrameBounds = (
    interaction: FrameCreationInteraction,
    useDefaultSize = false,
  ): Bounds => {
    if (useDefaultSize) {
      return {
        left: interaction.startPoint.x - DEFAULT_FRAME_WIDTH / 2,
        top: interaction.startPoint.y - DEFAULT_FRAME_HEIGHT / 2,
        right: interaction.startPoint.x + DEFAULT_FRAME_WIDTH / 2,
        bottom: interaction.startPoint.y + DEFAULT_FRAME_HEIGHT / 2,
      };
    }
    return {
      left: Math.min(interaction.startPoint.x, interaction.currentPoint.x),
      top: Math.min(interaction.startPoint.y, interaction.currentPoint.y),
      right: Math.max(interaction.startPoint.x, interaction.currentPoint.x),
      bottom: Math.max(interaction.startPoint.y, interaction.currentPoint.y),
    };
  };

  const paintFrameDraft = (interaction: FrameCreationInteraction) => {
    if (!frameDraftRef.current) return;
    const bounds = getFrameBounds(interaction);
    frameDraftRef.current.style.display = "block";
    frameDraftRef.current.style.left = `${bounds.left}px`;
    frameDraftRef.current.style.top = `${bounds.top}px`;
    frameDraftRef.current.style.width = `${bounds.right - bounds.left}px`;
    frameDraftRef.current.style.height = `${bounds.bottom - bounds.top}px`;
  };

  const beginFrameCreation = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const startPoint = screenToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      viewportRef.current,
    );
    const interaction: FrameCreationInteraction = {
      pointerId: event.pointerId,
      startPoint,
      currentPoint: startPoint,
      moved: false,
    };
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    frameCreationRef.current = interaction;
    setIsCreatingFrame(true);
    useSelectionStore.getState().clearSelection();
    useInteractionStore.getState().beginInteraction("creatingFrame");
    paintFrameDraft(interaction);
  };

  const continueFrameCreation = (
    event: ReactPointerEvent<HTMLDivElement>,
    interaction: FrameCreationInteraction,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    interaction.currentPoint = screenToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      viewportRef.current,
    );
    interaction.moved =
      Math.hypot(
        interaction.currentPoint.x - interaction.startPoint.x,
        interaction.currentPoint.y - interaction.startPoint.y,
      ) >=
      4 / viewportRef.current.zoom;
    paintFrameDraft(interaction);
  };

  const finishFrameCreation = (
    event: ReactPointerEvent<HTMLDivElement>,
    interaction: FrameCreationInteraction,
  ) => {
    const wasCancelled = event.type === "pointercancel";
    if (!wasCancelled) {
      const documentStore = useDocumentStore.getState();
      const frame = createFrameObject(
        getFrameBounds(interaction, !interaction.moved),
        documentStore.getNextZIndex(),
      );
      documentStore.addObject(frame);
      useUiStore.getState().setActiveTool("select");
      useSelectionStore.getState().selectOnly(frame.id);
      suppressDoubleClickUntilRef.current = performance.now() + 450;
    }
    clearFramePreview();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    useInteractionStore.getState().endInteraction();
  };

  const paintStrokeDraft = (interaction: StrokeInteraction) => {
    if (!strokeDraftRef.current) return;
    const { mode, color, size, opacity } = interaction.settings;
    const width = PEN_WIDTHS[size];
    const inputKind = strokeInputKind(interaction.pointerType);
    interaction.simple = mode !== "solid" && chooseStrokeDetail(width, inputKind, viewportRef.current.zoom, interaction.simple);
    const solid = mode === "solid" || interaction.simple;
    const geometry = getStrokeGeometry({ points: interaction.points, strokeWidth: width,
      mode, rendererVersion: 2, inputKind }, false);
    strokeDraftRef.current.style.display = "block";
    strokeDraftRef.current.setAttribute("fill", solid ? "none" : color);
    strokeDraftRef.current.setAttribute("stroke", solid ? color : "none");
    strokeDraftRef.current.setAttribute("stroke-width", String(width));
    strokeDraftRef.current.style.strokeWidth = interaction.simple
      ? simpleStrokeWidthStyle(width, inputKind) : "";
    strokeDraftRef.current.dataset.simple = String(interaction.simple);
    strokeDraftRef.current.setAttribute("opacity", String(opacity));
    strokeDraftRef.current.setAttribute(
      "d",
      solid ? geometry.centerlinePath : geometry.outlinePath,
    );
  };

  const appendStrokeSamples = (
    event: ReactPointerEvent<HTMLDivElement>,
    interaction: StrokeInteraction,
  ) => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    const samples = getConfirmedPointerSamples(event.nativeEvent);
    for (const sample of samples) {
      trackStrokeTravel(interaction, { x: sample.clientX, y: sample.clientY });
      const point = screenToWorld(
        { x: sample.clientX - rect.left, y: sample.clientY - rect.top },
        viewportRef.current,
      );
      appendInkSample(interaction.points, interaction.dynamics, strokeInputKind(interaction.pointerType),
        sample, point, viewportRef.current.zoom, event.type === "pointerup");
    }
    // Coalesced input stays in refs. Rebuild the draft at most once per frame,
    // without publishing pointer samples to React or the document store.
    if (strokePaintRef.current === null) {
      strokePaintRef.current = requestAnimationFrame(() => {
        strokePaintRef.current = null;
        if (strokeRef.current === interaction) paintStrokeDraft(interaction);
      });
    }
  };

  const beginStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (strokeRef.current) return;
    const interaction: StrokeInteraction = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startedAt: event.timeStamp,
      travel: 0,
      lastClientPoint: { x: event.clientX, y: event.clientY },
      dynamics: createInkDynamics(),
      settings: { ...useToolPreferencesStore.getState().pen },
      points: [],
      simple: false,
    };
    event.preventDefault();
    surfaceRef.current!.setPointerCapture(event.pointerId);
    strokeRef.current = interaction;
    setIsDrawing(true);
    useSelectionStore.getState().clearSelection();
    useInteractionStore.getState().beginInteraction("drawing");
    appendStrokeSamples(event, interaction);
    paintStrokeDraft(interaction);
  };

  const finishStroke = (
    event: ReactPointerEvent<HTMLDivElement>,
    interaction: StrokeInteraction,
  ) => {
    if (strokeRef.current !== interaction) return;
    if (event.type === "pointerup") appendStrokeSamples(event, interaction);
    settleStroke(true);
  };

  const paintConnectorDraft = (interaction: ConnectorInteraction) => {
    const objects = useDocumentStore.getState().objects;
    const nodes = getNodeObjects(objects);
    const fixedPoint = getEndpointPoint(interaction.fixedEndpoint, nodes);
    if (!fixedPoint || !connectorDraftRef.current) return;

    let from: Point;
    let to: Point;
    let fromAnchor: ConnectionAnchor;
    let toAnchor: ConnectionAnchor;
    if (interaction.movingEnd === "to") {
      from = fixedPoint;
      fromAnchor = interaction.fixedEndpoint.anchor;
      to = interaction.candidate
        ? getEndpointPoint(interaction.candidate, nodes) ?? interaction.currentPoint
        : interaction.currentPoint;
      toAnchor = interaction.candidate?.anchor ?? inferAnchorToward(to, from);
    } else {
      to = fixedPoint;
      toAnchor = interaction.fixedEndpoint.anchor;
      from = interaction.candidate
        ? getEndpointPoint(interaction.candidate, nodes) ?? interaction.currentPoint
        : interaction.currentPoint;
      fromAnchor =
        interaction.candidate?.anchor ?? inferAnchorToward(from, to);
    }

    connectorDraftRef.current.setAttribute(
      "d",
      buildConnectorPath(from, to, fromAnchor, toAnchor),
    );
    connectorDraftRef.current.style.display = "block";
  };

  const findConnectionCandidate = (
    screenPoint: Point,
    excludedObjectId: string,
  ): ConnectionEndpoint | null => {
    const nodes = getNodeObjects(useDocumentStore.getState().objects);
    let nearest: { endpoint: ConnectionEndpoint; distance: number } | null =
      null;

    for (const node of Object.values(nodes)) {
      if (node.id === excludedObjectId) continue;
      for (const anchor of CONNECTION_ANCHORS) {
        const anchorScreenPoint = worldToScreen(
          getAnchorPoint(node, anchor),
          viewportRef.current,
        );
        const distance = Math.hypot(
          screenPoint.x - anchorScreenPoint.x,
          screenPoint.y - anchorScreenPoint.y,
        );
        if (distance <= 20 && (!nearest || distance < nearest.distance)) {
          nearest = {
            endpoint: { objectId: node.id, anchor },
            distance,
          };
        }
      }
    }

    return nearest?.endpoint ?? null;
  };

  const highlightConnectionCandidate = (
    candidate: ConnectionEndpoint | null,
  ) => {
    surfaceRef.current
      ?.querySelectorAll<HTMLElement>("[data-connection-anchor]")
      .forEach((element) => {
        element.classList.toggle(
          "is-target",
          candidate !== null &&
            element.dataset.connectionObject === candidate.objectId &&
            element.dataset.connectionAnchor === candidate.anchor,
        );
      });
  };

  const beginConnectorInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): boolean => {
    if (useBoardStore.getState().readOnly || event.button !== 0 || !(event.target instanceof Element)) return false;
    const target = event.target;
    const endpointHandle = target.closest<SVGElement>(
      "[data-connector-endpoint]",
    );
    const nodeAnchor = target.closest<HTMLElement>("[data-connection-anchor]");
    const objects = useDocumentStore.getState().objects;
    let interaction: ConnectorInteraction | null = null;

    if (endpointHandle) {
      const connectorId = endpointHandle.dataset.connectorId;
      const movingEnd = endpointHandle.dataset.connectorEnd;
      const connector = connectorId ? objects[connectorId] : undefined;
      if (
        connector &&
        isConnectorObject(connector) &&
        (movingEnd === "from" || movingEnd === "to")
      ) {
        interaction = {
          pointerId: event.pointerId,
          connectorId: connector.id,
          movingEnd,
          fixedEndpoint:
            movingEnd === "from" ? connector.to : connector.from,
          currentPoint: screenToWorld(
            {
              x: event.clientX - event.currentTarget.getBoundingClientRect().left,
              y: event.clientY - event.currentTarget.getBoundingClientRect().top,
            },
            viewportRef.current,
          ),
          candidate: null,
        };
      }
    } else if (nodeAnchor && activeTool === "connector") {
      const objectId = nodeAnchor.dataset.connectionObject;
      const anchor = nodeAnchor.dataset.connectionAnchor as
        | ConnectionAnchor
        | undefined;
      const node = objectId ? getNodeObjects(objects)[objectId] : undefined;
      if (objectId && anchor && node) {
        interaction = {
          pointerId: event.pointerId,
          connectorId: null,
          movingEnd: "to",
          fixedEndpoint: { objectId, anchor },
          currentPoint: getAnchorPoint(node, anchor),
          candidate: null,
        };
      }
    }

    if (!interaction) return false;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    connectorRef.current = interaction;
    setIsConnecting(true);
    useInteractionStore
      .getState()
      .beginInteraction("connecting", interaction.connectorId ?? undefined);
    paintConnectorDraft(interaction);
    return true;
  };

  const clearTransientSelectionStyles = () => {
    surfaceRef.current
      ?.querySelectorAll<HTMLElement | SVGGElement>(
        "[data-transient-selected]",
      )
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
    const objects = useDocumentStore.getState().objects;
    const hitIds = Object.values(objects)
      .filter((object) => {
        const bounds = getObjectBounds(object, objects);
        return bounds ? boundsIntersect(marqueeBounds, bounds) : false;
      })
      .map((object) => object.id);
    const nextSelection = expandIdsToGroups(
      interaction.additive
        ? [...interaction.initialSelectedIds, ...hitIds]
        : hitIds,
      objects,
    );

    interaction.liveSelectedIds = nextSelection;
    surfaceRef.current
      ?.querySelectorAll<HTMLElement | SVGGElement>(
        "[data-object-id], [data-connector-object-id], [data-stroke-object-id]",
      )
      .forEach((element) => {
        const id =
          element.dataset.objectId ??
          element.dataset.connectorObjectId ??
          element.dataset.strokeObjectId;
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

  const cancelCanvasPointerInteractionsForPinch = () => {
    window.dispatchEvent(new Event(CANCEL_TOUCH_INTERACTIONS_EVENT));
    // The caller has already decided that this is a provisional touch draft.
    settleStroke(false);
    clearFramePreview();
    clearConnectorPreview();
    panRef.current = null;
    setIsPanning(false);

    const marquee = marqueeRef.current;
    if (marquee) {
      marqueeRef.current = null;
      useSelectionStore.getState().setSelection(marquee.initialSelectedIds);
      clearTransientSelectionStyles();
      if (marqueeOverlayRef.current) {
        marqueeOverlayRef.current.style.display = "none";
      }
      setIsMarqueeSelecting(false);
    }
    useInteractionStore.getState().endInteraction();
  };

  useEffect(() => {
    if (readOnly) {
      clearStrokePreview();
      clearFramePreview();
      clearConnectorPreview();
    }
  }, [readOnly]);

  const handleViewportPointerDownCapture = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const board = useBoardStore.getState();
    if (!board.account && board.tabReadOnly && event.button === 0 && !isSpacePressed && selectedTool !== "hand") {
      window.dispatchEvent(new Event(REQUEST_GUEST_EDIT_EVENT));
    }
    // IDs may be reused after a real lift, including a rejected contact.
    ignoredContactsRef.current.delete(event.pointerId);
    const target = event.target;
    const focused = document.activeElement;
    if (
      target instanceof Element &&
      !target.closest(".toolbar-area, .tool-options, .mobile-selection-actions, .zoom-dock") &&
      focused instanceof HTMLElement &&
      focused.closest(".toolbar-area, .tool-options, .mobile-selection-actions, .zoom-dock")
    ) {
      focused.blur();
    }

    if (
      event.pointerType !== "touch" ||
      isTypingTarget(target) ||
      (target instanceof Element &&
        target.closest(
          ".toolbar-area, .tool-options, .mobile-selection-actions, .history-dock, .zoom-dock, .brand-mark",
        ))
    ) {
      return;
    }

    const stroke = strokeRef.current;
    if (stroke && (stroke.pointerType !== "touch" || !isProvisionalTouch(stroke, event.timeStamp))) {
      ignoredContactsRef.current.add(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    touchPointsRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (touchPointsRef.current.size < 2) return;

    if (!pinchRef.current) {
      const entries = [...touchPointsRef.current.entries()].slice(0, 2);
      const [[firstId, first], [secondId, second]] = entries;
      cancelCanvasPointerInteractionsForPinch();
      touchPointsRef.current.set(firstId, first);
      surfaceRef.current!.setPointerCapture(firstId);
      surfaceRef.current!.setPointerCapture(secondId);
      pinchRef.current = {
        pointerIds: [firstId, secondId],
        lastMidpoint: {
          x: (first.x + second.x) / 2,
          y: (first.y + second.y) / 2,
        },
        lastDistance: Math.max(
          1,
          Math.hypot(second.x - first.x, second.y - first.y),
        ),
      };
      setIsPinching(true);
      suppressDoubleClickUntilRef.current = performance.now() + 450;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  const handleViewportPointerMoveCapture = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (ignoredContactsRef.current.has(event.pointerId)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (
      event.pointerType !== "touch" ||
      !touchPointsRef.current.has(event.pointerId)
    ) {
      return;
    }
    touchPointsRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    const pinch = pinchRef.current;
    if (!pinch) return;
    event.preventDefault();
    event.stopPropagation();

    const first = touchPointsRef.current.get(pinch.pointerIds[0]);
    const second = touchPointsRef.current.get(pinch.pointerIds[1]);
    const element = surfaceRef.current;
    if (!first || !second || !element) return;

    const midpoint = {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
    const distance = Math.max(
      1,
      Math.hypot(second.x - first.x, second.y - first.y),
    );
    const rect = element.getBoundingClientRect();
    const previousLocalMidpoint = {
      x: pinch.lastMidpoint.x - rect.left,
      y: pinch.lastMidpoint.y - rect.top,
    };
    const zoomed = zoomViewportAtPoint(
      viewportRef.current,
      previousLocalMidpoint,
      viewportRef.current.zoom * (distance / pinch.lastDistance),
    );
    const next = panViewport(zoomed, {
      x: midpoint.x - pinch.lastMidpoint.x,
      y: midpoint.y - pinch.lastMidpoint.y,
    });
    pinch.lastMidpoint = midpoint;
    pinch.lastDistance = distance;
    scheduleViewport(next);
    setDisplayZoom(next.zoom);
  };

  const handleViewportPointerEndCapture = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (ignoredContactsRef.current.delete(event.pointerId)) {
      event.stopPropagation();
      return;
    }
    if (
      event.pointerType !== "touch" ||
      !touchPointsRef.current.has(event.pointerId)
    ) {
      return;
    }

    const pinch = pinchRef.current;
    touchPointsRef.current.delete(event.pointerId);
    if (!pinch) return;

    event.preventDefault();
    event.stopPropagation();
    if (pinch.pointerIds.includes(event.pointerId)) {
      pinchRef.current = null;
      for (const id of touchPointsRef.current.keys()) ignoredContactsRef.current.add(id);
      touchPointsRef.current.clear();
      for (const id of pinch.pointerIds) {
        if (surfaceRef.current?.hasPointerCapture(id)) surfaceRef.current.releasePointerCapture(id);
      }
      setIsPinching(false);
      commitViewport();
    }
  };

  const beginSurfaceInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const owner = strokeRef.current;
    if (owner) {
      if (event.button === 0 && activeTool === "pen" && event.pointerType === "pen" && owner.pointerType === "touch") {
        ignoredContactsRef.current.add(owner.pointerId);
        settleStroke(!isProvisionalTouch(owner, event.timeStamp));
      } else return;
    }
    if (event.button === 0 && event.pointerType === "pen" && activeTool === "pen") {
      // Prefer recognized pen input over a pending touch pan/pinch.
      if (pinchRef.current || panRef.current) commitViewport();
      pinchRef.current = null;
      panRef.current = null;
      for (const id of touchPointsRef.current.keys()) {
        ignoredContactsRef.current.add(id);
        if (surfaceRef.current?.hasPointerCapture(id)) surfaceRef.current.releasePointerCapture(id);
      }
      touchPointsRef.current.clear();
      setIsPinching(false);
      setIsPanning(false);
    }
    pointerLocationRef.current = {
      clientPoint: { x: event.clientX, y: event.clientY },
      isOverCanvas: true,
    };
    const isPrimaryButton = event.button === 0;
    const isMiddleButton = event.button === 1;
    if (!isPrimaryButton && !isMiddleButton) return;

    if (isPrimaryButton && beginConnectorInteraction(event)) return;

    if (
      isPrimaryButton &&
      useInteractionStore.getState().mode === "editingText"
    ) {
      if (activeTool === "text" || activeTool === "card") {
        (document.activeElement as HTMLElement | null)?.blur();
        createObjectAt(activeTool, { x: event.clientX, y: event.clientY }, true);
        return;
      }
      if (activeTool === "frame") {
        (document.activeElement as HTMLElement | null)?.blur();
        useInteractionStore.getState().endInteraction();
        beginFrameCreation(event);
        return;
      }
      if (activeTool === "pen") {
        (document.activeElement as HTMLElement | null)?.blur();
        useInteractionStore.getState().endInteraction();
        beginStroke(event);
        return;
      }
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

    if (isPrimaryButton && !shouldForcePan && activeTool === "frame") {
      beginFrameCreation(event);
      return;
    }

    if (isPrimaryButton && !shouldForcePan && activeTool === "pen") {
      beginStroke(event);
      return;
    }

    if (!shouldForcePan && activeTool !== "hand" && activeTool !== "select") {
      return;
    }

    if (
      activeTool === "select" &&
      !shouldForcePan &&
      event.pointerType !== "touch"
    ) {
      beginMarquee(event);
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      lastClientPoint: { x: event.clientX, y: event.clientY },
      startClientPoint: { x: event.clientX, y: event.clientY },
      moved: false,
      clearSelectionOnTap:
        activeTool === "select" && event.pointerType === "touch",
    };
    setIsPanning(true);
    useInteractionStore.getState().beginInteraction("panning");
  };

  const continueSurfaceInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    pointerLocationRef.current = {
      clientPoint: { x: event.clientX, y: event.clientY },
      isOverCanvas: true,
    };
    const stroke = strokeRef.current;
    if (stroke?.pointerId === event.pointerId) {
      appendStrokeSamples(event, stroke);
      return;
    }
    if (stroke) return;

    const frameCreation = frameCreationRef.current;
    if (frameCreation?.pointerId === event.pointerId) {
      continueFrameCreation(event, frameCreation);
      return;
    }

    const connection = connectorRef.current;
    if (connection?.pointerId === event.pointerId) {
      const element = surfaceRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const screenPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      connection.currentPoint = screenToWorld(screenPoint, viewportRef.current);
      connection.candidate = findConnectionCandidate(
        screenPoint,
        connection.fixedEndpoint.objectId,
      );
      highlightConnectionCandidate(connection.candidate);
      paintConnectorDraft(connection);
      return;
    }

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
    interaction.moved =
      interaction.moved ||
      Math.hypot(
        point.x - interaction.startClientPoint.x,
        point.y - interaction.startClientPoint.y,
      ) >= 4;
    scheduleViewport(panViewport(viewportRef.current, delta));
  };

  const endSurfaceInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const stroke = strokeRef.current;
    if (stroke?.pointerId === event.pointerId) {
      finishStroke(event, stroke);
      return;
    }

    const frameCreation = frameCreationRef.current;
    if (frameCreation?.pointerId === event.pointerId) {
      finishFrameCreation(event, frameCreation);
      return;
    }

    const connection = connectorRef.current;
    if (connection?.pointerId === event.pointerId) {
      const wasCancelled = event.type === "pointercancel";
      if (!wasCancelled && connection.candidate) {
        const documentStore = useDocumentStore.getState();
        if (connection.connectorId) {
          documentStore.updateObject(
            connection.connectorId,
            connection.movingEnd === "from"
              ? { from: connection.candidate }
              : { to: connection.candidate },
            "Reconnect connector",
          );
          useSelectionStore.getState().selectOnly(connection.connectorId);
        } else {
          const connector = createConnectorObject(
            connection.fixedEndpoint,
            connection.candidate,
            documentStore.getNextZIndex(),
            !event.shiftKey,
          );
          documentStore.addObject(connector);
          useSelectionStore.getState().selectOnly(connector.id);
        }
        suppressDoubleClickUntilRef.current = performance.now() + 450;
      }

      clearConnectorPreview();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      useInteractionStore.getState().endInteraction();
      return;
    }

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
    if (interaction.clearSelectionOnTap && !interaction.moved) {
      useSelectionStore.getState().clearSelection();
      useUiStore.getState().setMultiSelectMode(false);
    }
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
    if (event.target === surfaceRef.current && pinchRef.current?.pointerIds.includes(event.pointerId)) {
      handleViewportPointerEndCapture(event);
      return;
    }
    if (event.target === surfaceRef.current && strokeRef.current?.pointerId === event.pointerId) {
      settleStroke(true);
      return;
    }

    if (frameCreationRef.current?.pointerId === event.pointerId) {
      clearFramePreview();
      useInteractionStore.getState().endInteraction();
      return;
    }

    if (connectorRef.current?.pointerId === event.pointerId) {
      clearConnectorPreview();
      useInteractionStore.getState().endInteraction();
      return;
    }

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

  useEffect(() => {
    const handleCopy = (event: ClipboardEvent) => {
      if (
        isChromeTarget(event.target) ||
        isTypingTarget(event.target) ||
        useSelectionStore.getState().selectedIds.size === 0
      ) {
        return;
      }
      copySelection();
      event.clipboardData?.setData("application/x-the-canvas-objects", "1");
      event.preventDefault();
    };

    const handlePaste = (event: ClipboardEvent) => {
      if (isChromeTarget(event.target)) return;
      if (useBoardStore.getState().readOnly && !isTypingTarget(event.target)) { event.preventDefault(); return; }
      const isEditingText = isTypingTarget(event.target);
      const imageFiles = getClipboardImageFiles(event.clipboardData);
      if (imageFiles.length > 0) {
        event.preventDefault();
        void insertImageFiles(imageFiles, "paste");
        return;
      }
      if (isEditingText) return;

      const internalClipboard = useClipboardStore.getState().objects;
      if (internalClipboard.length > 0) {
        event.preventDefault();
        pasteClipboard();
      }
    };

    window.addEventListener("copy", handleCopy);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("copy", handleCopy);
      window.removeEventListener("paste", handlePaste);
    };
  }, [insertImageFiles]);

  const handlePointerEnter = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerLocationRef.current = {
      clientPoint: { x: event.clientX, y: event.clientY },
      isOverCanvas: true,
    };
  };

  const handlePointerLeave = () => {
    if (pointerLocationRef.current) {
      pointerLocationRef.current.isOverCanvas = false;
    }
  };

  const handleDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsImageDragOver(true);
  };

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isImageDragOver) setIsImageDragOver(true);
  };

  const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsImageDragOver(false);
  };

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsImageDragOver(false);
    void insertImageFiles(
      getDroppedFiles(event.dataTransfer),
      "drop",
      { x: event.clientX, y: event.clientY },
    );
  };

  return (
    <section
      ref={surfaceRef}
      className="canvas-viewport"
      data-panning={isPanning ? "true" : "false"}
      data-pinching={isPinching ? "true" : "false"}
      data-space-pressed={isSpacePressed ? "true" : "false"}
      data-marquee-selecting={isMarqueeSelecting ? "true" : "false"}
      data-connecting={isConnecting ? "true" : "false"}
      data-creating-frame={isCreatingFrame ? "true" : "false"}
      data-drawing={isDrawing ? "true" : "false"}
      data-editing-text={isEditingText ? "true" : "false"}
      data-image-drag-over={isImageDragOver ? "true" : "false"}
      data-active-tool={activeTool}
      aria-label="Infinite canvas"
      onPointerDownCapture={handleViewportPointerDownCapture}
      onPointerMoveCapture={handleViewportPointerMoveCapture}
      onPointerUpCapture={handleViewportPointerEndCapture}
      onPointerCancelCapture={handleViewportPointerEndCapture}
      onPointerDown={beginSurfaceInteraction}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerMove={continueSurfaceInteraction}
      onPointerUp={endSurfaceInteraction}
      onPointerCancel={endSurfaceInteraction}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={handleSurfaceDoubleClick}
      onContextMenu={(event) => event.preventDefault()}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div ref={gridRef} className="grid-layer" aria-hidden="true" />

      <div ref={worldRef} className="world-layer">
        <span className="world-origin-dot" aria-hidden="true" />
        <FrameLayer />
        <div ref={frameDraftRef} className="frame-draft" aria-hidden="true" />
        <ConnectorLayer />
        <ObjectLayer />
        <StrokeLayer zoom={strokeZoom} window={strokeWindow} />
        <SelectionLayer />
        <svg className="connector-draft-layer" aria-hidden="true">
          <path ref={connectorDraftRef} className="connector-draft-path" />
        </svg>
        <svg className="stroke-draft-layer" aria-hidden="true">
          <path ref={strokeDraftRef} className="stroke-draft-path" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div
        ref={marqueeOverlayRef}
        className="marquee-selection"
        aria-hidden="true"
      />

      {isBoardHydrated && objectCount === 0 && (
        <div className="empty-prompt" aria-hidden="true">
          <span className="empty-prompt-icon">+</span>
          <div className="empty-prompt-content">
            <strong>Start creating</strong>
            <span className="empty-prompt-copy">
              Double-click for a note, or choose a drawing tool
            </span>
            <div className="empty-prompt-tools">
              <span><kbd>N</kbd> Note</span>
              <span><kbd>T</kbd> Text</span>
              <span><kbd>P</kbd> Pen</span>
            </div>
          </div>
        </div>
      )}

      {!isBoardHydrated && (
        <div className="board-loading-shield" aria-label="Opening local board" />
      )}

      {isImageDragOver && (
        <div className="image-drop-indicator" aria-hidden="true">
          <span>Drop images to add them</span>
        </div>
      )}

      {canvasNotice && (
        <div className="canvas-notice" role="status">
          {canvasNotice}
        </div>
      )}

      <div onPointerDown={(event) => event.stopPropagation()}>
        <Toolbar />
      </div>

      <aside className="canvas-hint" aria-label="Canvas navigation help">
        {readOnly && <span><strong>Read-only</strong> · Select and copy · Space-drag to pan</span>}
        {!readOnly && activeTool === "select" && (
          <>
            {selectedCount === 1 && selectedConnectorIds.length === 1 ? (
              <>
                <span><strong>Drag an endpoint</strong> to reconnect</span>
                <i aria-hidden="true" />
                <span><strong>A</strong> toggle arrow</span>
                <i aria-hidden="true" />
                <span><strong>Delete</strong> remove</span>
              </>
            ) : selectedCount === 1 && selectedStrokeIds.length === 1 ? (
              <>
                <span><strong>Drag</strong> to move stroke</span>
                <i aria-hidden="true" />
                <span><strong>Ctrl/⌘ D</strong> duplicate</span>
                <i aria-hidden="true" />
                <span><strong>Delete</strong> remove stroke</span>
              </>
            ) : selectedCount === 1 && selectedFrameIds.length === 1 ? (
              <>
                <span><strong>Double-click title</strong> to rename</span>
                <i aria-hidden="true" />
                <span><strong>M</strong> toggle moving contents</span>
                <i aria-hidden="true" />
                <span><strong>Delete</strong> remove frame</span>
              </>
            ) : selectedGroupIds.size > 0 ? (
              <>
                <span><strong>Drag any member</strong> to move group</span>
                <i aria-hidden="true" />
                <span><strong>Ctrl/⌘ Shift G</strong> ungroup</span>
                <i aria-hidden="true" />
                <span><strong>Delete</strong> remove</span>
              </>
            ) : selectedCount > 0 ? (
              <>
                <span><strong>Ctrl/⌘ G</strong> group selection</span>
                <i aria-hidden="true" />
                <span><strong>Ctrl/⌘ C · V</strong> copy and paste</span>
                <i aria-hidden="true" />
                <span><strong>Delete</strong> remove</span>
              </>
            ) : (
              <>
                <span><strong>Drag empty space</strong> to select</span>
                <i aria-hidden="true" />
                <span><strong>Space-drag</strong> to pan</span>
              </>
            )}
          </>
        )}
        {activeTool === "hand" && (
          <>
            <span><strong>Drag</strong> to pan</span>
            <i aria-hidden="true" />
            <span><strong>Scroll</strong> to move around</span>
          </>
        )}
        {activeTool === "card" && (
          <>
            <span><strong>Click empty space</strong> to add a note</span>
            <i aria-hidden="true" />
            <span><strong>Esc</strong> to return to Select</span>
          </>
        )}
        {activeTool === "text" && (
          <>
            <span><strong>Click empty space</strong> to add text</span>
            <i aria-hidden="true" />
            <span><strong>Esc</strong> to return to Select</span>
          </>
        )}
        {activeTool === "connector" && (
          <>
            <span><strong>Drag from an anchor</strong> to connect</span>
            <i aria-hidden="true" />
            <span><strong>Shift-drag</strong> for no arrow</span>
            <i aria-hidden="true" />
            <span><strong>Esc</strong> to Select</span>
          </>
        )}
        {activeTool === "frame" && (
          <>
            <span><strong>Drag empty space</strong> to draw a frame</span>
            <i aria-hidden="true" />
            <span><strong>Click</strong> for a default frame</span>
            <i aria-hidden="true" />
            <span><strong>Esc</strong> to Select</span>
          </>
        )}
        {activeTool === "pen" && (
          <>
            <span><strong>Drag</strong> to draw</span>
            <i aria-hidden="true" />
            <span><strong>Stylus pressure</strong> supported</span>
            <i aria-hidden="true" />
            <span><strong>Esc</strong> to Select</span>
          </>
        )}
      </aside>

      <div
        className="zoom-dock"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
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
