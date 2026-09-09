import { describe, expect, it } from "vitest";
import { createCardObject } from "../canvas/objects/objectFactories";
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
});
