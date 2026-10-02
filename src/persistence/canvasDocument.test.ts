import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { CanvasObject, StrokeCanvasObject } from "../canvas/objects/types";
import { createImageObject } from "../canvas/objects/objectFactories";
import { useDocumentStore, type DocumentSnapshot } from "../store/documentStore";
import { useSelectionStore } from "../store/selectionStore";
import {
  CANVAS_DOCUMENT_LIMITS,
  canvasDocumentSchema,
} from "./canvasDocument";
import {
  deserializeCanvasDocument,
  serializeDocumentSnapshot,
} from "./canvasDocumentAdapters";
import { CURRENT_BOARD_ID, parseLocalBoard } from "./localBoardStorage";

const base = { zIndex: 7.5, createdAt: 10, updatedAt: 20, groupId: "group-1" };
const spatial = { ...base, x: -100.25, y: 80.5, width: 248, height: 172 };
const card = { ...spatial, id: "note-1", type: "card", title: "Ideas", body: "  First sketch\n🎨  " } as const;
const text = {
  ...spatial, id: "text-1", type: "text", zIndex: -2, text: "",
  color: "#dc4545", fontSize: 36, opacity: 0, fontWeight: 700, textAlign: "right",
} as const;
const frame = { ...spatial, id: "frame-1", type: "frame", title: "Section", moveContents: false } as const;
const stroke: StrokeCanvasObject = {
  ...spatial, id: "stroke-1", type: "stroke", strokeWidth: 4, color: "#3f413d",
  mode: "solid", opacity: 0.4,
  points: [
    { x: -99.5, y: 82, pressure: 0, widthRatio: 0.25, velocity: 0 },
    { x: 145.75, y: 251, pressure: 1, widthRatio: 1, velocity: 2.5 },
  ],
};
const connector = {
  ...base, id: "connector-1", type: "connector", directed: false,
  from: { objectId: card.id, anchor: "right" },
  to: { objectId: text.id, anchor: "left" },
} as const;
// A connector may precede its nodes; order deliberately differs from zIndex.
const objects: CanvasObject[] = [connector, frame, card, stroke, text];
const snapshot: DocumentSnapshot = Object.fromEntries(objects.map((object) => [object.id, object]));

function documentWith(items: unknown[] = objects) {
  return { schemaVersion: 1, content: { objects: items } };
}

function expectInvalid(value: unknown, path?: (string | number)[]) {
  const result = canvasDocumentSchema.safeParse(value);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("Expected an invalid document");
  if (path) expect(result.error.issues).toContainEqual(expect.objectContaining({ path }));
  expect(() => deserializeCanvasDocument(value)).toThrow(ZodError);
}

