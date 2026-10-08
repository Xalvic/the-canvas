import { randomUUID } from "node:crypto";
import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { closeDialogs, details } from "../e2e/fixtures/ui";
import { BASE_URL, canvasState, connected, createNote, editNote, flushLocalDraft, mutationHeaders, network, openBoard, signIn, state } from "./fixture";

async function editors(page: Page, context: BrowserContext, fallback = false) {
  if (fallback) await context.addInitScript(() => {
    Object.defineProperty(navigator, "locks", { value: undefined });
    Object.defineProperty(window, "BroadcastChannel", { value: undefined });
  });
  await signIn(context.request);
  const title = `Journals-${randomUUID()}`;
  const response = await context.request.post(`${BASE_URL}/api/boards`, { headers: mutationHeaders, data: { title } });
  const boardId = (await response.json()).board.id as string;
  const objects = [
    { id: "first-note", type: "card", title: "First baseline", body: "", x: -340, y: -180, width: 260, height: 150, zIndex: 1, createdAt: 1, updatedAt: 1 },
    { id: "second-note", type: "card", title: "Second baseline", body: "", x: 40, y: -180, width: 260, height: 150, zIndex: 2, createdAt: 1, updatedAt: 1 },
  ];
  expect((await context.request.put(`${BASE_URL}/api/boards/${boardId}/document`, { headers: mutationHeaders, data: { schemaVersion: 1, expectedRevision: 0, content: { objects } } })).status()).toBe(201);
  await page.goto("/scribble/"); await openBoard(page, title);
  const other = await context.newPage(); await other.goto("/scribble/"); await openBoard(other, title);
  await Promise.all([connected(page), connected(other)]);
  return { title, boardId, other };
}
const titles = (objects: any[]) => objects.filter((object) => object.type === "card").map((object) => object.title).sort();
async function retry(page: Page) {
  await details(page);
  const button = page.getByRole("button", { name: "Retry account save", exact: true });
  if (await button.isVisible()) await button.click();
  await closeDialogs(page);
}
async function journal(page: Page) {
  return page.evaluate(async () => {
    const { useBoardStore } = await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts");
    const { accountEditorJournals } = await import(/* @vite-ignore */ "/scribble/src/persistence/accountEditorJournals.ts");
    const board = useBoardStore.getState();
    return { key: accountEditorJournals.leaseId(board.id), editorId: accountEditorJournals.editorId, records: await accountEditorJournals.list(board.id) };
  });
}

test("a lost same-account operation response survives reload while the other editor advances the document", async ({ page, context }) => {
  const { other, boardId, title } = await editors(page, context);
  await network(context.request, 1);
  let attempts = 0;
  await page.route("**/api/boards/*/operations", async (route) => {
    if (++attempts === 1) await route.continue(); else await route.abort("internetdisconnected");
  });
  await editNote(page, "First baseline", "First committed response lost");
  await expect(page.locator(".save-status")).toHaveAccessibleName(/Changes pending/); await flushLocalDraft(page);
  const pending = (await canvasState(page)).account!.pendingOperation!.input;
  const original = await journal(page);
  await editNote(other, "Second baseline", "Other editor advanced");
  await expect(other.locator(".save-status")).toHaveAccessibleName("Saved to account");
  await page.reload(); await openBoard(page, title);
  expect((await journal(page)).key).toBe(original.key);
  expect((await journal(page)).editorId).not.toBe(original.editorId);
  expect((await canvasState(page)).account!.pendingOperation!.input).toEqual(pending);
  await page.unroute("**/api/boards/*/operations");
  await retry(page);
  await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account", { timeout: 12_000 });
  await expect.poll(async () => titles((await canvasState(page)).objects)).toEqual(["First committed response lost", "Other editor advanced"]);
  const remote = await state(context.request, boardId);
  expect(remote.receipts.filter((receipt) => receipt.operation_id === pending.operationId)).toHaveLength(1);
  expect(remote.document!.revision).toBe(3);
});

