import { browse, closeDialogs, details, newAccountBoard } from "../e2e/fixtures/ui";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { BASE_URL, canvasState, createNote, editNote, flushLocalDraft, mutationHeaders, openBoard, signIn, state } from "./fixture";

async function tabState(page: Page) {
  return page.evaluate(async () => {
    const { useBoardStore } = await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts");
    const board = useBoardStore.getState();
    return { id: board.id, readOnly: board.readOnly, tabReadOnly: board.tabReadOnly, recoveryId: board.tabRecoveryId };
  });
}
async function localRecord(page: Page, id?: string) {
  return page.evaluate(async (storageId) => {
    const { loadLocalBoard } = await import(/* @vite-ignore */ "/scribble/src/persistence/localBoardStorage.ts");
    return loadLocalBoard(storageId);
  }, id);
}

test("same-device guest tabs have one writer and explicit takeover reloads the latest IndexedDB objects and viewport", async ({ page, context }) => {
  await page.goto("/scribble/");
  await createNote(page, "Latest guest note", 450, 560);
  await page.evaluate(async () => {
    const { useViewportStore } = await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts");
    useViewportStore.getState().setViewport({ x: 360, y: 210, zoom: .8 });
  });
  await flushLocalDraft(page);
  const before = await localRecord(page);
  const other = await context.newPage();
  await other.goto("/scribble/");
  await details(other);
  await expect(other.getByRole("button", { name: "Reopen here", exact: true })).toBeVisible();
  await closeDialogs(other);
  await expect(other.getByRole("button", { name: "Note tool", exact: true })).toBeDisabled();
  await other.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const { useBoardStore } = await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts");
    useDocumentStore.getState().deleteObjects(Object.keys(useDocumentStore.getState().objects));
    useBoardStore.getState().setTitle("Stale tab overwrite");
  });
  expect(await localRecord(other)).toEqual(before);
  await details(other);
  await other.getByRole("button", { name: "Reopen here", exact: true }).click();
  await closeDialogs(other);
  expect((await tabState(other)).readOnly).toBe(true);
  await page.close();
  await details(other);
  await other.getByRole("button", { name: "Reopen here", exact: true }).click();
  await closeDialogs(other);
  await expect(other.getByRole("button", { name: "Note tool", exact: true })).toBeEnabled();
  expect((await canvasState(other)).objects).toEqual(Object.values(before!.objects));
  const viewport = await other.evaluate(async () => {
    const { useViewportStore } = await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts");
    return useViewportStore.getState().viewport;
  });
  expect(viewport).toEqual(before!.viewport);
  await other.getByRole("button", { name: "Reset viewport", exact: true }).click();
  await createNote(other, "After takeover", 790, 550);
  await flushLocalDraft(other);
  expect(Object.values((await localRecord(other))!.objects)).toHaveLength(2);
});

test("same-account tabs protect the canonical draft; different boards can edit and reopening rechecks actual API permission", async ({ page, context }) => {
  await signIn(context.request);
  const title = `Tab account-${randomUUID()}`;
  const response = await context.request.post(`${BASE_URL}/api/boards`, { headers: mutationHeaders, data: { title } });
  const boardId = (await response.json()).board.id as string;
  expect((await context.request.put(`${BASE_URL}/api/boards/${boardId}/document`, {
    headers: mutationHeaders, data: { schemaVersion: 1, expectedRevision: 0, content: { objects: [] } },
  })).status()).toBe(201);
  await page.goto("/scribble/");
  await openBoard(page, title);
  await createNote(page, "Owner tab note", 450, 560);
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  await flushLocalDraft(page);
  const id = (await tabState(page)).id;
  const before = await localRecord(page, id);
  const other = await context.newPage();
  await other.goto("/scribble/");
  await openBoard(other, title);
  await details(other);
  await expect(other.getByRole("button", { name: "Reopen here", exact: true })).toBeVisible();
  await closeDialogs(other);
  await expect(other.getByRole("button", { name: "Note tool", exact: true })).toBeDisabled();
  expect(await localRecord(other, id)).toEqual(before);
  await newAccountBoard(other);
  await expect.poll(async () => (await canvasState(other)).account?.boardId).not.toBe(boardId);
  await expect(other.getByRole("button", { name: "Note tool", exact: true })).toBeEnabled();
  await createNote(other, "Different board note", 790, 560);
  await expect(other.locator(".save-status")).toHaveText("Saved to account");
  expect((await tabState(page)).readOnly).toBe(false);
  await openBoard(other, title);
  await details(other);
  await expect(other.getByRole("button", { name: "Reopen here", exact: true })).toBeVisible();
  await closeDialogs(other);
  await editNote(page, "Owner tab note", "Fresh owner edit");
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  await flushLocalDraft(page);
  await page.close();
  let reads = 0;
  other.on("request", (request) => { if (request.method() === "GET" && request.url().endsWith(`/api/boards/${boardId}/document`)) reads++; });
  await details(other);
  await other.getByRole("button", { name: "Reopen here", exact: true }).click();
  await closeDialogs(other);
  await expect(other.getByRole("button", { name: "Note tool", exact: true })).toBeEnabled();
  expect(reads).toBeGreaterThan(0);
  expect((await canvasState(other)).objects.some((object) => object.type === "card" && object.title === "Fresh owner edit")).toBe(true);
  expect((await state(context.request, boardId)).document!.content.objects).toEqual((await canvasState(other)).objects);
});

test("a stale writer loses mutations and history; its interrupted draft stays under a unique recovery key", async ({ page }) => {
  await page.goto("/scribble/");
  await createNote(page, "Saved before loss", 450, 560);
  await flushLocalDraft(page);
  await page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const { boardTabCoordinator } = await import(/* @vite-ignore */ "/scribble/src/persistence/boardTabCoordinator.ts");
    const { openCanvasDatabase } = await import(/* @vite-ignore */ "/scribble/src/persistence/database.ts");
    const store = useDocumentStore.getState();
    const object = Object.values(store.objects)[0];
    store.updateObject(object.id, { title: "Interrupted unsaved edit" });
    const database = await openCanvasDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["boards", "board-leases"], "readwrite");
      transaction.objectStore("board-leases").put({ id: "current-board", ownerId: "new writer", token: "new-token", expiresAt: Date.now() + 20000, webLock: false });
      const request = transaction.objectStore("boards").get("current-board");
      request.onsuccess = () => {
        const record = request.result;
        record.objects[object.id].title = "New writer protected";
        transaction.objectStore("boards").put(record);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
    await boardTabCoordinator.renewAll();
  });
  await expect(page.getByRole("button", { name: "Note tool", exact: true })).toBeDisabled();
  await expect.poll(async () => (await tabState(page)).recoveryId).not.toBeNull();
  const recoveryId = (await tabState(page)).recoveryId!;
  expect(recoveryId).toMatch(/^current-board:recovery:/);
  const recovery = await localRecord(page, recoveryId);
  expect(Object.values(recovery!.objects).some((object) => object.type === "card" && object.title === "Interrupted unsaved edit")).toBe(true);
  expect(Object.values((await localRecord(page))!.objects).some((object) => object.type === "card" && object.title === "New writer protected")).toBe(true);
  await page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const store = useDocumentStore.getState();
    store.deleteObjects(Object.keys(store.objects)); store.undo();
  });
  expect((await canvasState(page)).objects.some((object) => object.type === "card" && object.title === "Interrupted unsaved edit")).toBe(true);
});
