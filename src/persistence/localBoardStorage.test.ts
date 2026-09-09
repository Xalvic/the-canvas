import { describe, expect, it } from "vitest";
import {
  createCardObject,
  createImageObject,
  createTextObject,
} from "../canvas/objects/objectFactories";
import { createStrokeObject } from "../canvas/strokes/strokeFactories";
import { DEFAULT_PEN_SETTINGS, DEFAULT_TEXT_SETTINGS } from "../tools/toolSettings";
import {
  CURRENT_BOARD_ID,
  LOCAL_BOARD_SCHEMA_VERSION,
  parseLocalBoard,
  type LocalBoardRecord,
} from "./localBoardStorage";

function validBoard(): LocalBoardRecord {
  const card = {
    ...createCardObject({ x: 100, y: 120 }, 1),
    id: "card-1",
  };
  return {
    schemaVersion: LOCAL_BOARD_SCHEMA_VERSION,
    id: CURRENT_BOARD_ID,
    title: "Product ideas",
    objects: { [card.id]: card },
    viewport: { x: 640, y: 400, zoom: 1 },
    createdAt: 10,
    updatedAt: 20,
  };
}

describe("local board format", () => {
  it("round trips new appearance data alongside legacy objects without a schema migration", () => {
    const board = validBoard();
    const text = createTextObject({ x: 0, y: 0 }, 1, { ...DEFAULT_TEXT_SETTINGS, size: "xl", weight: "bold", align: "right", opacity: 0 });
    const stroke = createStrokeObject([{ x: 0, y: 0, pressure: 0.4, velocity: 1.2, widthRatio: 0.35 }], 2, { ...DEFAULT_PEN_SETTINGS, size: "xl", color: "#dc4545", opacity: 0.4 });
    const legacyText = { ...text, id: "legacy-text" };
    delete legacyText.color; delete legacyText.fontSize; delete legacyText.fontWeight;
    delete legacyText.textAlign; delete legacyText.opacity;
    const legacyStroke = { ...stroke, id: "legacy-stroke", points: [{ x: 0, y: 0, pressure: 0.5 }] };
    delete legacyStroke.mode; delete legacyStroke.opacity;
    for (const object of [text, stroke, legacyText, legacyStroke]) board.objects[object.id] = object;
    expect(parseLocalBoard(JSON.parse(JSON.stringify(board)))).toEqual(board);
  });

  it("rejects invalid appearance values without rejecting missing legacy fields", () => {
    const stroke = createStrokeObject([{ x: 0, y: 0 }], 1);
    const board = { ...validBoard(), objects: { [stroke.id]: stroke } };
    expect(parseLocalBoard(board)).not.toBeNull();
    for (const opacity of [-0.1, 1.1, NaN, "50%"])
      expect(parseLocalBoard({ ...board, objects: { [stroke.id]: { ...stroke, opacity } } })).toBeNull();
  });
  it("accepts a complete current-schema board", () => {
    const board = validBoard();
    expect(parseLocalBoard(board)).toBe(board);
  });

  it("rejects unsupported schemas and invalid object maps", () => {
    expect(parseLocalBoard({ ...validBoard(), schemaVersion: 2 })).toBeNull();
    expect(
      parseLocalBoard({
        ...validBoard(),
        objects: { "wrong-key": validBoard().objects["card-1"] },
      }),
    ).toBeNull();
  });

  it("rejects invalid persisted viewports", () => {
    expect(
      parseLocalBoard({ ...validBoard(), viewport: { x: 0, y: 0, zoom: 0 } }),
    ).toBeNull();
  });

  it("accepts image objects that reference separately stored assets", () => {
    const board = validBoard();
    const image = createImageObject({
      assetId: "asset-1",
      center: { x: 320, y: 240 },
      width: 320,
      height: 180,
      originalWidth: 1920,
      originalHeight: 1080,
      zIndex: 2,
    });
    board.objects[image.id] = image;

    expect(parseLocalBoard(board)).toBe(board);
  });
});
