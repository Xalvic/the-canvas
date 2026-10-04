import { expect, test, type Page } from "@playwright/test";
import type { CanvasObject, CardCanvasObject } from "../src/canvas/objects/types";
import type { BoardDocument } from "../server/documents";

const user = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", displayName: "Owner" };
const guest = { error: { code: "UNAUTHENTICATED", message: "Sign in to use account boards", details: { googleSignInEnabled: true } } };
const firstId = "22222222-2222-4222-8222-222222222222";
const secondId = "33333333-3333-4333-8333-333333333333";

type Metadata = { id: string; title: string; createdAt: number; updatedAt: number };
type SavedBoard = Metadata & { document: BoardDocument | null };
type Mutation = { method: string; path: string; body: any };

function note(id: string, title: string): CardCanvasObject {
  return { id, type: "card", title, body: "", x: 300, y: 450, width: 260, height: 150, zIndex: 1, createdAt: 1, updatedAt: 1 };
}

function savedBoard(id: string, title: string, objects: CanvasObject[] = [note(`note-${id}`, title)]): SavedBoard {
  return { id, title, createdAt: 1, updatedAt: 1, document: { boardId: id, schemaVersion: 1, revision: 1, updatedAt: 1, content: { objects } } };
}

async function mockAccount(page: Page, initial: SavedBoard[] = []) {
  const cloud = {
    signedIn: true,
    failSaves: false,
    conflictOnNextSave: false,
    mutations: [] as Mutation[],
    boards: new Map(initial.map((board) => [board.id, structuredClone(board)])),
    documentGate: null as Promise<void> | null,
    documentStarted: null as (() => void) | null,
  };
  let nextId = 4;
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: cloud.signedIn ? 200 : 401, json: cloud.signedIn ? { user } : guest }));
  await page.route("**/api/auth/logout", (route) => {
    cloud.signedIn = false;
    return route.fulfill({ status: 204 });
  });
  await page.route(/\/api\/boards(?:\/[^/?]+(?:\/document)?)?(?:\?.*)?$/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const body = ["POST", "PATCH", "PUT"].includes(method) ? request.postDataJSON() : null;
    if (method !== "GET") {
      expect(request.headers()["x-scribble-request"]).toBe("1");
      cloud.mutations.push({ method, path, body });
    }
    if (!cloud.signedIn) { await route.fulfill({ status: 401, json: guest }); return; }
    if (path === "/api/boards") {
      if (method === "GET") {
        await route.fulfill({ json: { boards: [...cloud.boards.values()].map(({ document: _document, ...board }) => board) } });
      } else if (method === "POST") {
        const id = `${String(nextId++).padStart(8, "0")}-4444-4444-8444-444444444444`;
        const board = { id, title: body.title, createdAt: 1, updatedAt: 1, document: null };
        cloud.boards.set(id, board);
        await route.fulfill({ status: 201, json: { board } });
      }
      return;
    }
    const [, , , id, documentPath] = path.split("/");
    const board = cloud.boards.get(id);
    if (!board) { await route.fulfill({ status: 404, json: { error: { code: "BOARD_NOT_FOUND", message: "Board not found" } } }); return; }
    if (documentPath === "document") {
      if (method === "GET") {
        cloud.documentStarted?.();
        if (cloud.documentGate) await cloud.documentGate;
        await route.fulfill(board.document ? { json: { document: board.document } } : { status: 404, json: { error: { code: "DOCUMENT_NOT_FOUND", message: "This board has no saved document" } } }).catch(() => {});
        return;
      }
      if (cloud.failSaves) { await route.fulfill({ status: 503, json: { error: { code: "SERVER_ERROR", message: "Account save temporarily unavailable" } } }); return; }
      if (cloud.conflictOnNextSave) {
        cloud.conflictOnNextSave = false;
        board.document = { boardId: id, schemaVersion: 1, revision: (board.document?.revision ?? 0) + 1, updatedAt: 2, content: { objects: [note("remote-change", "Changed on another device")] } };
      }
      const revision = board.document?.revision ?? 0;
      if (body.expectedRevision !== revision) {
        await route.fulfill({ status: 409, json: { error: { code: "REVISION_CONFLICT", message: "Document revision does not match", details: { currentRevision: revision } } } });
        return;
      }
      board.document = { boardId: id, schemaVersion: body.schemaVersion, revision: revision + 1, updatedAt: Date.now(), content: body.content };
      await route.fulfill({ status: revision === 0 ? 201 : 200, json: { document: board.document } });
      return;
    }
    if (method === "PATCH") {
      board.title = body.title;
      board.updatedAt = Date.now();
    } else if (method === "DELETE") {
      cloud.boards.delete(id);
      await route.fulfill({ status: 204 });
      return;
    }
    const { document: _document, ...metadata } = board;
    await route.fulfill({ json: { board: metadata } });
  });
  return cloud;
}

