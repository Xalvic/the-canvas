import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import { explicitSave, newAccountBoard } from "../e2e/fixtures/ui";
import { BASE_URL, canvasState, createNote, flushLocalDraft, membership, network, signIn, state } from "./fixture";

async function workspacePage(page: Page) {
  await signIn(page.context().request);
  await page.goto("/scribble/");
  await expect(page.getByLabel("Page title")).toBeVisible();
  await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account");
  return (await canvasState(page)).account!.boardId;
}
async function image(page: Page, mime = "image/png", source = "drop") {
  const raw = sharp({ create: { width: 48, height: 32, channels: 4, background: "#2585dd" } });
  const bytes = await (mime === "image/jpeg" ? raw.jpeg() : mime === "image/webp" ? raw.webp() : raw.png()).toBuffer();
  await page.locator(".canvas-viewport").evaluate((element, input) => {
    const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(atob(input.bytes), (char) => char.charCodeAt(0))], "new-image", { type: input.mime }));
    const event = input.source === "drop" ? new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data, clientX: 600, clientY: 500 })
      : new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
    element.dispatchEvent(event);
  }, { bytes: bytes.toString("base64"), mime, source });
  await expect(page.locator(".image-object-value")).toHaveCount(1);
}
async function history(page: Page, action: "undo" | "redo") {
  await page.evaluate(async (action) => (await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts")).useDocumentStore.getState()[action](), action);
}
async function saved(page: Page) { await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account", { timeout: 20_000 }); }

test("drawing and page title save automatically and preserve zoom, pan and atomic undo", async ({ page, context }) => {
  const id = await workspacePage(page);
  await page.getByLabel("Page title").fill("Automatic page title");
  await createNote(page, "Automatic note", 430, 480); await saved(page);
  const metadata = await context.request.get(`${BASE_URL}/api/boards/${id}`);
  expect((await metadata.json()).board.title).toBe("Automatic page title");
  expect((await state(context.request, id)).document!.content.objects).toHaveLength(1);
  await history(page, "undo"); await saved(page);
  expect((await state(context.request, id)).document!.content.objects).toHaveLength(1);
  await history(page, "undo"); await saved(page);
  expect((await state(context.request, id)).document!.content.objects).toHaveLength(0);
  await history(page, "redo"); await saved(page);
  await history(page, "redo"); await saved(page);
  expect((await state(context.request, id)).document!.content.objects).toHaveLength(1);
  await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts")).useViewportStore.getState().setViewport({ x: 120, y: -90, zoom: 0.5 }));
  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
  await page.mouse.move(650, 480); await page.mouse.down(); await page.mouse.move(720, 550, { steps: 12 }); await page.mouse.up(); await saved(page);
  expect((await state(context.request, id)).document!.content.objects.filter((object) => object.type === "stroke")).toHaveLength(1);
  await flushLocalDraft(page); await page.reload(); await saved(page);
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts")).useViewportStore.getState().viewport)).toEqual({ x: 120, y: -90, zoom: 0.5 });
});

for (const [mime, source] of [["image/png", "drop"], ["image/jpeg", "paste"], ["image/webp", "drop"]]) {
  test(`${source} ${mime} uploads and saves automatically; undo and redo reuse the asset`, async ({ page, context }) => {
    const id = await workspacePage(page); await image(page, mime, source); await saved(page);
    const first = await state(context.request, id); expect(first.assets).toHaveLength(1);
    expect(first.assets[0].status).toBe("ready");
    expect(first.document!.content.objects[0]).toMatchObject({ type: "image", assetId: first.assets[0].id });
    await history(page, "undo"); await saved(page);
    expect((await state(context.request, id)).document!.content.objects).toHaveLength(0);
    await history(page, "redo"); await saved(page);
    const last = await state(context.request, id); expect(last.assets).toHaveLength(1);
    expect(last.document!.content.objects[0]).toMatchObject({ assetId: first.assets[0].id });
  });
}

test("offline image and title changes stay local and save on reconnect without a button", async ({ page, context }) => {
  const id = await workspacePage(page); await context.setOffline(true);
  await page.getByLabel("Page title").fill("Offline page edits"); await page.getByLabel("Page title").press("Enter"); await image(page);
  await expect(page.locator(".save-status")).toHaveAccessibleName("Changes pending · saved on this device");
  await page.screenshot({ path: "workspace-ux-evidence/m11-offline-pending.png" });
  await flushLocalDraft(page);
  expect((await state(context.request, id)).assets).toHaveLength(0);
  await context.setOffline(false); await saved(page);
  expect((await state(context.request, id)).document!.content.objects).toHaveLength(1);
  expect((await (await context.request.get(`${BASE_URL}/api/boards/${id}`)).json()).board.title).toBe("Offline page edits");
});

test("lost upload response and reload recover the original asset and request", async ({ page, context }) => {
  const id = await workspacePage(page); let posts = 0; let requestId = "";
  await page.route(`**/api/boards/${id}/assets`, async (route) => {
    posts++; requestId = route.request().headers()["x-scribble-upload-request"];
    const response = await route.fetch(); expect(response.ok()).toBeTruthy(); await route.abort("failed");
  });
  await image(page);
  await expect.poll(async () => (await state(context.request, id)).assets.length).toBe(1);
  await flushLocalDraft(page); await page.reload(); await saved(page);
  expect(posts).toBe(1);
  const current = await canvasState(page);
  expect(Object.values(current.account!.imageUploads!)[0].requestId).toBe(requestId);
  const persisted = await state(context.request, id); expect(persisted.assets).toHaveLength(1);
  expect(persisted.document!.content.objects).toHaveLength(1);
});

test("a lost document response retries its durable operation receipt automatically", async ({ page, context }) => {
  const id = await workspacePage(page); await network(context.request, 1);
  await createNote(page, "Lost operation confirmation", 430, 480); await saved(page);
  const persisted = await state(context.request, id);
  expect(persisted.document!.revision).toBe(2); expect(persisted.receipts).toHaveLength(1);
  expect(persisted.document!.content.objects).toHaveLength(1);
});

test("lost title response reconciles without another PATCH", async ({ page, context }) => {
  const id = await workspacePage(page); let writes = 0;
  await page.route(`**/api/boards/${id}`, async (route) => {
    if (route.request().method() !== "PATCH") { await route.continue(); return; }
    writes++; const response = await route.fetch(); expect(response.ok()).toBeTruthy(); await route.abort("failed");
  });
  await page.getByLabel("Page title").fill("Confirmed title after lost reply"); await page.getByLabel("Page title").press("Enter"); await saved(page);
  expect(writes).toBe(1);
  expect((await (await context.request.get(`${BASE_URL}/api/boards/${id}`)).json()).board.title).toBe("Confirmed title after lost reply");
});

test("legacy unconsented files show one review and upload only after consent", async ({ page, context }) => {
  const id = await workspacePage(page);
  // Reproduce a v4 draft produced before M8, without running the new insertion hook.
  await page.evaluate(async () => {
    const { saveAsset } = await import(/* @vite-ignore */ "/scribble/src/assets/assetStore.ts");
    const { createImageObject } = await import(/* @vite-ignore */ "/scribble/src/canvas/objects/objectFactories.ts");
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const source = document.createElement("canvas"); source.width = 20; source.height = 10;
    source.getContext("2d")!.fillRect(0, 0, 20, 10);
    const blob = await new Promise<Blob>((resolve) => source.toBlob((value) => resolve(value!), "image/png"));
    const assetId = await saveAsset(blob);
    const object = createImageObject({ assetId, center: { x: 100, y: 100 }, width: 20, height: 10, originalWidth: 20, originalHeight: 10, zIndex: 1 });
    useDocumentStore.getState().loadDocument({ [object.id]: object });
  });
  await flushLocalDraft(page); await page.reload();
  await expect(page.getByRole("button", { name: "Review image upload" })).toBeVisible();
  expect((await state(context.request, id)).assets).toHaveLength(0);
  await page.getByRole("button", { name: "Review image upload" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await state(context.request, id)).assets).toHaveLength(0);
  await explicitSave(page, "Allow image upload"); await saved(page);
  await page.reload(); await saved(page);
  await expect(page.getByRole("button", { name: "Review image upload" })).toHaveCount(0);
  expect((await state(context.request, id)).assets).toHaveLength(1);
});

test("repeated service failure stops after three automatic retries and exposes one Retry", async ({ page }) => {
  const id = await workspacePage(page); let writes = 0;
  await page.route(`**/api/boards/${id}/operations`, async (route) => {
    writes++; await route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "Temporarily unavailable" } } });
  });
  await createNote(page, "Recoverable pending note", 430, 480);
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible({ timeout: 15_000 });
  expect(writes).toBe(4);
  await page.unroute(`**/api/boards/${id}/operations`); await page.getByRole("button", { name: "Retry save", exact: true }).click(); await saved(page);
});

