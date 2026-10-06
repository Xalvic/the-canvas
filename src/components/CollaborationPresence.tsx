import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { screenToWorld, type Point, type Viewport } from "../canvas/viewport/viewportMath";
import { isCanvasSpatialObject } from "../canvas/objects/types";
import { useCollaborationStore } from "../store/collaborationStore";
import { useDocumentStore } from "../store/documentStore";
import { useSelectionStore } from "../store/selectionStore";
import { useViewportStore } from "../store/viewportStore";
import { Dialog } from "./Dialog";

export type PublishCollaborationPresence = (cursor: Point | null, selectedIds: string[]) => void;
const PRESENCE_INTERVAL_MS = 100;

function paintedViewport(surface: HTMLElement): Viewport {
  const saved = useViewportStore.getState().viewport;
  const transform = surface.querySelector<HTMLElement>(".world-layer")?.style.transform;
  if (!transform || typeof DOMMatrixReadOnly === "undefined") return saved;
  try {
    const matrix = new DOMMatrixReadOnly(transform);
    if (matrix.a > 0 && Number.isFinite(matrix.a) && Number.isFinite(matrix.e) && Number.isFinite(matrix.f)) {
      return { x: matrix.e, y: matrix.f, zoom: matrix.a };
    }
  } catch { /* A stale or unsupported painted transform falls back to saved viewport. */ }
  return saved;
}

// Pointer handlers retain numbers only; world conversion and selection copying
// happen once per bounded publication, outside React and editor history.
export function attachCollaborationCursor(surface: HTMLElement, publish: PublishCollaborationPresence) {
  let clientX = 0, clientY = 0, inCanvas = false, disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    if (disposed) return;
    let cursor: Point | null = null;
    if (inCanvas && document.visibilityState === "visible") {
      const rect = surface.getBoundingClientRect();
      cursor = screenToWorld({ x: clientX - rect.left, y: clientY - rect.top }, paintedViewport(surface));
      if (!Number.isFinite(cursor.x) || !Number.isFinite(cursor.y) || Math.abs(cursor.x) > 1e9 || Math.abs(cursor.y) > 1e9) cursor = null;
    }
    publish(cursor, [...useSelectionStore.getState().selectedIds].slice(0, 100));
  };
  const schedule = () => { if (!disposed && timer === undefined) timer = setTimeout(flush, PRESENCE_INTERVAL_MS); };
  const move = (event: Event) => {
    const pointer = event as PointerEvent;
    clientX = pointer.clientX; clientY = pointer.clientY; inCanvas = true; schedule();
  };
  const leave = () => { inCanvas = false; schedule(); };
  const visibility = () => { if (document.visibilityState !== "visible") leave(); };
  surface.addEventListener("pointermove", move, { passive: true, capture: true });
  surface.addEventListener("pointerleave", leave);
  surface.addEventListener("pointercancel", leave);
  document.addEventListener("visibilitychange", visibility);
  const unsubscribeSelection = useSelectionStore.subscribe(schedule);
  const unsubscribeViewport = useViewportStore.subscribe(schedule);
  schedule();
  return () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    surface.removeEventListener("pointermove", move, true);
    surface.removeEventListener("pointerleave", leave);
    surface.removeEventListener("pointercancel", leave);
    document.removeEventListener("visibilitychange", visibility);
    unsubscribeSelection(); unsubscribeViewport();
  };
}

export function useCollaborationCursor(publish: PublishCollaborationPresence, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const surface = document.querySelector<HTMLElement>(".canvas-viewport");
    if (surface) return attachCollaborationCursor(surface, publish);
  }, [publish, enabled]);
}

const colors = ["#7c3aed", "#0369a1", "#be123c", "#047857", "#b45309", "#4338ca"];
export function collaborationColor(clientId: string) {
  let hash = 0;
  for (let index = 0; index < clientId.length; index++) hash = (hash * 31 + clientId.charCodeAt(index)) >>> 0;
  return colors[hash % colors.length];
}

export function CollaborationSummary() {
  const [peopleOpen, setPeopleOpen] = useState(false);
  const { clientId, status, participants } = useCollaborationStore();
  useEffect(() => { if (status === "disconnected") setPeopleOpen(false); }, [status]);
  const others = status === "connected" ? participants.filter((participant) => participant.clientId !== clientId) : [];
  const label = status === "connected" ? `Live · ${others.length} ${others.length === 1 ? "collaborator" : "collaborators"}` :
    status === "error" ? "Live updates unavailable" : status === "reconnecting" ? "Reconnecting live updates…" : "Connecting live updates…";
  if (status === "disconnected") return null;
  return <>
    {others.length > 0 ? <button type="button" className="collaboration-summary" data-collaboration-status={status} aria-haspopup="dialog" onClick={() => setPeopleOpen(true)}>{label}</button> :
      <span className="collaboration-summary" data-collaboration-status={status}>{label}</span>}
    <Dialog open={peopleOpen} title="People on this board" close={() => setPeopleOpen(false)}>
      <p>Other people currently connected to live updates:</p>
      {others.length === 0 ? <p>No other collaborators connected.</p> : <ul>{others.map((participant) => <li key={participant.clientId}>{participant.displayName?.trim() || "Collaborator"}</li>)}</ul>}
    </Dialog>
  </>;
}

export function CollaborationPresence() {
  const { clientId, status, participants } = useCollaborationStore();
  const objects = useDocumentStore((state) => state.objects);
  const viewport = useViewportStore((state) => state.viewport);
  const [surface, setSurface] = useState<HTMLElement | null>(null);
  useEffect(() => { setSurface(document.querySelector<HTMLElement>(".canvas-viewport")); }, []);
  if (!surface || status === "disconnected") return null;
  const world = surface.querySelector<HTMLElement>(".world-layer");
  const others = status === "connected" ? participants.filter((participant) => participant.clientId !== clientId) : [];
  return <>
    {world && createPortal(<div aria-hidden="true" style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 2_147_483_647 }}>
      {others.map((participant) => {
        const color = collaborationColor(participant.clientId);
        return <div key={participant.clientId} data-collaboration-client={participant.clientId}>
          {participant.selectedIds.map((id) => {
            const object = objects[id];
            return object && isCanvasSpatialObject(object) ? <div key={id} style={{
              position: "absolute", left: object.x, top: object.y, width: object.width, height: object.height,
              border: `${2 / viewport.zoom}px dashed ${color}`, boxSizing: "border-box", borderRadius: 4,
            }} /> : null;
          })}
          {participant.cursor && <div data-collaboration-cursor="true" style={{
            position: "absolute", left: participant.cursor.x, top: participant.cursor.y,
            transform: `scale(${1 / viewport.zoom})`, transformOrigin: "0 0", color,
          }}><svg width="18" height="24" viewBox="0 0 18 24"><path d="M1 1L1 18L6 13L10 22L14 20L10 11L17 11Z" fill={color} stroke="white" strokeWidth="1.5" /></svg>
            <span style={{ position: "absolute", left: 15, top: 19, whiteSpace: "nowrap", background: color, color: "white", padding: "3px 7px", borderRadius: 5, fontSize: 12 }}>{participant.displayName?.trim().slice(0, 60) || "Collaborator"}</span>
          </div>}
        </div>;
      })}
    </div>, world)}
  </>;
}