test("two crashed pending journals remain recoverable and replay distinct operation IDs without losing either edit", async ({ page, context }) => {
  const { other, boardId, title } = await editors(page, context);
  await Promise.all([page, other].map((tab) => tab.route("**/api/boards/*/operations", (route) => route.abort("internetdisconnected"))));
  await Promise.all([editNote(page, "First baseline", "First pending crash"), editNote(other, "Second baseline", "Second pending crash")]);
  await Promise.all([page, other].map((tab) => expect(tab.locator(".save-status")).toHaveAccessibleName(/Changes pending/)));
  await Promise.all([flushLocalDraft(page), flushLocalDraft(other)]);
  const operationIds = [(await canvasState(page)).account!.pendingOperation!.input.operationId, (await canvasState(other)).account!.pendingOperation!.input.operationId];
  expect(new Set(operationIds).size).toBe(2);
  expect((await journal(page)).records).toHaveLength(2);
  await page.close(); await other.close();
  const recovered = await context.newPage(); await recovered.goto("/scribble/"); await openBoard(recovered, title);
  await retry(recovered); await expect(recovered.locator(".save-status")).toHaveAccessibleName("Saved to account"); await flushLocalDraft(recovered);
  await details(recovered);
  await recovered.getByRole("button", { name: /^Recover draft / }).click();
  await closeDialogs(recovered); await retry(recovered);
  await expect(recovered.locator(".save-status")).toHaveAccessibleName("Saved to account");
  await expect.poll(async () => titles((await state(context.request, boardId)).document!.content.objects)).toEqual(["First pending crash", "Second pending crash"]);
  const remote = await state(context.request, boardId);
  for (const id of operationIds) expect(remote.receipts.filter((receipt) => receipt.operation_id === id)).toHaveLength(1);
  expect((await journal(recovered)).records).toHaveLength(2);
});

test("duplicated account tabs without Web Locks or BroadcastChannel keep separate journals and collaborate", async ({ page, context }) => {
  const { other, boardId } = await editors(page, context, true);
  const a = await journal(page), b = await journal(other);
  expect(a.key).not.toBe(b.key); expect(a.editorId).not.toBe(b.editorId);
  await Promise.all([createNote(page, "Fallback first create", 400, 610), createNote(other, "Fallback second create", 790, 610)]);
  const expected = ["Fallback first create", "Fallback second create", "First baseline", "Second baseline"].sort();
  await expect.poll(async () => titles((await state(context.request, boardId)).document!.content.objects), { timeout: 12000 }).toEqual(expected);
  await expect.poll(async () => titles((await canvasState(page)).objects)).toEqual(expected);
  await expect.poll(async () => titles((await canvasState(other)).objects)).toEqual(expected);
});

test("same-object contention retains both journals and never overwrites the confirmed winning edit", async ({ page, context }) => {
  const { other, boardId } = await editors(page, context);
  await page.route("**/api/boards/*/operations", (route) => route.abort("internetdisconnected"));
  await editNote(page, "First baseline", "My divergent journal");
  await expect(page.locator(".save-status")).toHaveAccessibleName(/Changes pending/); await flushLocalDraft(page);
  await editNote(other, "First baseline", "Confirmed other edit");
  await expect(other.locator(".save-status")).toHaveAccessibleName("Saved to account");
  await page.unroute("**/api/boards/*/operations"); await retry(page);
  await expect(page.locator(".board-notice")).toContainText("changed"); await flushLocalDraft(page);
  expect(titles((await canvasState(page)).objects)).toContain("My divergent journal");
  expect(titles((await state(context.request, boardId)).document!.content.objects)).toContain("Confirmed other edit");
  expect((await journal(page)).records).toHaveLength(2);
});