test("rate limiting honors Retry-After and replays one document operation identity", async ({ page }) => {
  const id = await workspacePage(page); const attempts: { at: number; id: string }[] = [];
  await page.route(`**/api/boards/${id}/operations`, async (route) => {
    attempts.push({ at: Date.now(), id: route.request().postDataJSON().operationId });
    if (attempts.length === 1) await route.fulfill({ status: 429, headers: { "Retry-After": "3" }, json: { error: { code: "RATE_LIMITED", message: "Retry shortly" } } });
    else await route.continue();
  });
  await createNote(page, "Rate limited edit", 430, 480); await saved(page);
  expect(attempts).toHaveLength(2); expect(attempts[1].at - attempts[0].at).toBeGreaterThanOrEqual(2_900);
  expect(attempts[1].id).toBe(attempts[0].id);
});

test("revoked editing access stops automatic image requests and preserves the file", async ({ page, context, browser }) => {
  const owner = await signIn(context.request); await page.goto("/scribble/"); await saved(page);
  const id = (await canvasState(page)).account!.boardId;
  const other = await browser.newContext();
  try {
    await other.addInitScript(() => { Object.defineProperty(window, "EventSource", { value: undefined }); });
    const editor = await signIn(other.request); await membership(context.request, id, editor.user.id, "editor");
    const tab = await other.newPage(); await tab.goto(`/scribble/?page=${id}`); await saved(tab);
    let posts = 0;
    await tab.route(`**/api/boards/${id}/assets`, async (route) => {
      posts++; await membership(context.request, id, editor.user.id, "viewer"); await route.continue();
    });
    await image(tab);
    await expect(tab.locator(".save-status")).toHaveAccessibleName("Can view · account board");
    expect(posts).toBe(1);
    expect((await canvasState(tab)).objects).toHaveLength(1);
    expect((await state(context.request, id)).assets).toHaveLength(0);
  } finally { await other.close(); }
  expect(owner.user.id).toBe((await canvasState(page)).account!.ownerId);
});

