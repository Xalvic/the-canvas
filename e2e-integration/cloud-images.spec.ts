import { browse, closeDialogs, details, backToDevice, newAccountBoard, explicitSave } from "../e2e/fixtures/ui";
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
async function dropImage(page: Page, name = "fixture.png") {
  const png = await sharp({ create: { width: 480, height: 320, channels: 4, background: { r: 20, g: 130, b: 240, alpha: 1 } } }).png().toBuffer();
  await page.locator(".canvas-viewport").evaluate((element, input) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(input.bytes), (char) => char.charCodeAt(0))], input.name, { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 600, clientY: 500 }));
  }, { name, bytes: png.toString("base64") });
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
async function openBoard(page: Page, title: string) {
  await browse(page);
  if (!await page.getByText(title, { exact: true }).isVisible()) await page.getByRole("button", { name: "Shared with me", exact: true }).click();
  await page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) }).locator(".board-open").click();
  await expect(page.getByLabel("Board title")).toHaveValue(title);
  await closeDialogs(page);
  await expect(page.getByLabel("Board title")).toBeVisible();
  // Each device owns its viewport. Center the world origin with the real canvas
  // control before checking image rendering, including negative world positions.
  await page.getByRole("button", { name: "Reset viewport", exact: true }).click();
}
async function uploadGuestImage(page: Page, title: string) {
  await page.goto("/scribble/");
  await page.getByLabel("Board title").fill(title);
  await dropImage(page);
  await explicitSave(page, "Save to account");
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
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

test("stopping an explicit image request preserves the destination draft and retry creates no second board", async ({ page, context }) => {
  await signIn(context.request);
  await page.goto("/scribble/");
  await page.getByLabel("Board title").fill("Cancelled upload fixture");
  await dropImage(page);
  await provider(context.request, { uploadDelayMs: 1500 });
  await page.getByRole("button", { name: "Save to account", exact: true }).click();
  await page.getByRole("dialog", { name: "Save to account", exact: true }).getByRole("button", { name: "Save to account", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Save to account", exact: true }).getByText("Uploading images… 0/1", { exact: true })).toBeVisible();
  const boardId = (await currentBoard(page))!;
  await page.getByRole("button", { name: "Stop request", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("Account save failed");
  await flushLocalDraft(page);
  expect((await (await context.request.get(`${baseURL}/api/boards`)).json()).boards).toHaveLength(1);
  await renderedImage(page);
  await provider(context.request, { uploadDelayMs: 0 });
  // Aborting the browser does not cancel the provider's already accepted work.
  // Wait for that bounded request to release the existing per-user upload gate.
  await expect.poll(async () => (await state(context.request, boardId)).assets.filter((asset) => asset.status === "pending").length).toBe(0);
  await explicitSave(page, "Upload and save");
  await details(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await closeDialogs(page);
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  expect(await currentBoard(page)).toBe(boardId);
  expect((await (await context.request.get(`${baseURL}/api/boards`)).json()).boards).toHaveLength(1);
  expect((await state(context.request, boardId)).document?.content.objects).toHaveLength(1);
});

test("guest image stays local through login; explicit upload persists a same-board asset and fresh-device reopen renders signed bytes", async ({ page, context, browser }) => {
  await page.goto("/scribble/");
  await page.getByLabel("Board title").fill("Explicit image upload");
  await dropImage(page);
  await renderedImage(page);
  await flushLocalDraft(page);
  const account = await signIn(context.request);
  await page.reload();
  await expect(page.getByRole("button", { name: "Save to account", exact: true })).toBeVisible();
  expect((await (await context.request.get(`${baseURL}/api/boards`)).json()).boards).toEqual([]);
  await explicitSave(page, "Save to account");
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  const boardId = (await currentBoard(page))!;
  const persisted = await state(context.request, boardId);
  expect(persisted.document?.revision).toBe(1);
  expect(persisted.assets).toHaveLength(1);
  expect(persisted.assets[0]).toMatchObject({ status: "ready", board_id: boardId, last_referenced_at: expect.any(String) });
  expect(persisted.document?.content.objects[0].assetId).toBe(persisted.assets[0].id);
  expect(JSON.stringify(persisted.document)).not.toMatch(/blob:|https?:|data:|cloudAsset/);
  const fresh = await browser.newContext();
  try {
    const { page: reopened } = await newSignedInPage(fresh, account.subject);
    await openBoard(reopened, "Explicit image upload");
    await renderedImage(reopened);
    expect(await reopened.locator(".image-object-value").getAttribute("src")).toContain("/api/__fixture/image?");
  } finally { await fresh.close(); }
  await backToDevice(page);
  await renderedImage(page);
  expect(await page.locator(".image-object-value").getAttribute("src")).toMatch(/^blob:/);
});

test("account insertion waits for explicit image upload; failure and reload keep the local file retryable", async ({ page, context }) => {
  await signIn(context.request);
  await page.goto("/scribble/");
  await newAccountBoard(page);
  await closeDialogs(page);
  await expect(page.getByLabel("Board title")).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  const boardId = (await currentBoard(page))!;
  await dropImage(page);
  await details(page);
  await expect(page.getByRole("dialog", { name: "Save details", exact: true }).getByRole("button", { name: "Upload and save", exact: true })).toBeVisible();
  await closeDialogs(page);
  expect((await state(context.request, boardId)).assets).toEqual([]);
  await provider(context.request, { failUploads: 1 });
  await explicitSave(page, "Upload and save");
  await expect(page.locator(".save-status")).toHaveText("Account save failed · saved on this device");
  expect((await state(context.request, boardId)).document?.content.objects).toEqual([]);
  await flushLocalDraft(page);
  await page.reload();
  await openBoard(page, "Untitled board");
  await details(page);
  await expect(page.getByRole("dialog", { name: "Save details", exact: true }).getByRole("button", { name: "Upload and save", exact: true })).toBeVisible();
  await closeDialogs(page);
  await renderedImage(page);
  await explicitSave(page, "Upload and save");
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  const persisted = await state(context.request, boardId);
  expect(persisted.document?.content.objects).toHaveLength(1);
  expect(persisted.assets.filter((asset) => asset.status === "ready")).toHaveLength(1);
});

test("cross-board copy uploads a new asset instead of saving the source reference", async ({ page, context }) => {
  await signIn(context.request);
  const sourceId = await uploadGuestImage(page, "Copy source");
  const sourceAsset = (await state(context.request, sourceId)).assets[0].id;
  await backToDevice(page);
  await openBoard(page, "Copy source");
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
  await expect(page.getByLabel("Board title")).toBeVisible();
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  const targetId = (await currentBoard(page))!;
  await page.evaluate(async () => {
    const { pasteClipboard } = await import(/* @vite-ignore */ "/scribble/src/clipboard/clipboardCommands.ts");
    pasteClipboard();
  });
  await details(page);
  await expect(page.getByRole("dialog", { name: "Save details", exact: true }).getByRole("button", { name: "Upload and save", exact: true })).toBeVisible();
  await closeDialogs(page);
  expect((await state(context.request, targetId)).document?.content.objects).toEqual([]);
  await explicitSave(page, "Upload and save");
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  const target = await state(context.request, targetId);
  expect(target.assets).toHaveLength(1);
  expect(target.assets[0].id).not.toBe(sourceAsset);
  expect(target.document?.content.objects[0].assetId).toBe(target.assets[0].id);
  expect((await state(context.request, sourceId)).document?.content.objects[0].assetId).toBe(sourceAsset);
});

test("save-as-new copies cloud image bytes into the new board and leaves the original asset retained", async ({ page, context }) => {
  await signIn(context.request);
  const sourceId = await uploadGuestImage(page, "Save a cloud copy");
  await backToDevice(page);
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
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  const targetId = (await currentBoard(page))!;
  expect(targetId).not.toBe(sourceId);
  const target = await state(context.request, targetId);
  expect(target.assets[0].id).not.toBe(original.assets[0].id);
  expect(target.document?.content.objects[0].assetId).toBe(target.assets[0].id);
  expect((await state(context.request, sourceId)).assets[0].last_referenced_at).not.toBeNull();
});

test("editor uploads persist, viewer reads are signed, and revoked membership blocks fresh image access", async ({ page, context, browser }) => {
  await signIn(context.request);
  const boardId = await uploadGuestImage(page, "Role-protected images");
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
    await expect(editor.locator(".save-status")).toHaveText("Can view · account board");
    expect((await member.request.get(`${baseURL}/api/boards/${boardId}/assets/${assetId}`)).status()).toBe(200);
    expect((await member.request.post(`${baseURL}/api/boards/${boardId}/assets`, { headers: { ...mutationHeaders, "Content-Type": "image/png" }, data: bytes })).status()).toBe(403);
    expect((await member.request.put(`${baseURL}/api/boards/${boardId}/document`, { headers: mutationHeaders, data: { schemaVersion: 1, expectedRevision: document.revision + 1, content: { objects: [image] } } })).status()).toBe(403);
    await membership(context.request, boardId, account.user.id, null);
    await editor.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(editor.locator(".save-status")).toHaveText("Access removed");
    expect((await member.request.get(`${baseURL}/api/boards/${boardId}/assets/${assetId}`)).status()).toBe(404);
    await expect(editor.locator(".image-object-value")).toHaveCount(0);
  } finally { await member.close(); }
});

test("signed image expiry refreshes through the actual authorized API and provider failures support retry", async ({ page, context, browser }) => {
  const account = await signIn(context.request);
  const boardId = await uploadGuestImage(page, "Signed image refresh");
  const fresh = await browser.newContext();
  try {
    const { page: remote } = await newSignedInPage(fresh, account.subject);
    await provider(context.request, { failSigns: 1, signedTtlSeconds: 3 });
    await openBoard(remote, "Signed image refresh");
    await expect(remote.getByRole("button", { name: "Retry image", exact: true })).toBeVisible();
    await remote.getByRole("button", { name: "Retry image", exact: true }).click();
    await renderedImage(remote);
    const before = (await state(context.request, boardId)).provider.signCalls;
    await expect.poll(async () => (await state(context.request, boardId)).provider.signCalls).toBeGreaterThan(before);
    expect((await state(context.request, boardId)).document?.revision).toBe(1);
  } finally { await fresh.close(); }
});
