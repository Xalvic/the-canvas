import type { SaveDocumentInput } from "../documents.js";

export function documentInput(expectedRevision = 0, title = "Ideas"): SaveDocumentInput {
  const base = { zIndex: 7, createdAt: 10, updatedAt: 20, groupId: "group-1" };
  const spatial = { ...base, x: -100.25, y: 80.5, width: 248, height: 172 };
  return {
    schemaVersion: 1,
    expectedRevision,
    content: { objects: [
      { ...base, id: "connection", type: "connector", from: { objectId: "note", anchor: "right" }, to: { objectId: "text", anchor: "left" }, directed: true },
      { ...spatial, id: "frame", type: "frame", title: "Section", moveContents: false },
      { ...spatial, id: "note", type: "card", title, body: "First sketch" },
      { ...spatial, id: "stroke", type: "stroke", points: [{ x: -99.5, y: 82, pressure: 0.4, widthRatio: 0.25, velocity: 1.2 }, { x: 145.75, y: 251 }], strokeWidth: 4, color: "#3f413d", mode: "solid", opacity: 0.4 },
      { ...spatial, id: "text", type: "text", text: "Hello", zIndex: -2, color: "#dc4545", fontSize: 36, fontWeight: 700, textAlign: "right", opacity: 0 },
    ] },
  };
}
