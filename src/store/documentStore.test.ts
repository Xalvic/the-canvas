import { beforeEach, describe, expect, it } from "vitest";
import { createCardObject } from "../canvas/objects/objectFactories";
import { createConnectorObject } from "../canvas/connectors/connectorFactories";
import { isCanvasNodeObject } from "../canvas/objects/types";
import { createStrokeObject } from "../canvas/strokes/strokeFactories";
import { useBoardStore } from "./boardStore";
import {
  MAX_HISTORY_ENTRIES,
  useDocumentStore,
} from "./documentStore";

function resetDocumentStore() {
  useBoardStore.getState().setAccessRole(null);
  useDocumentStore.setState({ objects: {}, past: [], future: [], historyError: null });
}

describe("collaborative history", () => {
  beforeEach(resetDocumentStore);
  const first = { ...createCardObject({ x: 10, y: 20 }, 1), id: "first" };
  const second = { ...createCardObject({ x: 50, y: 60 }, 2), id: "second" };

  it("preserves disjoint remote creates and edits through undo and redo without recording remote history", () => {
    const store = useDocumentStore.getState();
    store.loadDocument({ first, second });
    store.updateObject(first.id, { title: "Local title" });
    const edited = useDocumentStore.getState().objects.first;
    const remoteSecond = { ...second, title: "Remote title", updatedAt: second.updatedAt + 10 };
    const third = { ...second, id: "third" };
    const history = useDocumentStore.getState().past;
    store.applyRemoteDocument({ first: structuredClone(edited), second: remoteSecond, third });
    expect(useDocumentStore.getState().past).toBe(history);
    store.undo();
    expect(useDocumentStore.getState().objects).toEqual({ first, second: remoteSecond, third });
    const laterSecond = { ...remoteSecond, body: "Later remote edit" };
    store.applyRemoteDocument({ first, second: laterSecond, third });
    store.redo();
    expect(useDocumentStore.getState().objects).toEqual({ first: edited, second: laterSecond, third });
    expect(useDocumentStore.getState().historyError).toBeNull();
  });

  it("blocks a multi-object inverse atomically if any touched object changed remotely", () => {
    const store = useDocumentStore.getState();
    store.loadDocument({ first, second });
    store.updateObjectPositions({ first: { x: 200, y: 250 }, second: { x: 350, y: 450 } });
    const current = useDocumentStore.getState().objects;
    store.applyRemoteDocument({ ...current, first: { ...current.first, updatedAt: Date.now() + 1 } });
    const before = useDocumentStore.getState();
    store.undo();
    const after = useDocumentStore.getState();
    expect(after.objects).toBe(before.objects);
    expect(after.past).toBe(before.past);
    expect(after.future).toBe(before.future);
    expect(after.historyError).toContain("Undo blocked");
  });

  it("blocks redo when the undone object's current value changed remotely", () => {
    const store = useDocumentStore.getState();
    store.loadDocument({ first, second });
    store.updateObject(first.id, { title: "Local edit" });
    store.undo();
    store.applyRemoteDocument({ first: { ...first, body: "Remote change" }, second });
    const before = useDocumentStore.getState();
    store.redo();
    expect(useDocumentStore.getState().objects).toBe(before.objects);
    expect(useDocumentStore.getState().future).toBe(before.future);
    expect(useDocumentStore.getState().historyError).toContain("Redo blocked");
  });

  it("compares equivalent remote object fields structurally instead of key insertion order", () => {
    const store = useDocumentStore.getState();
    store.loadDocument({ first });
    store.updateObject(first.id, { title: "Local edit" });
    const edited = useDocumentStore.getState().objects.first;
    const reordered = Object.fromEntries(Object.entries(edited).reverse()) as typeof edited;
    store.applyRemoteDocument({ first: reordered });
    store.undo();
    expect(useDocumentStore.getState().objects.first).toEqual(first);
  });

  it("preserves a remote connector by blocking removal of its locally created endpoint", () => {
    const store = useDocumentStore.getState();
    store.loadDocument({ second });
    store.addObject(first);
    const connector = { ...createConnectorObject({ objectId: first.id, anchor: "right" }, { objectId: second.id, anchor: "left" }, 3), id: "remote-link" };
    store.applyRemoteDocument({ first, second, [connector.id]: connector });
    const before = useDocumentStore.getState().objects;
    store.undo();
    expect(useDocumentStore.getState().objects).toBe(before);
    expect(useDocumentStore.getState().historyError).toContain("Undo blocked");
  });

  it("does not restore a connector when its other endpoint was remotely deleted", () => {
    const store = useDocumentStore.getState();
    const connector = { ...createConnectorObject({ objectId: first.id, anchor: "right" }, { objectId: second.id, anchor: "left" }, 3), id: "link" };
    store.loadDocument({ first, second, link: connector });
    store.deleteObjects([first.id]);
    store.applyRemoteDocument({});
    store.undo();
    expect(useDocumentStore.getState().objects).toEqual({});
    expect(useDocumentStore.getState().historyError).toContain("Undo blocked");
  });
  it("restores valid special object IDs as own entries during a selective inverse", () => {
    const store = useDocumentStore.getState();
    const special = { ...first, id: "__proto__" };
    store.loadDocument(Object.fromEntries([[special.id, special], [second.id, second]]));
    store.deleteObjects([special.id]);
    store.applyRemoteDocument({ second: { ...second, body: "Remote edit" } });
    store.undo();
    expect(Object.hasOwn(useDocumentStore.getState().objects, special.id)).toBe(true);
    expect(useDocumentStore.getState().objects[special.id]).toEqual(special);
    expect(Object.getPrototypeOf(useDocumentStore.getState().objects)).toBe(Object.prototype);
  });
});