test("legacy account drafts migrate by copying while pending operations, saved mappings and image bytes remain intact", async ({ page, context }) => {
  const account = await signIn(context.request);
  const title = `Legacy-${randomUUID()}`;
  const created = await context.request.post(`${BASE_URL}/api/boards`, { headers: mutationHeaders, data: { title } });
  const boardId = (await created.json()).board.id as string;
  const card = { id: "legacy-note", type: "card", title: "Legacy pending edit", body: "", x: -340, y: -180, width: 260, height: 150, zIndex: 1, createdAt: 1, updatedAt: 1 };
  expect((await context.request.put(`${BASE_URL}/api/boards/${boardId}/document`, { headers: mutationHeaders, data: { schemaVersion: 1, expectedRevision: 0, content: { objects: [] } } })).status()).toBe(201);
  await page.goto("/scribble/");
  await openBoard(page, title); await flushLocalDraft(page);
  const existingKey = (await journal(page)).key;
  // M6 opens the page automatically. Seed the pre-upgrade disk state before that
  // opening, rather than injecting legacy data into an already mounted editor.
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reading = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/api/workspace", async (route) => {
    if (route.request().method() === "GET") { started(); await gate; }
    await route.continue();
  });
  await page.reload();
  await reading;
  const operationId = randomUUID(), mappedAsset = randomUUID();
  const legacy = await page.evaluate(async ({ ownerId, boardId, operationId, mappedAsset, title, card }) => {
    const { openCanvasDatabase } = await import(/* @vite-ignore */ "/scribble/src/persistence/database.ts");
    const { accountBoardStorageId } = await import(/* @vite-ignore */ "/scribble/src/persistence/localBoardStorage.ts");
    const id = accountBoardStorageId(ownerId, boardId);
    const board = { schemaVersion: 1, id, title, objects: { [card.id]: card }, viewport: { x: 12, y: 34, zoom: .8 }, createdAt: 1, updatedAt: 1,
      account: { ownerId, boardId, revision: 1, savedTitle: title, savedDocument: { schemaVersion: 1, content: { objects: [] } }, imageAssets: { "retained-image": mappedAsset },
        pendingOperation: { input: { operationId, baseRevision: 1, changes: [{ id: card.id, before: null, after: card }] }, document: { schemaVersion: 1, content: { objects: [card] } } } } };
    const database = await openCanvasDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(["boards", "assets"], "readwrite");
      transaction.objectStore("boards").put(board);
      transaction.objectStore("assets").put({ id: "retained-image", blob: new Blob(["original image bytes"], { type: "image/png" }) });
      transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(transaction.error);
    });
    return board;
  }, { ownerId: account.user.id, boardId, operationId, mappedAsset, title, card });
  release(); await page.unrouteAll({ behavior: "wait" });
  await openBoard(page, title);
  const migrated = await journal(page);
  expect(migrated.key).not.toBe(existingKey);
  expect(migrated.records.map((record) => record.id)).toContain(existingKey);
  const pending = (await canvasState(page)).account!.pendingOperation;
  if (pending) expect(pending.input.operationId).toBe(operationId);
  expect((await canvasState(page)).account!.imageAssets).toEqual({ "retained-image": mappedAsset });
  await retry(page); await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account");
  const stored = await page.evaluate(async (id) => {
    const { openCanvasDatabase } = await import(/* @vite-ignore */ "/scribble/src/persistence/database.ts");
    const database = await openCanvasDatabase();
    const read = (store: string, key: string) => new Promise<any>((resolve) => {
      const request = database.transaction(store).objectStore(store).get(key); request.onsuccess = () => resolve(request.result);
    });
    return { board: await read("boards", id), bytes: await (await read("assets", "retained-image")).blob.text() };
  }, legacy.id);
  expect(stored.board).toEqual(legacy); expect(stored.bytes).toBe("original image bytes");
  expect((await state(context.request, boardId)).receipts.filter((receipt) => receipt.operation_id === operationId)).toHaveLength(1);
});