test("dispatch-time account switching fences an authorized upload", async ({ page, context }) => {
  const id = await workspacePage(page); let attempts = 0;
  await page.route(`**/api/boards/${id}/assets`, async (route) => {
    attempts++; await signIn(context.request); await route.continue();
  });
  await image(page);
  await expect(page.locator(".board-notice")).toContainText(/account.*changed|different.*account/i);
  expect(attempts).toBe(1);
  expect((await state(context.request, id)).assets).toHaveLength(0);
  expect((await canvasState(page)).objects).toHaveLength(1);
});

test("pasting a cloud image into another page automatically uploads a distinct destination asset", async ({ page, context }) => {
  const sourceId = await workspacePage(page); await image(page); await saved(page);
  const originalAsset = (await state(context.request, sourceId)).assets[0].id;
  await page.reload(); await saved(page);
  await expect.poll(() => page.locator(".image-object-value").getAttribute("src")).toContain("/api/__fixture/image?");
  await page.evaluate(async () => {
    const { useSelectionStore } = await import(/* @vite-ignore */ "/scribble/src/store/selectionStore.ts");
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    useSelectionStore.getState().setSelection(Object.keys(useDocumentStore.getState().objects));
    (await import(/* @vite-ignore */ "/scribble/src/clipboard/clipboardCommands.ts")).copySelection();
  });
  await newAccountBoard(page); await saved(page);
  const targetId = (await canvasState(page)).account!.boardId; expect(targetId).not.toBe(sourceId);
  await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/clipboard/clipboardCommands.ts")).pasteClipboard());
  await saved(page);
  const target = await state(context.request, targetId); expect(target.assets).toHaveLength(1);
  expect(target.assets[0].id).not.toBe(originalAsset);
  expect(target.document!.content.objects[0]).toMatchObject({ assetId: target.assets[0].id });
  expect((await state(context.request, sourceId)).document!.content.objects[0]).toMatchObject({ assetId: originalAsset });
});

test("a dispatch-time account switch also fences document autosave", async ({ page, context }) => {
  const id = await workspacePage(page); let attempts = 0;
  await page.route(`**/api/boards/${id}/operations`, async (route) => {
    attempts++; await signIn(context.request); await route.continue();
  });
  await createNote(page, "Bound to original account", 430, 480);
  await expect(page.locator(".board-notice")).toContainText(/account.*changed|different.*account/i);
  expect(attempts).toBe(1);
  expect((await state(context.request, id)).document!.content.objects).toHaveLength(0);
});