async function canvasState(page: Page) {
  return page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const { useViewportStore } = await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts");
    const { objects, past, future } = useDocumentStore.getState();
    return { objects, past, future, viewport: useViewportStore.getState().viewport };
  });
}

async function localBoard(page: Page) {
  return page.evaluate(async () => {
    const { loadLocalBoard } = await import(/* @vite-ignore */ "/scribble/src/persistence/localBoardStorage.ts");
    return loadLocalBoard();
  });
}

async function createNote(page: Page, title: string) {
  await page.getByRole("button", { name: "Note tool", exact: true }).click();
  await page.mouse.click(330, 500);
  await page.getByLabel("Card title", { exact: true }).fill(title);
  await page.keyboard.press("Escape");
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

async function editNote(page: Page, before: string, after: string) {
  await page.locator(".card-object-value").filter({ has: page.getByText(before, { exact: true }) }).dblclick();
  await page.getByLabel("Card title", { exact: true }).fill(after);
  await page.keyboard.press("Escape");
}

async function openBoard(page: Page, title: string) {
  await page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) }).getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByLabel("Board title")).toHaveValue(title);
}

function documentWrites(cloud: Awaited<ReturnType<typeof mockAccount>>) {
  return cloud.mutations.filter((mutation) => mutation.method === "PUT");
}

test("signing in lists owned boards without uploading or changing guest IndexedDB", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Account sketch")]);
  cloud.signedIn = false;
  await page.goto("/scribble/");
  await page.getByLabel("Board title").fill("Guest sketch");
  await createNote(page, "Kept on this device");
  await expect.poll(async () => (await localBoard(page))?.title).toBe("Guest sketch");
  const guestBoard = await localBoard(page);
  cloud.signedIn = true;
  await page.reload();
  await expect(page.getByText("Account sketch", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Board title")).toHaveValue("Guest sketch");
  expect((await canvasState(page)).objects).toEqual(guestBoard?.objects);
  expect(cloud.mutations).toEqual([]);
  expect(await localBoard(page)).toEqual(guestBoard);
});

test("explicit upload creates a copy, then saves committed edits with increasing revisions", async ({ page }) => {
  const cloud = await mockAccount(page);
  await page.goto("/scribble/");
  await page.getByLabel("Board title").fill("My local board");
  await createNote(page, "Local idea");
  const localObjects = (await canvasState(page)).objects;
  await page.getByRole("button", { name: "Upload local board", exact: true }).click();
  await expect(page.getByText("Saved to account", { exact: true })).toBeVisible();
  expect(cloud.mutations.filter((mutation) => mutation.method === "POST")).toHaveLength(1);
  expect(documentWrites(cloud)[0].body).toMatchObject({ expectedRevision: 0, schemaVersion: 1, content: { objects: Object.values(localObjects) } });
  const guestBoard = await localBoard(page);
  await page.getByText("Local idea", { exact: true }).dblclick();
  await page.getByLabel("Card title", { exact: true }).fill("Uncommitted note edit");
  await page.waitForTimeout(750);
  expect(documentWrites(cloud)).toHaveLength(1);
  await page.keyboard.press("Escape");
  await expect.poll(() => documentWrites(cloud).length).toBe(2);
  await expect(page.getByText("Saved to account", { exact: true })).toBeVisible();
  expect(documentWrites(cloud)[1].body).toMatchObject({ expectedRevision: 1, content: { objects: [expect.objectContaining({ title: "Uncommitted note edit" })] } });
  expect(await localBoard(page)).toEqual(guestBoard);
  await page.getByRole("button", { name: "Back to local board", exact: true }).click();
  expect((await canvasState(page)).objects).toEqual(localObjects);
  await page.reload();
  await expect(page.getByLabel("Board title")).toHaveValue("My local board");
  expect((await canvasState(page)).objects).toEqual(localObjects);
});

test("opening and switching account boards restores guest objects, viewport and title without cloud writes", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "First account board"), savedBoard(secondId, "Second account board")]);
  await page.goto("/scribble/");
  await page.getByLabel("Board title").fill("Guest before opening");
  await createNote(page, "Guest note");
  await page.evaluate(async () => {
    const { useViewportStore } = await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts");
    useViewportStore.getState().setViewport({ x: 75, y: -30, zoom: 1.3 });
  });
  const guestState = await canvasState(page);
  await openBoard(page, "First account board");
  expect(Object.values((await canvasState(page)).objects)).toEqual(cloud.boards.get(firstId)?.document?.content.objects);
  expect((await canvasState(page)).past).toHaveLength(0);
  await openBoard(page, "Second account board");
  expect(Object.values((await canvasState(page)).objects)).toEqual(cloud.boards.get(secondId)?.document?.content.objects);
  await page.getByRole("button", { name: "Back to local board", exact: true }).click();
  await expect(page.getByLabel("Board title")).toHaveValue("Guest before opening");
  const restored = await canvasState(page);
  expect(restored.objects).toEqual(guestState.objects);
  expect(restored.viewport).toEqual(guestState.viewport);
  const persisted = await localBoard(page);
  expect(persisted).toMatchObject({ title: "Guest before opening", objects: guestState.objects, viewport: guestState.viewport });
  expect(cloud.mutations).toEqual([]);
});

