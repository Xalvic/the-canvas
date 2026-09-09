import { beforeEach, describe, expect, it } from "vitest";
import { createCardObject } from "../canvas/objects/objectFactories";
import { createConnectorObject } from "../canvas/connectors/connectorFactories";
import {
  isCanvasNodeObject,
  isConnectorObject,
} from "../canvas/objects/types";
import { createStrokeObject } from "../canvas/strokes/strokeFactories";
import { useClipboardStore } from "../store/clipboardStore";
import { useDocumentStore } from "../store/documentStore";
import { useSelectionStore } from "../store/selectionStore";
import {
  cloneCanvasObjects,
  copySelection,
  pasteClipboard,
} from "./clipboardCommands";

describe("internal clipboard", () => {
  beforeEach(() => {
    useDocumentStore.setState({ objects: {}, past: [], future: [] });
    useSelectionStore.setState({ selectedIds: new Set() });
    useClipboardStore.setState({ objects: [], pasteGeneration: 0 });
  });

  it("remaps IDs, timestamps, stacking order, and position", () => {
    const first = { ...createCardObject({ x: 100, y: 100 }, 1), id: "a" };
    const second = { ...createCardObject({ x: 400, y: 200 }, 2), id: "b" };
    const ids = ["clone-a", "clone-b"];
    const clones = cloneCanvasObjects(
      [first, second],
      28,
      8,
      () => ids.shift()!,
      12345,
    );

    expect(
      clones.filter(isCanvasNodeObject).map(({ id, x, y, zIndex }) => ({
        id,
        x,
        y,
        zIndex,
      })),
    ).toEqual([
      { id: "clone-a", x: first.x + 28, y: first.y + 28, zIndex: 8 },
      { id: "clone-b", x: second.x + 28, y: second.y + 28, zIndex: 9 },
    ]);
    expect(clones[0].createdAt).toBe(12345);
    expect(first.id).toBe("a");
  });

  it("copies and pastes a selection as one history entry", () => {
    const card = { ...createCardObject({ x: 100, y: 100 }, 1), id: "card-1" };
    useDocumentStore.getState().addObject(card);
    useDocumentStore.getState().clearHistory();
    useSelectionStore.getState().selectOnly(card.id);

    copySelection();
    pasteClipboard();

    const state = useDocumentStore.getState();
    const pasted = Object.values(state.objects).find(
      (object) => object.id !== card.id,
    );
    expect(pasted && isCanvasNodeObject(pasted)).toBe(true);
    if (!pasted || !isCanvasNodeObject(pasted)) {
      throw new Error("Expected a pasted canvas node");
    }
    expect(pasted).toMatchObject({ x: card.x + 28, y: card.y + 28 });
    expect(useSelectionStore.getState().selectedIds).toEqual(
      new Set([pasted!.id]),
    );
    expect(state.past).toHaveLength(1);
    expect(state.past[0].label).toBe("Paste objects");
  });

  it("offsets repeated pastes progressively", () => {
    const card = { ...createCardObject({ x: 100, y: 100 }, 1), id: "card-1" };
    useDocumentStore.getState().addObject(card);
    useSelectionStore.getState().selectOnly(card.id);
    copySelection();
    pasteClipboard();
    pasteClipboard();

    const positions = Object.values(useDocumentStore.getState().objects)
      .filter(isCanvasNodeObject)
      .map(({ x, y }) => ({ x, y }))
      .sort((a, b) => a.x - b.x);
    expect(positions).toEqual([
      { x: card.x, y: card.y },
      { x: card.x + 28, y: card.y + 28 },
      { x: card.x + 56, y: card.y + 56 },
    ]);
  });

  it("includes internal connectors and remaps both endpoints on paste", () => {
    const first = { ...createCardObject({ x: 100, y: 100 }, 1), id: "first" };
    const second = { ...createCardObject({ x: 500, y: 100 }, 2), id: "second" };
    const connector = {
      ...createConnectorObject(
        { objectId: first.id, anchor: "right" },
        { objectId: second.id, anchor: "left" },
        3,
      ),
      id: "connector",
    };
    useDocumentStore.getState().addObjects([first, second, connector]);
    useSelectionStore.getState().setSelection([first.id, second.id]);

    copySelection();
    expect(useClipboardStore.getState().objects).toHaveLength(3);
    pasteClipboard();

    const objects = Object.values(useDocumentStore.getState().objects);
    const pastedConnector = objects
      .filter(isConnectorObject)
      .find((object) => object.id !== connector.id);
    expect(pastedConnector).toBeDefined();
    expect(pastedConnector?.from.objectId).not.toBe(first.id);
    expect(pastedConnector?.to.objectId).not.toBe(second.id);
    expect(objects.find((object) => object.id === pastedConnector?.from.objectId))
      .toMatchObject({ x: first.x + 28, y: first.y + 28 });
    expect(objects.find((object) => object.id === pastedConnector?.to.objectId))
      .toMatchObject({ x: second.x + 28, y: second.y + 28 });
  });

  it("preserves a copied group while assigning it a new group identity", () => {
    const first = {
      ...createCardObject({ x: 100, y: 100 }, 1),
      id: "first",
      groupId: "original-group",
    };
    const second = {
      ...createCardObject({ x: 500, y: 100 }, 2),
      id: "second",
      groupId: "original-group",
    };
    const ids = ["clone-first", "clone-second", "clone-group"];

    const clones = cloneCanvasObjects(
      [first, second],
      28,
      3,
      () => ids.shift()!,
    );

    expect(clones.map((object) => object.groupId)).toEqual([
      "clone-group",
      "clone-group",
    ]);
    expect(clones[0].groupId).not.toBe(first.groupId);
  });

  it("offsets stroke bounds and every world-space point", () => {
    const stroke = {
      ...createStrokeObject(
        [
          { x: 10, y: 20, pressure: 0.4 },
          { x: 30, y: 60, pressure: 0.6 },
        ],
        1,
      ),
      id: "stroke",
    };
    const clones = cloneCanvasObjects(
      [stroke],
      28,
      2,
      () => "clone-stroke",
    );
    const clone = clones[0];
    if (clone.type !== "stroke") throw new Error("Expected a stroke clone");

    expect(clone).toMatchObject({
      id: "clone-stroke",
      x: stroke.x + 28,
      y: stroke.y + 28,
    });
    expect(clone.points).toEqual([
      { x: 38, y: 48, pressure: 0.4 },
      { x: 58, y: 88, pressure: 0.6 },
    ]);
  });
});
