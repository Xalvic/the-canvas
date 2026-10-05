import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachCollaborationCursor, collaborationColor } from "./CollaborationPresence";
import { useSelectionStore } from "../store/selectionStore";
import { initialViewport, useViewportStore } from "../store/viewportStore";

class Surface extends EventTarget {
  transform = "";
  querySelector() { return { style: { transform: this.transform } }; }
  getBoundingClientRect() { return { left: 100, top: 50 }; }
  move(x: number, y: number) { this.dispatchEvent(Object.assign(new Event("pointermove"), { clientX: x, clientY: y })); }
}
let cleanups: Array<() => void> = [];
let doc: EventTarget & { visibilityState: string };
beforeEach(() => {
  vi.useFakeTimers();
  doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", doc);
  useSelectionStore.getState().clearSelection();
  useViewportStore.getState().setViewport(initialViewport);
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
  vi.useRealTimers(); vi.unstubAllGlobals();
});
function attached() {
  const surface = new Surface();
  const publish = vi.fn();
  const cleanup = attachCollaborationCursor(surface as unknown as HTMLElement, publish);
  cleanups.push(cleanup);
  return { surface, publish, cleanup };
}

describe("native collaborative cursor publication", () => {
  it("throttles fast pointer frames and converts the latest point with canvas offset, pan and zoom", () => {
    const { surface, publish } = attached();
    useViewportStore.getState().setViewport({ x: 20, y: 30, zoom: 2 });
    for (let index = 0; index < 20; index++) surface.move(181 + index, 150);
    expect(publish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(publish).toHaveBeenCalledExactlyOnceWith({ x: 40, y: 35 }, []);
    vi.advanceTimersByTime(1000);
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it("uses the currently painted transform during a pan before the viewport store commits", () => {
    vi.stubGlobal("DOMMatrixReadOnly", class { a = 2; e = 60; f = 40; });
    const { surface, publish } = attached();
    surface.transform = "translate(60px, 40px) scale(2)";
    surface.move(200, 150);
    vi.advanceTimersByTime(100);
    expect(publish).toHaveBeenCalledWith({ x: 20, y: 30 }, []);
  });
  it("publishes bounded selection changes without duplicating editor selection state", () => {
    const { publish } = attached();
    useSelectionStore.getState().setSelection(Array.from({ length: 105 }, (_, index) => `object-${index}`));
    vi.advanceTimersByTime(100);
    expect(publish.mock.calls[0][0]).toBeNull();
    expect(publish.mock.calls[0][1]).toHaveLength(100);
    expect(useSelectionStore.getState().selectedIds.size).toBe(105);
  });
  it("clears published cursors on leaving the canvas or hiding the document", () => {
    const { surface, publish } = attached();
    surface.move(200, 150); vi.advanceTimersByTime(100);
    surface.dispatchEvent(new Event("pointerleave")); vi.advanceTimersByTime(100);
    expect(publish).toHaveBeenLastCalledWith(null, []);
    surface.move(200, 150); vi.advanceTimersByTime(100);
    doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); vi.advanceTimersByTime(100);
    expect(publish).toHaveBeenLastCalledWith(null, []);
  });
  it("removes listeners, selection subscriptions and pending publications on cleanup", () => {
    const { surface, publish, cleanup } = attached();
    surface.move(200, 150); cleanup();
    surface.move(500, 500); useSelectionStore.getState().selectOnly("extra");
    vi.advanceTimersByTime(500);
    expect(publish).not.toHaveBeenCalled();
  });
  it("assigns a stable participant color from a bounded readable palette", () => {
    expect(collaborationColor("client-a")).toBe(collaborationColor("client-a"));
    expect(collaborationColor("client-a")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
