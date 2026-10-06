import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCardObject,
  createImageObject,
  createTextObject,
} from "../canvas/objects/objectFactories";
import { createStrokeObject } from "../canvas/strokes/strokeFactories";
import { DEFAULT_PEN_SETTINGS, DEFAULT_TEXT_SETTINGS } from "../tools/toolSettings";
import {
  accountBoardStorageId,
  CURRENT_BOARD_ID,
  LOCAL_BOARD_SCHEMA_VERSION,
  parseLocalBoard,
  loadLocalBoard,
  type AccountBoardLink,
  type LocalBoardRecord,
} from "./localBoardStorage";
import { serializeDocumentSnapshot } from "./canvasDocumentAdapters";

const database = vi.hoisted(() => ({ open: vi.fn(), get: vi.fn() }));
vi.mock("./database", () => ({
  BOARD_STORE_NAME: "boards",
  openCanvasDatabase: database.open,
  requestResult: async (request: { result: unknown }) => request.result,
}));

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

function accountBoard(): LocalBoardRecord & { account: AccountBoardLink } {
  const board = validBoard();
  return {
    ...board,
    id: accountBoardStorageId("owner-1", "board-1"),
    account: {
      ownerId: "owner-1",
      boardId: "board-1",
      revision: 2,
      savedDocument: serializeDocumentSnapshot(board.objects),
      savedTitle: "Previously saved title",
    },
  };
}

