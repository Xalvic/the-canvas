import { beforeEach, describe, expect, it } from "vitest";
import { createCardObject } from "../canvas/objects/objectFactories";
import { createConnectorObject } from "../canvas/connectors/connectorFactories";
import { isCanvasNodeObject } from "../canvas/objects/types";
import {
  MAX_HISTORY_ENTRIES,
  useDocumentStore,
} from "./documentStore";

function resetDocumentStore() {
  useDocumentStore.setState({ objects: {}, past: [], future: [] });
}

function getNodeX(id: string): number {
  const object = useDocumentStore.getState().objects[id];
  if (!object || !isCanvasNodeObject(object)) {
    throw new Error(`Expected ${id} to be a canvas node`);
  }
  return object.x;
}

describe("document history", () => {
  beforeEach(resetDocumentStore);

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
});
