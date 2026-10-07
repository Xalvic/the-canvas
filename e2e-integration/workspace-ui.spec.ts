import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { accountMenu, browse, closeDialogs, details, rowActions } from "../e2e/fixtures/ui";
import { BASE_URL, canvasState, createNote, flushLocalDraft, membership, mutationHeaders, signIn, state } from "./fixture";

async function pages(request: APIRequestContext) { return (await (await request.get(`${BASE_URL}/api/boards`)).json()).boards as { id: string; title: string }[]; }
async function ready(page: Page) { await expect(page.getByLabel("Page title")).toBeVisible(); await expect(page.locator(".save-status")).toHaveText("Saved to account"); return (await canvasState(page)).account!.boardId; }
async function start(page: Page) { await signIn(page.context().request); await page.goto("/scribble/"); return ready(page); }

test("guest UI stays usable without the API, saves locally, and has one actionable device failure", async ({ page }) => {
  await page.route(`${BASE_URL}/api/**`, (route) => route.abort("failed"));
  await page.goto("/scribble/"); await expect(page.getByLabel("Drawing title")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pages", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /New page|Save to account|Share/ })).toHaveCount(0);
  await expect(page.locator(".save-status")).toHaveCount(0);
  await createNote(page, "Guest survives API outage", 450, 510); await flushLocalDraft(page); await page.reload();
  await expect(page.getByText("Guest survives API outage", { exact: true })).toBeVisible();
  await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts")).useBoardStore.getState().markSaveError("Controlled device failure"));
  await expect(page.locator(".board-notice")).toHaveCount(1);
  await details(page); await expect(page.getByRole("button", { name: "Retry device save", exact: true })).toBeVisible();
});

test("owners create, rename inline, cancel, share the current page and delete the final page", async ({ page, context }) => {
  const first = await start(page); await expect(page.locator(".page-sidebar")).toBeVisible();
  await page.getByRole("button", { name: "+ New page", exact: true }).click(); await expect.poll(async () => (await canvasState(page)).account?.boardId).not.toBe(first); const second = await ready(page);
  expect((await state(context.request, second)).document!.revision).toBe(1); expect((await canvasState(page)).objects).toHaveLength(0);
  await rowActions(page, "Untitled"); await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("textbox", { name: "Rename Untitled", exact: true });
  await rename.fill("Cancelled rename"); await rename.press("Escape");
  expect((await pages(context.request)).find((board) => board.id === second)!.title).toBe("Untitled");
  await rowActions(page, "Untitled"); await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await rename.fill("Owner page"); await rename.press("Enter");
  await expect(page.getByLabel("Page title")).toHaveValue("Owner page"); await ready(page);
  const title = page.getByLabel("Page title"); await title.fill("Cancelled header title"); await title.press("Escape"); await expect(title).toHaveValue("Owner page");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Share Owner page", exact: true })).toBeVisible(); await closeDialogs(page);
  await rowActions(page, "Owner page"); await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); expect(await pages(context.request)).toHaveLength(2);
  await rowActions(page, "Owner page"); await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete page" }).getByRole("button", { name: "Delete page", exact: true }).click(); await ready(page);
  await rowActions(page, "Untitled"); await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete page" }).getByRole("button", { name: "Delete page", exact: true }).click();
  await expect(page.getByText("Your workspace is empty.", { exact: true })).toBeVisible(); await expect(page.locator("#canvas-editor")).toBeHidden();
  await expect(page.getByRole("button", { name: "Save to account", exact: true })).toHaveCount(0);
  await page.reload(); expect(await pages(context.request)).toHaveLength(0);
});

test("lost New page responses reuse their request after reload without replacing the current drawing", async ({ page, context }) => {
  const first = await start(page); await createNote(page, "Preserved during creation", 450, 510); await ready(page);
  let requestId = "", posts = 0;
  await page.route("**/api/boards", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++; const body = route.request().postDataJSON();
    expect(body.initializeDocument).toBe(true); expect(route.request().headers()["x-scribble-account"]).toBeTruthy();
    if (posts === 1) requestId = body.requestId; else expect(body.requestId).toBe(requestId);
    const response = await route.fetch(); expect(response.ok()).toBeTruthy();
    if (posts === 1) await route.abort("failed"); else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "+ New page", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry new page", exact: true })).toBeVisible();
  expect((await canvasState(page)).account!.boardId).toBe(first); await expect(page.getByText("Preserved during creation", { exact: true })).toBeVisible();
  await page.reload(); await ready(page); await page.getByRole("button", { name: "+ New page", exact: true }).click();
  await expect.poll(async () => (await canvasState(page)).account!.boardId).not.toBe(first); await ready(page);
  expect(posts).toBe(2); expect(await pages(context.request)).toHaveLength(2);
});

test("desktop sidebar visibility survives reload and leaves the world viewport unchanged", async ({ page }) => {
  await start(page);
  const before = await page.locator(".canvas-viewport").boundingBox();
  await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts")).useViewportStore.getState().setViewport({ x: 120, y: -90, zoom: 1.5 }));
  await page.getByRole("button", { name: "Pages", exact: true }).click(); await expect(page.locator(".page-sidebar")).toHaveCount(0);
  expect(await page.locator(".canvas-viewport").boundingBox()).toEqual(before);
  await flushLocalDraft(page); await page.reload(); await ready(page); await expect(page.locator(".page-sidebar")).toHaveCount(0);
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts")).useViewportStore.getState().viewport)).toEqual({ x: 120, y: -90, zoom: 1.5 });
  await page.getByRole("button", { name: "Pages", exact: true }).click(); await expect(page.locator(".page-sidebar")).toBeVisible();
  await page.screenshot({ path: "workspace-ux-evidence/m9-owner-desktop.png" });
});

test("mobile pages start closed and a direct selection closes the drawer", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const first = await start(page);
  await expect(page.locator(".page-sidebar")).toHaveCount(0); await browse(page);
  await page.getByRole("button", { name: "+ New page", exact: true }).click(); await ready(page);
  await expect(page.locator(".page-sidebar")).toHaveCount(0); await browse(page);
  const list = page.getByRole("list", { name: "My pages", exact: true });
  await list.locator("li").filter({ has: page.locator('.page-open:not([aria-current="page"])') }).locator(".page-open").click();
  await ready(page); expect((await canvasState(page)).account!.boardId).toBe(first);
  await expect(page.getByRole("dialog", { name: "Pages", exact: true })).toHaveCount(0); expect(await pages(context.request)).toHaveLength(2);
  await page.screenshot({ path: "workspace-ux-evidence/m9-owner-mobile.png" });
});

