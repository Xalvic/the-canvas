import { closeDialogs, details, backToDevice, newAccountBoard, explicitSave, accountMenu } from "../e2e/fixtures/ui";
import { openBoard } from "./fixture";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

const fixtureHeaders = () => ({ "X-Scribble-Fixture": process.env.SCRIBBLE_FIXTURE_TOKEN! });
const mutationHeaders = { "X-Scribble-Request": "1" };
const baseURL = "http://127.0.0.1:4174";
type PersistedImage = { id: string; type: "image"; assetId: string; x: number; y: number; width: number; height: number };
type FixtureState = { document: { revision: number; content: { objects: PersistedImage[] } } | null; assets: { id: string; board_id: string; status: string; last_referenced_at: string | null }[]; provider: { uploadCalls: number; signCalls: number; imageCalls: number } };

async function signIn(request: APIRequestContext, subject = `owner-${randomUUID()}`) {
  const response = await request.post(`${baseURL}/api/__fixture/session`, { headers: fixtureHeaders(), data: { subject } });
  expect(response.ok()).toBeTruthy();
  return { subject, user: (await response.json()).user as { id: string; email: string } };
}
async function provider(request: APIRequestContext, data: Record<string, number | boolean>) {
  expect((await request.post(`${baseURL}/api/__fixture/provider`, { headers: fixtureHeaders(), data })).ok()).toBeTruthy();
}
async function state(request: APIRequestContext, boardId: string): Promise<FixtureState> {
  const response = await request.get(`${baseURL}/api/__fixture/state/${boardId}`, { headers: fixtureHeaders() });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
async function currentBoard(page: Page) {
  return page.evaluate(async () => {
    const { useBoardStore } = await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts");
    return useBoardStore.getState().account?.boardId ?? null;
  });
}
async function dropImage(page: Page, name = "fixture.png", legacy = false) {
  const png = await sharp({ create: { width: 480, height: 320, channels: 4, background: { r: 20, g: 130, b: 240, alpha: 1 } } }).png().toBuffer();
  await page.locator(".canvas-viewport").evaluate(async (element, input) => {
    if (input.legacy) {
      // Seed the v4 draft of a pre-autosave client without new-insertion consent.
      const { saveAsset } = await import(/* @vite-ignore */ "/scribble/src/assets/assetStore.ts");
      const { createImageObject } = await import(/* @vite-ignore */ "/scribble/src/canvas/objects/objectFactories.ts");
      const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
      const blob = new Blob([Uint8Array.from(atob(input.bytes), (char) => char.charCodeAt(0))], { type: "image/png" });
      const assetId = await saveAsset(blob);
      const image = createImageObject({ assetId, center: { x: 0, y: 0 }, width: 480, height: 320, originalWidth: 480, originalHeight: 320, zIndex: 1 });
      useDocumentStore.getState().loadDocument({ [image.id]: image });
      return;
    }
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(input.bytes), (char) => char.charCodeAt(0))], input.name, { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 600, clientY: 500 }));
  }, { name, bytes: png.toString("base64"), legacy });
  await expect(page.locator(".image-object-value")).toHaveCount(1);
}
async function renderedImage(page: Page) {
  await expect(page.locator(".image-object-value")).toBeInViewport();
  await expect.poll(() => page.locator(".image-object-value").evaluateAll((images) =>
    images.length === 1 && images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
}
async function flushLocalDraft(page: Page) {
  await page.evaluate(async () => {
    const { waitForLocalBoardSave } = await import(/* @vite-ignore */ "/scribble/src/persistence/waitForLocalBoardSave.ts");
    await waitForLocalBoardSave(new AbortController().signal);
  });
}
async function workspaceImage(page: Page, title: string) {
  await page.goto("/scribble/");
  await page.getByLabel("Page title").fill(title);
  await page.getByLabel("Page title").press("Enter");
  await page.getByRole("button", { name: "Zoom options", exact: true }).click(); await page.getByRole("menuitem", { name: "Reset viewport", exact: true }).click();
  await dropImage(page);
  await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account", { timeout: 20_000 });
  const boardId = await currentBoard(page);
  expect(boardId).not.toBeNull();
  return boardId!;
}
async function membership(request: APIRequestContext, boardId: string, userId: string, role: "editor" | "viewer" | null) {
  expect((await request.post(`${baseURL}/api/__fixture/membership`, { headers: fixtureHeaders(), data: { boardId, userId, role } })).ok()).toBeTruthy();
}
async function newSignedInPage(context: BrowserContext, subject?: string) {
  const account = await signIn(context.request, subject);
  const page = await context.newPage();
  await page.goto(`${baseURL}/scribble/`);
  return { page, account };
}

test.afterEach(async ({ request }) => { await provider(request, {}); });

test("stopping a consented legacy upload preserves its request and retry creates no second page", async ({ page, context }) => {
  await signIn(context.request);
  await page.goto("/scribble/");
  await page.getByLabel("Page title").fill("Cancelled upload fixture");
  await page.getByLabel("Page title").press("Enter");
  await dropImage(page, "legacy.png", true);
  await flushLocalDraft(page); await page.reload();
  await provider(context.request, { uploadDelayMs: 1500 });
  await page.getByRole("button", { name: "Review image upload", exact: true }).click();
  const consent = page.getByRole("dialog", { name: "Allow image upload", exact: true });
  await consent.getByRole("button", { name: "Allow image upload", exact: true }).click();
  await expect(consent.getByText("Uploading images… 0/1", { exact: true })).toBeVisible();
  const boardId = (await currentBoard(page))!;
  await page.getByRole("button", { name: "Stop request", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".board-notice")).toContainText("The save was interrupted");
  await flushLocalDraft(page);
  expect((await (await context.request.get(`${baseURL}/api/boards`)).json()).boards).toHaveLength(1);
  await renderedImage(page);
  await provider(context.request, { uploadDelayMs: 0 });
  // Aborting the browser does not cancel the provider's already accepted work.
  // Wait for that bounded request to release the existing per-user upload gate.
  await expect.poll(async () => (await state(context.request, boardId)).assets.filter((asset) => asset.status === "pending").length).toBe(0);
  await details(page);
  await page.getByRole("button", { name: "Retry account save", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account", { timeout: 20_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await closeDialogs(page);
  await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account");
  expect(await currentBoard(page)).toBe(boardId);
  expect((await (await context.request.get(`${baseURL}/api/boards`)).json()).boards).toHaveLength(1);
  expect((await state(context.request, boardId)).document?.content.objects).toHaveLength(1);
});

test("guest image stays local through login; later consent transfers once and fresh-device reopen renders signed bytes", async ({ page, context, browser }) => {
  await page.goto("/scribble/");
  await page.getByLabel("Drawing title").fill("Consented image transfer");
  await page.getByLabel("Drawing title").press("Enter");
  await dropImage(page);
  await renderedImage(page);
  await flushLocalDraft(page);
  const beforeLogin = await state(context.request, randomUUID());
  const account = await signIn(context.request);
  await page.reload();
  await expect(page.getByLabel("Page title")).toHaveValue("Untitled");
  const initial = (await currentBoard(page))!;
  expect((await state(context.request, initial)).assets).toHaveLength(0);
  expect((await state(context.request, initial)).provider.uploadCalls).toBe(beforeLogin.provider.uploadCalls);
  await accountMenu(page);
  await page.getByRole("menuitem", { name: "Your account and retained drawing", exact: true }).click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Bring drawing", exact: true }).click();
  await expect(page.getByLabel("Page title")).toHaveValue("Consented image transfer");
  await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account", { timeout: 20_000 });
  const boardId = (await currentBoard(page))!;
  const persisted = await state(context.request, boardId);
  expect(persisted.document?.revision).toBe(2);
  expect(persisted.assets).toHaveLength(1);
  expect(persisted.assets[0]).toMatchObject({ status: "ready", board_id: boardId, last_referenced_at: expect.any(String) });
  expect(persisted.document?.content.objects[0].assetId).toBe(persisted.assets[0].id);
  expect(JSON.stringify(persisted.document)).not.toMatch(/blob:|https?:|data:|cloudAsset/);
  const fresh = await browser.newContext();
  try {
    const { page: reopened } = await test.step("Sign in on a fresh device", () => newSignedInPage(fresh, account.subject));
    await test.step("Open the transferred page", () => openBoard(reopened, "Consented image transfer"));
    await test.step("Render its signed image", () => renderedImage(reopened));
    expect(await reopened.locator(".image-object-value").getAttribute("src")).toContain("/api/__fixture/image?");
  } finally { if (fresh.pages().length) await fresh.close(); }
  await backToDevice(page);
  await renderedImage(page);
  expect(await page.locator(".image-object-value").getAttribute("src")).toMatch(/^blob:/);
});

test("new workspace images save automatically and reload reconciles the original failed upload", async ({ page, context }) => {
  await signIn(context.request);
  await page.goto("/scribble/");
  await newAccountBoard(page);
  await closeDialogs(page);
  await expect(page.getByLabel("Page title")).toBeVisible();
  await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account");
  const boardId = (await currentBoard(page))!;
  await provider(context.request, { failUploads: 1 });
  const uploadPath = `**/api/boards/${boardId}/assets`;
  let uploadRequests = 0;
  // Retain the first real failed reservation until reload; automatic retries
  // must not complete it before this test inspects the durable pending state.
  await page.route(uploadPath, async (route) => {
    if (route.request().method() === "POST" && ++uploadRequests > 1) await route.abort("failed");
    else await route.continue();
  });
  await dropImage(page);
  await expect.poll(async () => (await state(context.request, boardId)).assets).toHaveLength(1);
  const pending = await state(context.request, boardId);
  expect(pending.assets).toHaveLength(1);
  expect((await state(context.request, boardId)).document?.content.objects).toEqual([]);
  await flushLocalDraft(page);
  await page.unroute(uploadPath);
  await page.reload();
  await renderedImage(page);
  await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account", { timeout: 20_000 });
  const persisted = await state(context.request, boardId);
  expect(persisted.document?.content.objects).toHaveLength(1);
  expect(persisted.assets.filter((asset) => asset.status === "ready")).toHaveLength(1);
  expect(persisted.assets[0].id).toBe(pending.assets[0].id);
});

test("cross-board copy uploads a new asset instead of saving the source reference", async ({ page, context }) => {
  await signIn(context.request);
  const sourceId = await workspaceImage(page, "Copy source");
  const sourceAsset = (await state(context.request, sourceId)).assets[0].id;
  await renderedImage(page);
  await page.evaluate(async () => {
    const { useSelectionStore } = await import(/* @vite-ignore */ "/scribble/src/store/selectionStore.ts");
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const { copySelection } = await import(/* @vite-ignore */ "/scribble/src/clipboard/clipboardCommands.ts");
    useSelectionStore.getState().setSelection(Object.keys(useDocumentStore.getState().objects));
    copySelection();
  });
  await newAccountBoard(page);
  await expect.poll(() => currentBoard(page)).not.toBe(sourceId);
  await closeDialogs(page);
  await expect(page.getByLabel("Page title")).toBeVisible();
  await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account");
  const targetId = (await currentBoard(page))!;
  await page.evaluate(async () => {
    const { pasteClipboard } = await import(/* @vite-ignore */ "/scribble/src/clipboard/clipboardCommands.ts");
    pasteClipboard();
  });
  await expect.poll(async () => (await state(context.request, targetId)).document?.content.objects).toHaveLength(1);
  await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account", { timeout: 20_000 });
  const target = await state(context.request, targetId);
  expect(target.assets).toHaveLength(1);
  expect(target.assets[0].id).not.toBe(sourceAsset);
  expect(target.document?.content.objects[0].assetId).toBe(target.assets[0].id);
  expect((await state(context.request, sourceId)).document?.content.objects[0].assetId).toBe(sourceAsset);
});

test("save-as-new copies cloud image bytes into the new board and leaves the original asset retained", async ({ page, context }) => {
  await signIn(context.request);
  const sourceId = await workspaceImage(page, "Save a cloud copy");
  await openBoard(page, "Save a cloud copy");
  // Cause a real revision conflict to expose the recovery save-as-new control.
  const original = await state(context.request, sourceId);
  const saved = await context.request.put(`${baseURL}/api/boards/${sourceId}/document`, {
    headers: mutationHeaders, data: { schemaVersion: 1, expectedRevision: original.document!.revision,
      content: { objects: original.document!.content.objects.map((image) => ({ ...image, x: image.x + 20 })) } },
  });
  expect(saved.ok()).toBeTruthy();
  await page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const image = Object.values(useDocumentStore.getState().objects)[0];
    if (image.type !== "image") throw new Error("Expected the reopened cloud image");
    useDocumentStore.getState().updateObject(image.id, { x: image.x + 10 });
  });
  await details(page);
  await expect(page.getByRole("button", { name: "Save a copy", exact: true })).toBeVisible();
  await closeDialogs(page);
  await explicitSave(page, "Save a copy");
  await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account");
  const targetId = (await currentBoard(page))!;
  expect(targetId).not.toBe(sourceId);
  const target = await state(context.request, targetId);
  expect(target.assets[0].id).not.toBe(original.assets[0].id);
  expect(target.document?.content.objects[0].assetId).toBe(target.assets[0].id);
  expect((await state(context.request, sourceId)).assets[0].last_referenced_at).not.toBeNull();
});

test("editor uploads persist, viewer reads are signed, and revoked membership blocks fresh image access", async ({ page, context, browser }) => {
  await signIn(context.request);
  const boardId = await workspaceImage(page, "Role-protected images");
  const assetId = (await state(context.request, boardId)).assets[0].id;
  const member = await browser.newContext();
  try {
    const { page: editor, account } = await newSignedInPage(member);
    await membership(context.request, boardId, account.user.id, "editor");
    await editor.reload(); await openBoard(editor, "Role-protected images");
    await renderedImage(editor);
    // A real binary upload and revision save made with the editor's own session.
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).png().toBuffer();
    const upload = await member.request.post(`${baseURL}/api/boards/${boardId}/assets`, { headers: { ...mutationHeaders, "Content-Type": "image/png" }, data: bytes });
    expect(upload.status()).toBe(201);
    const uploadedId = (await upload.json()).asset.id;
    const document = (await (await member.request.get(`${baseURL}/api/boards/${boardId}/document`)).json()).document;
    const image = { ...document.content.objects[0], id: "editor-image", assetId: uploadedId };
    expect((await member.request.put(`${baseURL}/api/boards/${boardId}/document`, { headers: mutationHeaders, data: { schemaVersion: 1, expectedRevision: document.revision, content: { objects: [image] } } })).ok()).toBeTruthy();
    await membership(context.request, boardId, account.user.id, "viewer");
    await editor.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(editor.locator(".save-status")).toHaveAccessibleName("Can view · account board");
    expect((await member.request.get(`${baseURL}/api/boards/${boardId}/assets/${assetId}`)).status()).toBe(200);
    expect((await member.request.post(`${baseURL}/api/boards/${boardId}/assets`, { headers: { ...mutationHeaders, "Content-Type": "image/png" }, data: bytes })).status()).toBe(403);
    expect((await member.request.put(`${baseURL}/api/boards/${boardId}/document`, { headers: mutationHeaders, data: { schemaVersion: 1, expectedRevision: document.revision + 1, content: { objects: [image] } } })).status()).toBe(403);
    await membership(context.request, boardId, account.user.id, null);
    await editor.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(editor.getByText("Access removed", { exact: true })).toBeVisible();
    expect((await member.request.get(`${baseURL}/api/boards/${boardId}/assets/${assetId}`)).status()).toBe(404);
    await expect(editor.locator(".image-object-value")).toHaveCount(0);
  } finally { await member.close(); }
});

test("signed image expiry refreshes through the actual authorized API and provider failures support retry", async ({ page, context, browser }) => {
  const account = await signIn(context.request);
  const boardId = await workspaceImage(page, "Signed image refresh");
  const fresh = await browser.newContext();
  try {
    await signIn(fresh.request, account.subject);
    await provider(context.request, { failSigns: 1, signedTtlSeconds: 3 });
    const remote = await fresh.newPage();
    await remote.goto(`${baseURL}/scribble/`);
    await expect(remote.getByLabel("Page title")).toHaveValue("Signed image refresh");
    await remote.getByRole("button", { name: "Zoom options", exact: true }).click(); await remote.getByRole("menuitem", { name: "Reset viewport", exact: true }).click();
    await expect(remote.getByRole("button", { name: "Retry image", exact: true })).toBeVisible();
    await remote.getByRole("button", { name: "Retry image", exact: true }).click();
    await renderedImage(remote);
    const before = (await state(context.request, boardId)).provider.signCalls;
    await expect.poll(async () => (await state(context.request, boardId)).provider.signCalls).toBeGreaterThan(before);
    expect((await state(context.request, boardId)).document?.revision).toBe(2);
  } finally { await fresh.close(); }
});