test("a conflict keeps a durable draft across reload and saves recovery only to a new board", async ({ page }) => {
  const cloud = await mockAccount(page, [
    savedBoard(firstId, "Shared between my devices"),
    savedBoard(secondId, "Weekly planning and architecture notes for my October project"),
  ]);
  await page.goto("/scribble/");
  await page.getByLabel("Board title").fill("Untouched guest");
  await openBoard(page, "Shared between my devices");
  cloud.conflictOnNextSave = true;
  await editNote(page, "Shared between my devices", "My conflicting draft");
  await expect(page.getByText("This board changed elsewhere. Your edits are saved on this device.", { exact: true })).toBeVisible();
  const draftObjects = (await canvasState(page)).objects;
  expect(documentWrites(cloud)).toHaveLength(1);
  expect(documentWrites(cloud)[0].body.expectedRevision).toBe(1);
  await page.reload();
  await expect(page.getByLabel("Board title")).toHaveValue("Untouched guest");
  await openBoard(page, "Shared between my devices");
  await expect(page.getByText("This board changed elsewhere. Your edits are saved on this device.", { exact: true })).toBeVisible();
  expect((await canvasState(page)).objects).toEqual(draftObjects);
  await page.waitForTimeout(1100); // Outlast the account debounce: reopening a conflict must not schedule a PUT.
  expect(documentWrites(cloud)).toHaveLength(1);
  await page.screenshot({ path: "test-results/account-boards-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/account-boards-mobile.png" });
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.getByRole("button", { name: "Save as new account board", exact: true }).click();
  await expect(page.getByText("Saved to account", { exact: true })).toBeVisible();
  expect(cloud.mutations.filter((mutation) => mutation.method === "POST")).toHaveLength(1);
  expect(documentWrites(cloud)).toHaveLength(2);
  expect(documentWrites(cloud)[1]).toMatchObject({ body: { expectedRevision: 0, content: { objects: Object.values(draftObjects) } } });
  expect(documentWrites(cloud)[1].path).not.toBe(`/api/boards/${firstId}/document`);
  expect(cloud.boards.get(firstId)?.document?.content.objects[0]).toMatchObject({ title: "Changed on another device" });
});

