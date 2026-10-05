import { describe, expect, it } from "vitest";
import { createCardObject } from "../canvas/objects/objectFactories";
import { serializeDocumentSnapshot } from "./canvasDocumentAdapters";
import { documentChanges, mergeCollaborativeDocuments } from "./collaborationMerge";

const card = { ...createCardObject({ x: 0, y: 0 }, 1), id: "card-1", createdAt: 1, updatedAt: 1 };
const second = { ...card, id: "card-2" };
const document = (...objects: typeof card[]) => serializeDocumentSnapshot(Object.fromEntries(objects.map((object) => [object.id, object])));
describe("collaboration merge", () => {
  it("merges edits to independent objects and retains remote creations", () => {
    const base = document(card, second), local = document({ ...card, body: "Mine" }, second);
    const remote = document(card, { ...second, body: "Theirs" }, { ...card, id: "new" });
    expect(mergeCollaborativeDocuments(base, local, remote)).toEqual({ conflicts: [], document: document({ ...card, body: "Mine" }, { ...second, body: "Theirs" }, { ...card, id: "new" }) });
    expect(documentChanges(base, local)).toEqual([{ id: card.id, before: card, after: { ...card, body: "Mine" } }]);
  });
  it("preserves different changes to the same object as a conflict", () => {
    const result = mergeCollaborativeDocuments(document(card), document({ ...card, body: "Mine" }), document({ ...card, body: "Theirs" }));
    expect(result.conflicts).toEqual([card.id]);
    expect(result.document).toEqual(document({ ...card, body: "Mine" }));
  });
  it("converges identical edits, handles deletion, and rejects deletion versus edit", () => {
    const edited = document({ ...card, body: "Same" });
    expect(mergeCollaborativeDocuments(document(card), edited, edited).conflicts).toEqual([]);
    expect(mergeCollaborativeDocuments(document(card, second), document(second), document(card, { ...second, body: "Remote" })).document)
      .toEqual(document({ ...second, body: "Remote" }));
    expect(mergeCollaborativeDocuments(document(card), document(), edited).conflicts).toEqual([card.id]);
  });
});