test("shared editors rename and save while viewers have no editing or sharing controls", async ({ browser }) => {
  const owner = await browser.newContext(), editor = await browser.newContext(), viewer = await browser.newContext();
  try {
    await signIn(owner.request); const ownerPage = await owner.newPage(); const id = await start(ownerPage);
    const editorUser = await signIn(editor.request), viewerUser = await signIn(viewer.request);
    await membership(owner.request, id, editorUser.user.id, "editor"); await membership(owner.request, id, viewerUser.user.id, "viewer");
    const editPage = await editor.newPage(); await editPage.goto(`${BASE_URL}/scribble/?page=${id}`);
    await expect(editPage.getByLabel("Page title")).toBeEnabled();
    await expect(editPage.getByRole("list", { name: "Shared with me", exact: true })).toBeVisible();
    await expect(editPage.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
    await rowActions(editPage, "Untitled"); await expect(editPage.getByRole("menuitem", { name: "Delete", exact: true })).toHaveCount(0);
    await editPage.getByRole("menuitem", { name: "Rename", exact: true }).click(); const title = editPage.getByRole("textbox", { name: "Rename Untitled", exact: true });
    await title.fill("Edited shared page"); await title.press("Enter"); await ready(editPage);
    await createNote(editPage, "Shared edit", 450, 510); await ready(editPage);
    expect((await state(owner.request, id)).document!.content.objects).toHaveLength(1);
    const viewPage = await viewer.newPage(); await viewPage.goto(`${BASE_URL}/scribble/?page=${id}`);
    await expect(viewPage.getByLabel("Page title")).toBeDisabled(); await expect(viewPage.getByRole("button", { name: "Note tool", exact: true })).toBeDisabled();
    await expect(viewPage.getByRole("button", { name: "Actions for Edited shared page", exact: true })).toHaveCount(0);
    await expect(viewPage.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
    await expect(viewPage.getByText("Shared edit", { exact: true })).toBeVisible();
  } finally { await owner.close(); await editor.close(); await viewer.close(); }
});

test("an invitation is an explicit inbox choice and opens through workspace navigation", async ({ browser }) => {
  const owner = await browser.newContext(), recipient = await browser.newContext();
  try {
    await signIn(owner.request); const ownerPage = await owner.newPage(); const id = await start(ownerPage);
    const invited = await signIn(recipient.request);
    const response = await owner.request.post(`${BASE_URL}/api/boards/${id}/invitations`, { headers: mutationHeaders, data: { email: invited.user.email, role: "viewer" } }); expect(response.ok()).toBeTruthy();
    const inviteId = (await response.json()).invitation.id;
    const page = await recipient.newPage(); await page.goto(`${BASE_URL}/scribble/?invite=${inviteId}`);
    await expect(page.getByRole("dialog", { name: "Invitations", exact: true })).toBeVisible();
    expect((await pages(recipient.request)).some((board) => board.id === id)).toBe(false);
    await page.getByRole("button", { name: "Accept invitation", exact: true }).click(); await page.getByRole("button", { name: "Open page", exact: true }).click();
    await expect(page.getByLabel("Page title")).toBeDisabled(); expect((await canvasState(page)).account!.boardId).toBe(id);
    expect(new URL(page.url()).searchParams.get("page")).toBe(id); await expect(page.getByRole("dialog", { name: "Invitations", exact: true })).toHaveCount(0);
  } finally { await owner.close(); await recipient.close(); }
});

test("avatar sign-out preserves account work and reveals the retained guest drawing", async ({ page, context }) => {
  await page.goto("/scribble/"); await expect(page.getByRole("button", { name: "Sign in with Google", exact: true })).toBeVisible();
  await createNote(page, "Retained on device", 450, 510); await flushLocalDraft(page);
  await signIn(context.request); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); const id = await ready(page);
  await createNote(page, "Account draft", 450, 510); await flushLocalDraft(page);
  const userId = (await canvasState(page)).account!.ownerId;
  await accountMenu(page); await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Drawing title")).toBeVisible(); await expect(page.locator(".page-sidebar")).toHaveCount(0);
  await expect(page.getByText("Retained on device", { exact: true })).toBeVisible();
  expect((await canvasState(page)).account).toBeNull();
  const preserved = await page.evaluate(async ({ id, userId }) => {
    const { accountEditorJournals } = await import(/* @vite-ignore */ "/scribble/src/persistence/accountEditorJournals.ts");
    const { accountBoardStorageId } = await import(/* @vite-ignore */ "/scribble/src/persistence/localBoardStorage.ts");
    const journals = await accountEditorJournals.list(accountBoardStorageId(userId, id));
    return journals.some((journal) => Object.values(journal.board.objects).some((object) => object.type === "card" && object.title === "Account draft"));
  }, { id, userId });
  expect(preserved).toBe(true);
});
