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
  createTextObject,
} from "../objects/objectFactories";
import {
  isConnectorObject,
  type ConnectionAnchor,
  type ConnectionEndpoint,
} from "../objects/types";
import { Toolbar } from "../../components/Toolbar/Toolbar";
import { ZoomControls } from "../../components/ZoomControls/ZoomControls";
import { HistoryControls } from "../../components/HistoryControls/HistoryControls";
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

type ConnectorInteraction = {
  pointerId: number;
  connectorId: string | null;
  movingEnd: "from" | "to";
  fixedEndpoint: ConnectionEndpoint;
  currentPoint: Point;
  candidate: ConnectionEndpoint | null;
};

const GRID_SIZE = 24;
const ZOOM_STEP = 1.2;
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
  const viewportRef = useRef<Viewport>(useViewportStore.getState().viewport);
  const frameRef = useRef<number | null>(null);
  const panRef = useRef<PanInteraction | null>(null);
  const marqueeRef = useRef<MarqueeInteraction | null>(null);
  const connectorRef = useRef<ConnectorInteraction | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const spacePressedRef = useRef(false);
  const suppressDoubleClickUntilRef = useRef(0);
  const [displayZoom, setDisplayZoom] = useState(viewportRef.current.zoom);
  const [isPanning, setIsPanning] = useState(false);
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const activeTool = useUiStore((state) => state.activeTool);
  const objects = useDocumentStore((state) => state.objects);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const objectCount = Object.keys(objects).length;
  const selectedCount = selectedIds.size;
  const selectedConnectorIds = [...selectedIds].filter((id) => {
    const object = objects[id];
    return object !== undefined && isConnectorObject(object);
  });

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

  const paintViewport = useCallback((viewport: Viewport) => {
    if (worldRef.current) {
      worldRef.current.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
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

      const commandKey = event.ctrlKey || event.metaKey;
      const shortcut = event.key.toLowerCase();
      if (commandKey && !event.altKey) {
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
          event.preventDefault();
          copySelection();
          return;
        }
        if (shortcut === "v") {
          event.preventDefault();
          pasteClipboard();
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
  }, [clearConnectorPreview, resetViewport, zoomAtCenter]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const createObjectAt = (
    type: "text" | "card",
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

    if (suppressFollowingDoubleClick) {
      suppressDoubleClickUntilRef.current = performance.now() + 450;
    }
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
    if (event.button !== 0 || !(event.target instanceof Element)) return false;
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
    const nextSelection = interaction.additive
      ? new Set([...interaction.initialSelectedIds, ...hitIds])
      : new Set(hitIds);

    interaction.liveSelectedIds = nextSelection;
    surfaceRef.current
      ?.querySelectorAll<HTMLElement | SVGGElement>(
        "[data-object-id], [data-connector-object-id]",
      )
      .forEach((element) => {
        const id =
          element.dataset.objectId ?? element.dataset.connectorObjectId;
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
    scheduleViewport(panViewport(viewportRef.current, delta));
  };

  const endSurfaceInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
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

  return (
    <section
      ref={surfaceRef}
      className="canvas-viewport"
      data-panning={isPanning ? "true" : "false"}
      data-space-pressed={isSpacePressed ? "true" : "false"}
      data-marquee-selecting={isMarqueeSelecting ? "true" : "false"}
      data-connecting={isConnecting ? "true" : "false"}
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
        <ConnectorLayer />
        <ObjectLayer />
        <SelectionLayer />
        <svg className="connector-draft-layer" aria-hidden="true">
          <path ref={connectorDraftRef} className="connector-draft-path" />
        </svg>
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

      <div
        className="history-dock"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <HistoryControls />
      </div>

      <aside className="canvas-hint" aria-label="Canvas navigation help">
        {activeTool === "select" && (
          <>
            {selectedCount === 1 && selectedConnectorIds.length === 1 ? (
              <>
                <span><strong>Drag an endpoint</strong> to reconnect</span>
                <i aria-hidden="true" />
                <span><strong>A</strong> toggle arrow</span>
                <i aria-hidden="true" />
                <span><strong>Delete</strong> remove</span>
              </>
            ) : selectedCount > 0 ? (
              <>
                <span><strong>Ctrl/⌘ D</strong> duplicate</span>
                <i aria-hidden="true" />
                <span><strong>Ctrl/⌘ C · V</strong> copy and paste</span>
                <i aria-hidden="true" />
                <span><strong>Delete</strong> remove</span>
              </>
            ) : (
              <>
                <span><strong>Drag empty space</strong> to select</span>
                <i aria-hidden="true" />
                <span><strong>Shift-click</strong> to add or remove</span>
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