function getNodeX(id: string): number {
  const object = useDocumentStore.getState().objects[id];
  if (!object || !isCanvasNodeObject(object)) {
    throw new Error(`Expected ${id} to be a canvas node`);
  }
  return object.x;
}

describe("document history", () => {
  beforeEach(resetDocumentStore);

  it("blocks every durable mutation and history replay for a viewer while allowing snapshot loading", () => {
    const card = { ...createCardObject({ x: 100, y: 100 }, 1), id: "card-1" };
    const store = useDocumentStore.getState();
    store.addObject(card); store.updateObject(card.id, { body: "Edited" }); store.undo();
    const before = useDocumentStore.getState();
    useBoardStore.getState().setAccessRole("viewer");
    store.addObject({ ...card, id: "extra" });
    store.updateObject(card.id, { body: "Forbidden" });
    store.updateObjectPositions({ [card.id]: { x: 300, y: 500 } });
    store.setObjectGroup([card.id], "group"); store.deleteObjects([card.id]); store.undo(); store.redo();
    expect(useDocumentStore.getState()).toBe(before);
    store.loadDocument({ [card.id]: card });
    expect(useDocumentStore.getState().objects[card.id]).toEqual(card);
    useBoardStore.getState().setAccessRole(null);
    store.updateObject(card.id, { body: "Guest edit" });
    expect(useDocumentStore.getState().objects[card.id]).toMatchObject({ body: "Guest edit" });
  });

  it("undoes and redoes meaningful document mutations", () => {
    const card = { ...createCardObject({ x: 100, y: 100 }, 1), id: "card-1" };
    const store = useDocumentStore.getState();

    store.addObject(card);
    useDocumentStore
      .getState()
      .updateObjectPositions({ [card.id]: { x: 240, y: 180 } });
    expect(getNodeX(card.id)).toBe(240);
    expect(useDocumentStore.getState().past).toHaveLength(2);

    useDocumentStore.getState().undo();
    expect(getNodeX(card.id)).toBe(card.x);
    expect(useDocumentStore.getState().future.at(-1)?.label).toBe(
      "Move selection",
    );

    useDocumentStore.getState().redo();
    expect(getNodeX(card.id)).toBe(240);
  });

  it("does not record no-op updates", () => {
    const card = { ...createCardObject({ x: 100, y: 100 }, 1), id: "card-1" };
    useDocumentStore.getState().addObject(card);
    useDocumentStore.getState().clearHistory();

    useDocumentStore
      .getState()
      .updateObjectPositions({ [card.id]: { x: card.x, y: card.y } });
    useDocumentStore.getState().updateObject(card.id, { title: card.title });

    expect(useDocumentStore.getState().past).toHaveLength(0);
  });

  it("loads a saved document without retaining session history", () => {
    const first = { ...createCardObject({ x: 100, y: 100 }, 1), id: "first" };
    const restored = {
      ...createCardObject({ x: 320, y: 220 }, 2),
      id: "restored",
    };
    useDocumentStore.getState().addObject(first);

    useDocumentStore.getState().loadDocument({ [restored.id]: restored });

    expect(useDocumentStore.getState().objects).toEqual({
      [restored.id]: restored,
    });
    expect(useDocumentStore.getState().past).toEqual([]);
    expect(useDocumentStore.getState().future).toEqual([]);
  });

  it("clears the redo branch after a new edit", () => {
    const card = { ...createCardObject({ x: 100, y: 100 }, 1), id: "card-1" };
    useDocumentStore.getState().addObject(card);
    useDocumentStore.getState().updateObject(card.id, { title: "First edit" });
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().future).toHaveLength(1);

    useDocumentStore.getState().updateObject(card.id, { body: "New branch" });
    expect(useDocumentStore.getState().future).toHaveLength(0);
  });

  it("caps retained history entries", () => {
    const card = { ...createCardObject({ x: 100, y: 100 }, 1), id: "card-1" };
    useDocumentStore.getState().addObject(card);
    useDocumentStore.getState().clearHistory();

    for (let index = 0; index < MAX_HISTORY_ENTRIES + 7; index += 1) {
      useDocumentStore.getState().updateObject(card.id, { title: `Edit ${index}` });
    }

    expect(useDocumentStore.getState().past).toHaveLength(MAX_HISTORY_ENTRIES);
  });

  it("deletes attached connectors with a node and restores both on undo", () => {
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
    useDocumentStore.getState().clearHistory();

    useDocumentStore.getState().deleteObjects([first.id]);
    expect(Object.keys(useDocumentStore.getState().objects).sort()).toEqual([
      second.id,
    ]);
    expect(useDocumentStore.getState().past).toHaveLength(1);

    useDocumentStore.getState().undo();
    expect(Object.keys(useDocumentStore.getState().objects).sort()).toEqual(
      [connector.id, first.id, second.id].sort(),
    );
  });

  it("groups and ungroups spatial objects as single history entries", () => {
    const first = { ...createCardObject({ x: 100, y: 100 }, 1), id: "first" };
    const second = { ...createCardObject({ x: 500, y: 100 }, 2), id: "second" };
    useDocumentStore.getState().addObjects([first, second]);
    useDocumentStore.getState().clearHistory();

    useDocumentStore
      .getState()
      .setObjectGroup([first.id, second.id], "group-1");
    expect(useDocumentStore.getState().objects[first.id].groupId).toBe(
      "group-1",
    );
    expect(useDocumentStore.getState().objects[second.id].groupId).toBe(
      "group-1",
    );
    expect(useDocumentStore.getState().past).toHaveLength(1);

    useDocumentStore
      .getState()
      .setObjectGroup([first.id, second.id], null, "Ungroup objects");
    expect(useDocumentStore.getState().objects[first.id].groupId).toBeUndefined();
    expect(useDocumentStore.getState().past).toHaveLength(2);

    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().objects[first.id].groupId).toBe(
      "group-1",
    );
  });

  it("moves stroke bounds and world points in one history entry", () => {
    const stroke = {
      ...createStrokeObject(
        [
          { x: 10, y: 20, pressure: 0.5 },
          { x: 40, y: 60, pressure: 0.5 },
        ],
        1,
      ),
      id: "stroke",
    };
    useDocumentStore.getState().addObject(stroke);
    useDocumentStore.getState().clearHistory();

    useDocumentStore.getState().updateObjectPositions({
      [stroke.id]: { x: stroke.x + 25, y: stroke.y - 15 },
    });
    const moved = useDocumentStore.getState().objects[stroke.id];
    expect(moved).toMatchObject({ x: stroke.x + 25, y: stroke.y - 15 });
    if (moved.type !== "stroke") throw new Error("Expected a stroke");
    expect(moved.points).toEqual([
      { x: 35, y: 5, pressure: 0.5 },
      { x: 65, y: 45, pressure: 0.5 },
    ]);
    expect(useDocumentStore.getState().past).toHaveLength(1);

    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().objects[stroke.id]).toEqual(stroke);
  });
});
