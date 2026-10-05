import { afterEach, describe, expect, it } from "vitest";
import { useBoardStore } from "./boardStore";
import { useDocumentStore } from "./documentStore";
import { createCardObject } from "../canvas/objects/objectFactories";

const initial = useBoardStore.getState();
afterEach(() => { useBoardStore.setState(initial); useDocumentStore.getState().loadDocument({}); });
describe("local tab ownership and server access", () => {
  it("cannot grant edits through a role update while another tab owns the board", () => {
    useBoardStore.getState().setTabReadOnly(true);
    useBoardStore.getState().setAccessRole("owner");
    expect(useBoardStore.getState().readOnly).toBe(true);
    useBoardStore.getState().setTabReadOnly(false);
    expect(useBoardStore.getState().readOnly).toBe(false);
  });
  it("does not grant viewer or revoked users edits when local ownership is regained", () => {
    for (const role of ["viewer", "none"] as const) {
      useBoardStore.getState().setTabReadOnly(true);
      useBoardStore.getState().setAccessRole(role);
      useBoardStore.getState().setTabReadOnly(false);
      expect(useBoardStore.getState().readOnly).toBe(true);
    }
  });
  it("blocks title, object and undo mutations while preserving the current snapshot", () => {
    useBoardStore.getState().setAccessRole(null);
    const card = createCardObject({ x: 1, y: 2 }, 1);
    useDocumentStore.getState().addObject(card);
    const snapshot = useDocumentStore.getState().objects;
    const title = useBoardStore.getState().title;
    useBoardStore.getState().setTabReadOnly(true);
    useBoardStore.getState().setTitle("stale title");
    useDocumentStore.getState().updateObject(card.id, { x: 100 });
    useDocumentStore.getState().undo();
    expect(useDocumentStore.getState().objects).toBe(snapshot);
    expect(useBoardStore.getState().title).toBe(title);
  });
});