describe("local board format", () => {
  it("round trips mixed renderer versions and rejects malformed new profiles", () => {
    const legacy = createStrokeObject([{ x: 0, y: 0, pressure: 0.4, widthRatio: 0.3 }], 1);
    const modern = createStrokeObject([{ x: 0, y: 20, pressure: 0.1, inkPressure: 0.25 }], 2, DEFAULT_PEN_SETTINGS, "pen");
    const board = { ...validBoard(), objects: { [legacy.id]: legacy, [modern.id]: modern } };
    expect(parseLocalBoard(JSON.parse(JSON.stringify(board)))).toEqual(board);
    for (const updates of [
      { rendererVersion: 3 }, { inputKind: "stylus" }, { inputKind: undefined },
      { points: [{ x: 0, y: 0, inkPressure: 2 }] }, { points: [{ x: 0, y: 0 }] },
    ]) expect(parseLocalBoard({ ...board, objects: { [modern.id]: { ...modern, ...updates } } })).toBeNull();
  });
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

  it("persists cloud image provenance and rejects malformed provenance", () => {
    const board = validBoard();
    const image = createImageObject({
      assetId: "11111111-1111-4111-8111-111111111111",
      center: { x: 0, y: 0 }, width: 320, height: 180,
      originalWidth: 1920, originalHeight: 1080, zIndex: 2,
    });
    image.cloudAsset = { boardId: "board-1", assetId: image.assetId };
    board.objects[image.id] = image;
    expect(parseLocalBoard(JSON.parse(JSON.stringify(board)))).toEqual(board);
    for (const cloudAsset of [
      null, {}, { boardId: "", assetId: image.assetId },
      { boardId: "board-1", assetId: "local-id" },
      { ...image.cloudAsset, url: "https://example.com/signed" },
    ]) {
      expect(parseLocalBoard({ ...board, objects: { [image.id]: { ...image, cloudAsset } } })).toBeNull();
    }
  });

  it("preserves account save baselines with strict cloud image references", () => {
    const board = accountBoard();
    const image = createImageObject({
      assetId: "local-image", center: { x: 0, y: 0 }, width: 320, height: 180,
      originalWidth: 1920, originalHeight: 1080, zIndex: 2,
    });
    board.objects[image.id] = image;
    board.account.imageAssets = { [image.assetId]: "11111111-1111-4111-8111-111111111111" };
    board.account.savedDocument = serializeDocumentSnapshot(board.objects, {
      boardId: board.account.boardId,
      imageAssets: board.account.imageAssets,
    });
    board.account.pendingSave = { document: board.account.savedDocument, expectedRevision: 2 };
    expect(parseLocalBoard(JSON.parse(JSON.stringify(board)))).toEqual(board);
  });

  it("validates upload mappings and preserves special local asset keys", () => {
    const board = accountBoard();
    board.account.imageAssets = Object.fromEntries([
      ["__proto__", "11111111-1111-4111-8111-111111111111"],
      ["asset-1", "22222222-2222-4222-8222-222222222222"],
    ]);
    const restored = parseLocalBoard(JSON.parse(JSON.stringify(board)));
    expect(restored).toEqual(board);
    expect(Object.hasOwn(restored!.account!.imageAssets!, "__proto__")).toBe(true);
    for (const imageAssets of [
      null, [], { "asset-1": "local-id" }, { "asset-1": 42 },
      Object.fromEntries([["__proto__", "local-id"]]),
    ]) {
      expect(parseLocalBoard({ ...board, account: { ...board.account, imageAssets } })).toBeNull();
    }
  });

  it("keeps guest records free of account metadata", () => {
    const board = validBoard();
    const restored = parseLocalBoard(JSON.parse(JSON.stringify(board)));
    expect(restored).toEqual(board);
    expect(restored).not.toHaveProperty("account");
  });

  it("round trips account save baselines and pending requests without changing the local schema", () => {
    const board = accountBoard();
    board.account.pendingSave = {
      document: serializeDocumentSnapshot(board.objects),
      expectedRevision: board.account.revision,
    };
    expect(parseLocalBoard(JSON.parse(JSON.stringify(board)))).toEqual(board);
    expect(board.schemaVersion).toBe(1);
  });

  it("rejects malformed account metadata or unsupported baseline documents", () => {
    const board = accountBoard();
    for (const account of [
      null,
      { ...board.account, ownerId: " " },
      { ...board.account, boardId: "" },
      { ...board.account, revision: -1 },
      { ...board.account, revision: 1.5 },
      { ...board.account, savedTitle: 42 },
      { ...board.account, savedDocument: { schemaVersion: 2, content: { objects: [] } } },
      { ...board.account, savedDocument: { schemaVersion: 1, content: { objects: [{ type: "image" }] } } },
      { ...board.account, pendingSave: { document: board.account.savedDocument, expectedRevision: -1 } },
      { ...board.account, pendingSave: { document: {}, expectedRevision: 2 } },
    ]) {
      expect(parseLocalBoard({ ...board, account })).toBeNull();
    }
  });

  it("prevents account drafts from using the guest key or another owner's key", () => {
    const board = accountBoard();
    expect(parseLocalBoard({ ...board, id: CURRENT_BOARD_ID })).toBeNull();
    expect(parseLocalBoard({ ...board, id: accountBoardStorageId("owner-2", "board-1") })).toBeNull();
    expect(parseLocalBoard({ ...board, id: `${board.id}:recovery` })).toEqual({ ...board, id: `${board.id}:recovery` });
    expect(parseLocalBoard({ ...board, id: `${board.id}:other` })).toBeNull();
  });

  it("scopes storage keys by both account and board without delimiter collisions", () => {
    expect(accountBoardStorageId("owner-1", "board-1")).toBe(accountBoardStorageId("owner-1", "board-1"));
    expect(accountBoardStorageId("owner-1", "board-1")).not.toBe(accountBoardStorageId("owner-2", "board-1"));
    expect(accountBoardStorageId("owner:board", "one")).not.toBe(accountBoardStorageId("owner", "board:one"));
    expect(accountBoardStorageId("owner", "board:recovery")).not.toBe(`${accountBoardStorageId("owner", "board")}:recovery`);
  });
});

describe("loading local boards by identity", () => {
  beforeEach(() => {
    database.get.mockReset();
    database.open.mockReset();
    database.open.mockResolvedValue({
      transaction: (name: string, mode: string) => {
        expect(name).toBe("boards");
        expect(mode).toBe("readonly");
        return { objectStore: () => ({ get: database.get }) };
      },
    });
  });

  it("defaults to the unchanged guest board key", async () => {
    const board = validBoard();
    database.get.mockReturnValue({ result: board });
    await expect(loadLocalBoard()).resolves.toEqual(board);
    expect(database.get).toHaveBeenCalledWith(CURRENT_BOARD_ID);
  });

  it("loads only the requested account draft and treats missing drafts as absent", async () => {
    const board = accountBoard();
    database.get.mockReturnValue({ result: board });
    await expect(loadLocalBoard(board.id)).resolves.toEqual(board);
    expect(database.get).toHaveBeenCalledWith(board.id);
    database.get.mockReturnValue({ result: undefined });
    await expect(loadLocalBoard(accountBoardStorageId("owner-2", "board-1"))).resolves.toBeNull();
  });

  it("rejects an otherwise valid board returned under a different requested key", async () => {
    database.get.mockReturnValue({ result: validBoard() });
    await expect(loadLocalBoard("another-board")).rejects.toThrow("mismatched identity");
  });
});