test("reloading a conflicting account version preserves the previous draft for explicit restore", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Account original")]);
  await page.goto("/scribble/");
  await openBoard(page, "Account original");
  cloud.conflictOnNextSave = true;
  await editNote(page, "Account original", "Recoverable previous draft");
  await expect(page.getByText("This board changed elsewhere. Your edits are saved on this device.", { exact: true })).toBeVisible();
  const draftObjects = (await canvasState(page)).objects;
  page.once("dialog", (dialog) => {
    expect(dialog.type()).toBe("confirm");
    expect(dialog.message()).toContain("Your current draft will be kept on this device");
    return dialog.accept();
  });
  await page.getByRole("button", { name: "Reload account version", exact: true }).click();
  await expect(page.getByText("Changed on another device", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved to account", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore previous draft", exact: true }).click();
  await expect(page.getByText("This board changed elsewhere. Your edits are saved on this device.", { exact: true })).toBeVisible();
  expect((await canvasState(page)).objects).toEqual(draftObjects);
  expect(documentWrites(cloud)).toHaveLength(1);
});

test("images remain local and are rejected before account metadata is created", async ({ page }) => {
  const cloud = await mockAccount(page);
  await page.goto("/scribble/");
  await expect(page.getByLabel("Board title")).toBeEnabled();
  await page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    useDocumentStore.getState().addObject({ id: "local-image", type: "image", assetId: "image-asset", name: "Local image", x: 300, y: 450, width: 40, height: 40, originalWidth: 40, originalHeight: 40, zIndex: 1, createdAt: 1, updatedAt: 1 });
  });
  await page.getByRole("button", { name: "Upload local board", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /image/i })).toBeVisible();
  expect(cloud.mutations).toEqual([]);
  await expect.poll(async () => (await localBoard(page))?.objects["local-image"]?.type).toBe("image");
  await page.reload();
  await expect(page.getByLabel("Board title")).toBeEnabled();
  expect((await canvasState(page)).objects["local-image"]).toMatchObject({ type: "image", assetId: "image-asset" });
});

test("an account draft containing an unsupported image is restored locally when reopened", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Account image draft")]);
  await page.goto("/scribble/");
  await page.getByLabel("Board title").fill("Guest before image draft");
  await openBoard(page, "Account image draft");
  await page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    useDocumentStore.getState().addObject({ id: "account-local-image", type: "image", assetId: "account-image-asset", name: "Image only on this device", x: 650, y: 450, width: 40, height: 40, originalWidth: 40, originalHeight: 40, zIndex: 2, createdAt: 1, updatedAt: 1 });
  });
  await expect(page.getByRole("button", { name: "Retry account save", exact: true })).toBeVisible();
  const draftObjects = (await canvasState(page)).objects;
  expect(documentWrites(cloud)).toHaveLength(0);
  await page.getByRole("button", { name: "Back to local board", exact: true }).click();
  await expect(page.getByLabel("Board title")).toHaveValue("Guest before image draft");
  await openBoard(page, "Account image draft");
  expect((await canvasState(page)).objects).toEqual(draftObjects);
  await expect(page.getByRole("button", { name: "Retry account save", exact: true })).toBeVisible();
  expect(cloud.mutations).toEqual([]);
  await page.reload();
  await expect(page.getByLabel("Board title")).toHaveValue("Guest before image draft");
  await openBoard(page, "Account image draft");
  expect((await canvasState(page)).objects).toEqual(draftObjects);
  expect(cloud.mutations).toEqual([]);
});

test("an account save failure retains edits and retries the same expected revision", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Retry board")]);
  await page.goto("/scribble/");
  await openBoard(page, "Retry board");
  cloud.failSaves = true;
  await editNote(page, "Retry board", "Retry this draft");
  await expect(page.getByRole("button", { name: "Retry account save", exact: true })).toBeVisible();
  const draftObjects = (await canvasState(page)).objects;
  expect(documentWrites(cloud)).toHaveLength(1);
  cloud.failSaves = false;
  await page.getByRole("button", { name: "Retry account save", exact: true }).click();
  await expect(page.getByText("Saved to account", { exact: true })).toBeVisible();
  expect(documentWrites(cloud)).toHaveLength(2);
  expect(documentWrites(cloud).map((mutation) => mutation.body.expectedRevision)).toEqual([1, 1]);
  expect(cloud.boards.get(firstId)?.document?.content.objects).toEqual(Object.values(draftObjects));
});