describe("canvas document v1", () => {
  it("round trips every non-image field through JSON, preserving map order and zIndex", () => {
    const serialized = serializeDocumentSnapshot(snapshot);
    expect(serialized).toEqual(documentWith());
    const restored = deserializeCanvasDocument(JSON.parse(JSON.stringify(serialized)));
    expect(restored).toEqual(snapshot);
    expect(Object.values(restored)).toEqual(objects);
    expect(serializeDocumentSnapshot(restored)).toEqual(serialized);
  });

  it("supports blank documents", () => {
    expect(serializeDocumentSnapshot({})).toEqual(documentWith([]));
    expect(deserializeCanvasDocument(documentWith([]))).toEqual({});
  });

  it("uses legacy rendering defaults without inventing point dynamics or mutating the source", () => {
    const legacyText = { ...spatial, id: "legacy-text", type: "text", text: "Legacy" } as const;
    const legacyStroke = {
      ...spatial, id: "legacy-stroke", type: "stroke", strokeWidth: 4,
      color: "#3f413d", points: [{ x: -25, y: 10 }, { x: 30, y: 20, pressure: 0.5 }],
    } as const;
    const input = documentWith([legacyText, legacyStroke]);
    const before = JSON.stringify(input);
    const restored = deserializeCanvasDocument(input);
    expect(restored[legacyText.id]).toEqual({
      ...legacyText, color: "#252622", fontSize: 17, fontWeight: 550,
      textAlign: "left", opacity: 1,
    });
    expect(restored[legacyStroke.id]).toEqual({ ...legacyStroke, mode: "draw", opacity: 1 });
    expect(JSON.stringify(input)).toBe(before);
    const canonical = serializeDocumentSnapshot(restored);
    expect(serializeDocumentSnapshot(deserializeCanvasDocument(canonical))).toEqual(canonical);
  });

  it("returns independent objects, points and endpoints", () => {
    const serialized = serializeDocumentSnapshot(snapshot);
    const restored = deserializeCanvasDocument(serialized);
    expect(restored[card.id]).not.toBe(snapshot[card.id]);
    const restoredStroke = restored[stroke.id];
    const restoredConnector = restored[connector.id];
    if (restoredStroke.type !== "stroke" || restoredConnector.type !== "connector") throw new Error("Wrong types");
    restoredStroke.points[0].x = 999;
    restoredConnector.from.anchor = "bottom";
    expect(stroke.points[0].x).toBe(-99.5);
    expect(connector.from.anchor).toBe("right");
    expect(serialized).toEqual(documentWith());
  });

  it.each([undefined, null, 0, 2, -1, 1.5, "1"])("rejects unsupported schema version %s", (schemaVersion) => {
    expectInvalid({ ...documentWith(), schemaVersion }, ["schemaVersion"]);
  });

  it.each([
    null, [], "{}", {}, { schemaVersion: 1 },
    { schemaVersion: 1, content: null },
    { schemaVersion: 1, content: { objects: {} } },
    { schemaVersion: 1, content: { objects: [null] } },
    { schemaVersion: 1, content: { objects: [42] } },
    documentWith([{ ...card, type: "video" }]),
    documentWith([{ ...card, type: undefined }]),
  ])("rejects malformed envelopes and unsupported object formats %#", (input) => {
    expectInvalid(input);
  });

  it.each([
    { ...documentWith(), revision: 1 },
    { schemaVersion: 1, content: { objects, viewport: { x: 0, y: 0, zoom: 1 } } },
    documentWith([{ ...card, futureField: "Keep me" }]),
    documentWith([{ ...stroke, points: [{ x: 0, y: 0, futureField: 1 }] }]),
    documentWith([{ ...connector, from: { ...connector.from, futureField: 1 } }, card, text]),
  ])("rejects unknown fields at every level instead of stripping them %#", (input) => {
    expectInvalid(input);
  });

  it.each([
    ["id", ""], ["id", "   "], ["id", 123],
    ["groupId", ""], ["groupId", null],
    ["x", NaN], ["x", Infinity], ["y", -Infinity], ["x", "100"],
    ["width", 0], ["width", -1], ["height", 0], ["height", -1],
    ["zIndex", Infinity], ["createdAt", -1], ["updatedAt", NaN],
    ["title", null], ["body", 42], ["body", undefined],
    ["id", "bad\0id"], ["groupId", "bad\uD800"],
    ["body", "bad\0text"], ["body", "bad\uD800"], ["body", "bad\uDC00"],
  ])("rejects malformed common/card field %s=%s", (field, value) => {
    expectInvalid(documentWith([{ ...card, [field]: value }]), ["content", "objects", 0, field as string]);
  });

  it.each([
    ["text", null], ["color", ""], ["color", 42], ["text", "bad\0text"], ["color", "bad\uD800"],
    ["fontSize", 0], ["fontSize", -1], ["fontSize", Infinity],
    ["fontWeight", 0], ["fontWeight", 1001], ["fontWeight", NaN],
    ["textAlign", "justify"], ["opacity", -0.1], ["opacity", 1.1],
    ["opacity", NaN], ["opacity", "50%"], ["opacity", null],
  ])("rejects malformed text field %s=%s", (field, value) => {
    expectInvalid(documentWith([{ ...text, [field]: value }]));
  });

  it.each([
    ["points", []], ["points", {}], ["strokeWidth", 0], ["strokeWidth", -1],
    ["strokeWidth", NaN], ["color", ""], ["mode", "brush"],
    ["opacity", -0.1], ["opacity", 1.1], ["opacity", Infinity],
  ])("rejects malformed stroke field %s=%s", (field, value) => {
    expectInvalid(documentWith([{ ...stroke, [field]: value }]));
  });

  it.each([
    ["x", NaN], ["y", Infinity], ["pressure", -0.1], ["pressure", 1.1],
    ["pressure", null], ["widthRatio", 0], ["widthRatio", -1],
    ["widthRatio", 1.1], ["widthRatio", NaN], ["velocity", -1], ["velocity", Infinity],
  ])("rejects malformed stroke point %s=%s", (field, value) => {
    expectInvalid(documentWith([{ ...stroke, points: [{ x: 0, y: 0, [field]: value }] }]));
  });

  it.each([undefined, null, "true", 1])("requires a boolean frame setting %s", (moveContents) => {
    expectInvalid(documentWith([{ ...frame, moveContents }]));
  });

  it("accepts inclusive appearance boundaries and positive dimensions", () => {
    for (const fontWeight of [1, 1000]) {
      expect(canvasDocumentSchema.parse(documentWith([
        { ...text, fontWeight, fontSize: 0.1, opacity: fontWeight === 1 ? 0 : 1, width: 0.1, height: 0.1 },
      ]))).toBeDefined();
    }
    expect(canvasDocumentSchema.parse(documentWith([stroke]))).toBeDefined();
  });

  it("rejects duplicate IDs before reconstructing a map", () => {
    expectInvalid(documentWith([card, { ...text, id: card.id }]), ["content", "objects", 1, "id"]);
    const duplicateMap = { first: card, second: card };
    expect(() => serializeDocumentSnapshot(duplicateMap)).toThrow("Duplicate object ID");
  });

  it.each(["from", "to"] as const)("validates the connector's %s reference", (end) => {
    for (const objectId of ["missing", frame.id, stroke.id, connector.id, "toString", "__proto__"]) {
      const invalidConnector = { ...connector, [end]: { ...connector[end], objectId } };
      expectInvalid(documentWith([invalidConnector, frame, card, stroke, text]), ["content", "objects", 0, end, "objectId"]);
    }
  });

  it.each(["top", "right", "bottom", "left"])("accepts valid connector anchor %s", (anchor) => {
    expect(canvasDocumentSchema.parse(documentWith([
      { ...connector, from: { ...connector.from, anchor }, to: { ...connector.to, anchor } }, card, text,
    ]))).toBeDefined();
  });

  it("rejects invalid endpoints, direction values and self-connections", () => {
    for (const anchor of [null, "center", 1]) {
      for (const end of ["from", "to"] as const) {
        expectInvalid(documentWith([{ ...connector, [end]: { ...connector[end], anchor } }, card, text]));
      }
    }
    expectInvalid(documentWith([{ ...connector, from: null }, card, text]));
    expectInvalid(documentWith([{ ...connector, directed: "true" }, card, text]));
    expectInvalid(documentWith([{ ...connector, to: { ...connector.to, objectId: card.id } }, card, text]));
  });

  it("explicitly rejects a mixed image document while the guest format still accepts it", () => {
    const image = createImageObject({
      assetId: "device-local-asset", center: { x: 0, y: 0 }, width: 320, height: 180,
      originalWidth: 1920, originalHeight: 1080, zIndex: 8,
    });
    const mixedSnapshot = { ...snapshot, [image.id]: image };
    const before = JSON.stringify(mixedSnapshot);
    expect(() => serializeDocumentSnapshot(mixedSnapshot)).toThrow("Image-containing documents are unsupported");
    expect(() => deserializeCanvasDocument(documentWith([...objects, image]))).toThrow("durable asset storage");
    expect(() => deserializeCanvasDocument(documentWith([{ type: "image" }]))).toThrow("durable asset storage");
    expect(JSON.stringify(mixedSnapshot)).toBe(before);
    const guestBoard = {
      schemaVersion: 1, id: CURRENT_BOARD_ID, title: "Guest", objects: mixedSnapshot,
      viewport: { x: 10, y: 20, zoom: 2 }, createdAt: 10, updatedAt: 20,
    };
    expect(parseLocalBoard(guestBoard)).toBe(guestBoard);
  });

  it("requires snapshot keys to match IDs and rejects non-map input", () => {
    expect(() => serializeDocumentSnapshot({ wrong: card })).toThrow("Snapshot map key must match");
    for (const input of [null, [], 1, "{}", new Date(), new Map(), { [card.id]: null }]) {
      expect(() => serializeDocumentSnapshot(input as unknown as DocumentSnapshot)).toThrow(ZodError);
    }
  });

  it("safely preserves special property IDs", () => {
    const specialObjects = ["__proto__", "constructor", "toString"].map((id) => ({ ...card, id }));
    const restored = deserializeCanvasDocument(documentWith(specialObjects));
    expect(Object.getPrototypeOf(restored)).toBe(Object.prototype);
    expect(Object.values(restored)).toEqual(specialObjects);
    for (const object of specialObjects) expect(Object.hasOwn(restored, object.id)).toBe(true);
    expect(serializeDocumentSnapshot(restored)).toEqual(documentWith(specialObjects));
  });

  it("preserves representable numeric ID order and rejects orders a record cannot represent", () => {
    const items = ["2", "10", "note"].map((id) => ({ ...card, id }));
    const restored = deserializeCanvasDocument(documentWith(items));
    expect(Object.keys(restored)).toEqual(["2", "10", "note"]);
    expect(serializeDocumentSnapshot(restored)).toEqual(documentWith(items));
    expectInvalid(documentWith([items[1], items[0], items[2]]));
    expectInvalid(documentWith([items[2], items[0], items[1]]));
  });

  it("enforces object count at the boundary", () => {
    const items = Array.from({ length: CANVAS_DOCUMENT_LIMITS.objects }, (_, index) => ({ ...card, id: `card-${index}` }));
    expect(canvasDocumentSchema.safeParse(documentWith(items)).success).toBe(true);
    expectInvalid(documentWith([...items, { ...card, id: "one-too-many" }]));
  });

  it("enforces total stroke points across strokes as well as per-stroke limits", () => {
    const half = Array.from({ length: CANVAS_DOCUMENT_LIMITS.strokePoints / 2 }, () => ({ x: 0, y: 0 }));
    const first = { ...stroke, id: "first", points: half };
    const second = { ...stroke, id: "second", points: half };
    expect(canvasDocumentSchema.safeParse(documentWith([first, second])).success).toBe(true);
    expectInvalid(documentWith([first, { ...second, points: [...half, { x: 1, y: 1 }] }]));
    expectInvalid(documentWith([{ ...stroke, points: [...half, ...half, { x: 1, y: 1 }] }]));
  });

  it("enforces string limits without truncating accepted strings", () => {
    const atLimit = { ...card, id: "i".repeat(CANVAS_DOCUMENT_LIMITS.idLength), body: "t".repeat(CANVAS_DOCUMENT_LIMITS.textLength) };
    expect(deserializeCanvasDocument(documentWith([atLimit]))[atLimit.id]).toEqual(atLimit);
    expectInvalid(documentWith([{ ...atLimit, id: `${atLimit.id}i` }]));
    expectInvalid(documentWith([{ ...atLimit, body: `${atLimit.body}t` }]));
    expectInvalid(documentWith([{ ...text, color: "c".repeat(CANVAS_DOCUMENT_LIMITS.colorLength + 1) }]));
  });

  it("leaves editor content, undo/redo stacks and selection untouched on success or failure", () => {
    const initialDocument = useDocumentStore.getState();
    const initialSelection = useSelectionStore.getState();
    try {
      useDocumentStore.setState({ objects: {}, past: [], future: [] });
      useDocumentStore.getState().addObjects(objects);
      useDocumentStore.getState().updateObject(card.id, { title: "Edit" });
      useDocumentStore.getState().undo();
      useSelectionStore.getState().selectOnly(card.id);
      const documentState = useDocumentStore.getState();
      const selectionState = useSelectionStore.getState();
      const serialized = serializeDocumentSnapshot(documentState.objects);
      deserializeCanvasDocument(serialized);
      expectInvalid(documentWith([card, card]));
      expect(useDocumentStore.getState()).toBe(documentState);
      expect(useSelectionStore.getState()).toBe(selectionState);
      expect(documentState.past).toHaveLength(1);
      expect(documentState.future).toHaveLength(1);
      useDocumentStore.getState().redo();
      expect(useDocumentStore.getState().objects[card.id]).toMatchObject({ title: "Edit" });
    } finally {
      useDocumentStore.setState(initialDocument, true);
      useSelectionStore.setState(initialSelection, true);
    }
  });
});