test("session expiry during save returns to the guest board and keeps the private draft for later sign-in", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Expired-session board")]);
  await page.goto("/scribble/");
  await page.getByLabel("Board title").fill("Guest remains mine");
  await createNote(page, "Guest before expiry");
  const guestObjects = (await canvasState(page)).objects;
  await openBoard(page, "Expired-session board");
  cloud.signedIn = false;
  await editNote(page, "Expired-session board", "Private draft before expiry");
  await expect(page.getByText("Sign in to see your server boards.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Board title")).toHaveValue("Guest remains mine");
  expect((await canvasState(page)).objects).toEqual(guestObjects);
  await expect(page.getByText("Expired-session board", { exact: true })).toHaveCount(0);
  cloud.signedIn = true;
  await page.reload();
  await expect(page.getByText("Expired-session board", { exact: true })).toBeVisible();
  await openBoard(page, "Expired-session board");
  await expect(page.getByText("Private draft before expiry", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry account save", exact: true }).click();
  await expect(page.getByText("Saved to account", { exact: true })).toBeVisible();
  expect(cloud.boards.get(firstId)?.document?.content.objects[0]).toMatchObject({ title: "Private draft before expiry" });
});

test("a delayed account document cannot replace the guest canvas after sign-out", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Delayed board")]);
  await page.goto("/scribble/");
  await page.getByLabel("Board title").fill("Guest during account request");
  await createNote(page, "Guest while opening");
  const guestObjects = (await canvasState(page)).objects;
  let release!: () => void;
  let started!: () => void;
  cloud.documentGate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  cloud.documentStarted = started;
  await page.getByRole("listitem").filter({ has: page.getByText("Delayed board", { exact: true }) }).getByRole("button", { name: "Open", exact: true }).click();
  await requestStarted;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByText("Sign in to see your server boards.", { exact: true })).toBeVisible();
  release();
  await expect(page.getByLabel("Board title")).toHaveValue("Guest during account request");
  expect((await canvasState(page)).objects).toEqual(guestObjects);
  await expect(page.getByText("Delayed board", { exact: true })).toHaveCount(0);
  expect(cloud.mutations).toEqual([]);
});

test("sign-out during an account reload returns to the guest board and ignores the pending remote version", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Reloading account board")]);
  await page.goto("/scribble/");
  await page.getByLabel("Board title").fill("Guest during reload");
  await createNote(page, "Guest remains visible after logout");
  const guestObjects = (await canvasState(page)).objects;
  await openBoard(page, "Reloading account board");
  cloud.failSaves = true;
  await editNote(page, "Reloading account board", "Unsent private draft");
  await expect(page.getByRole("button", { name: "Retry account save", exact: true })).toBeVisible();
  let release!: () => void;
  let started!: () => void;
  cloud.documentGate = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  cloud.documentStarted = started;
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload account version", exact: true }).click();
  await requestStarted;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByText("Sign in to see your server boards.", { exact: true })).toBeVisible();
  release();
  await expect(page.getByLabel("Board title")).toHaveValue("Guest during reload");
  expect((await canvasState(page)).objects).toEqual(guestObjects);
  await expect(page.getByText("Reloading account board", { exact: true })).toHaveCount(0);
  expect(documentWrites(cloud)).toHaveLength(1);
});

test("new account boards and explicit rename/delete leave the guest board intact", async ({ page }) => {
  const cloud = await mockAccount(page);
  await page.goto("/scribble/");
  await page.getByLabel("Board title").fill("Guest title stays");
  await createNote(page, "Guest stays too");
  const guestObjects = (await canvasState(page)).objects;
  await page.getByRole("button", { name: "New account board", exact: true }).click();
  await expect(page.getByText("Saved to account", { exact: true })).toBeVisible();
  expect((await canvasState(page)).objects).toEqual({});
  const created = [...cloud.boards.values()][0];
  expect(created.document?.content.objects).toEqual([]);
  const row = page.getByRole("listitem").filter({ has: page.getByText(created.title, { exact: true }) });
  page.once("dialog", (dialog) => dialog.accept("Renamed account board"));
  await row.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByLabel("Board title")).toHaveValue("Renamed account board");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("listitem").filter({ has: page.getByText("Renamed account board", { exact: true }) }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByLabel("Board title")).toHaveValue("Guest title stays");
  expect((await canvasState(page)).objects).toEqual(guestObjects);
  expect(cloud.boards.size).toBe(0);
  expect(cloud.mutations.map((mutation) => mutation.method)).toEqual(["POST", "PUT", "PATCH", "DELETE"]);
});
