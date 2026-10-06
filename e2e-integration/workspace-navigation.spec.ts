import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { accountMenu, closeDialogs, rowActions } from "../e2e/fixtures/ui";
import { BASE_URL, canvasState, createNote, flushLocalDraft, membership, mutationHeaders, network, openBoard, signIn } from "./fixture";

async function pageRecord(request: APIRequestContext, title: string) {
  const response = await request.post(`${BASE_URL}/api/boards`, { headers: mutationHeaders, data: { title } });
  expect(response.ok()).toBeTruthy();
  const board = (await response.json()).board as { id: string; title: string };
  expect((await request.put(`${BASE_URL}/api/boards/${board.id}/document`, { headers: mutationHeaders,
    data: { schemaVersion: 1, expectedRevision: 0, content: { objects: [] } } })).ok()).toBeTruthy();
  return board;
}
async function active(page: Page, id: string) {
  await expect.poll(async () => (await canvasState(page)).account?.boardId).toBe(id);
  await expect(page.locator("#canvas-editor")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe(id);
}
async function pages(request: APIRequestContext) {
  const response = await request.get(`${BASE_URL}/api/boards`); expect(response.ok()).toBeTruthy(); return (await response.json()).boards as { id: string; title: string }[];
}
async function remember(request: APIRequestContext, id: string) {
  expect((await request.patch(`${BASE_URL}/api/workspace`, { headers: mutationHeaders, data: { lastOpenedBoardId: id } })).ok()).toBeTruthy();
}

test("first account entry in two tabs creates one blank page and reload reopens it", async ({ page, context }) => {
  await signIn(context.request);
  const other = await context.newPage();
  await Promise.all([page.goto("/scribble/"), other.goto("/scribble/")]);
  await expect.poll(async () => (await pages(context.request)).length).toBe(1);
  const [board] = await pages(context.request);
  await Promise.all([active(page, board.id), active(other, board.id)]);
  await page.reload(); await active(page, board.id);
  expect((await pages(context.request)).length).toBe(1);
  await other.close();
});

test("explicit page, last-opened restore, Back/Forward and per-page history/viewport", async ({ page, context }) => {
  await signIn(context.request); const first = await pageRecord(context.request, "Navigation first"), second = await pageRecord(context.request, "Navigation second");
  await remember(context.request, first.id);
  await page.goto(`/scribble/?page=${second.id}#canvas`); await active(page, second.id);
  await page.evaluate(async () => {
    const { useViewportStore } = await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts");
    useViewportStore.getState().setViewport({ x: 120, y: 90, zoom: 1.5 });
  });
  await flushLocalDraft(page); await openBoard(page, first.title); await active(page, first.id);
  await page.goBack(); await active(page, second.id);
  const viewport = await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts")).useViewportStore.getState().viewport);
  expect(viewport).toEqual({ x: 120, y: 90, zoom: 1.5 });
  await page.goForward(); await active(page, first.id);
  const history = await page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const { useSelectionStore } = await import(/* @vite-ignore */ "/scribble/src/store/selectionStore.ts");
    return { past: useDocumentStore.getState().past.length, future: useDocumentStore.getState().future.length, selected: useSelectionStore.getState().selectedIds.size };
  });
  expect(history).toEqual({ past: 0, future: 0, selected: 0 });
  await expect.poll(async () => (await (await context.request.get(`${BASE_URL}/api/workspace`)).json()).workspace.lastOpenedBoardId).toBe(first.id);
  await page.goto("/scribble/"); await active(page, first.id);
  expect(new URL(page.url()).pathname).toBe("/scribble/");
});

test("sign-in preserves the guest original and sign-out journals active text before restoring it", async ({ page, context }) => {
  await page.goto("/scribble/"); await expect(page.locator(".account-trigger")).toHaveText("Sign in");
  await createNote(page, "Retained guest original", 330, 500); await flushLocalDraft(page);
  await signIn(context.request); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(async () => (await pages(context.request)).length).toBe(1);
  const [board] = await pages(context.request); await active(page, board.id);
  expect((await canvasState(page)).objects).toHaveLength(0);
  await createNote(page, "Account pending text", 330, 500);
  await page.locator(".card-object-value").filter({ has: page.getByText("Account pending text", { exact: true }) }).dblclick();
  await page.getByLabel("Card title", { exact: true }).fill("Committed at sign-out");
  const userId = (await canvasState(page)).account!.ownerId;
  await accountMenu(page); await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(async () => (await canvasState(page)).account).toBeNull();
  await closeDialogs(page); await expect(page.getByText("Retained guest original", { exact: true })).toBeVisible();
  const preserved = await page.evaluate(async ({ id, userId }) => {
    const { accountEditorJournals } = await import(/* @vite-ignore */ "/scribble/src/persistence/accountEditorJournals.ts");
    const { accountBoardStorageId } = await import(/* @vite-ignore */ "/scribble/src/persistence/localBoardStorage.ts");
    const journals = await accountEditorJournals.list(accountBoardStorageId(userId, id));
    return journals.flatMap((journal) => Object.values(journal.board.objects).flatMap((object) => object.type === "card" ? [object.title] : []));
  }, { id: board.id, userId });
  expect(preserved).toContain("Committed at sign-out");
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
});

test("account service failure and slow checks retain the loaded page; confirmed expiry returns to guest", async ({ page, context }) => {
  await signIn(context.request); const board = await pageRecord(context.request, "Service retained");
  await page.goto(`/scribble/?page=${board.id}`); await active(page, board.id);
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("alert").filter({ hasText: "Could not check your account" })).toBeVisible();
  await active(page, board.id); await expect(page.locator(".account-trigger")).toHaveText("Account");
  await page.unroute("**/api/auth/me");
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/auth/me", async (route) => { await gate; await route.continue(); });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await active(page, board.id); release(); await page.unrouteAll({ behavior: "wait" });
  expect((await context.request.post(`${BASE_URL}/api/auth/logout`, { headers: mutationHeaders })).ok()).toBeTruthy();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(async () => (await canvasState(page)).account).toBeNull();
  await expect(page.getByRole("alert").filter({ hasText: "Your session ended" })).toBeVisible();
  await expect(page.locator(".account-trigger")).toHaveText("Sign in");
});

test("lost initialization response is recovered without creating a second page", async ({ page, context }) => {
  await signIn(context.request); let dropped = false;
  await page.route("**/api/workspace/initialize", async (route) => {
    if (!dropped) { dropped = true; const response = await route.fetch(); expect(response.ok()).toBeTruthy(); await route.abort("failed"); }
    else await route.continue();
  });
  await page.goto("/scribble/"); await expect(page.getByRole("button", { name: "Retry workspace", exact: true })).toBeVisible();
  expect((await pages(context.request)).length).toBe(1);
  await page.getByRole("button", { name: "Retry workspace", exact: true }).click();
  const [board] = await pages(context.request); await active(page, board.id);
  expect((await pages(context.request)).length).toBe(1);
});

test("list failure never initializes and an initialized empty workspace never recreates defaults", async ({ page, context }) => {
  await signIn(context.request); let initializeCalls = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/workspace/initialize")) initializeCalls++; });
  await page.route("**/api/boards", (route) => route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "List unavailable" } } }));
  await page.goto("/scribble/"); await expect(page.getByRole("button", { name: "Retry workspace", exact: true })).toBeVisible();
  expect(initializeCalls).toBe(0);
  await page.unroute("**/api/boards");
  await page.getByRole("button", { name: "Retry workspace", exact: true }).click();
  await expect.poll(async () => (await pages(context.request)).length).toBe(1);
  const [board] = await pages(context.request); await active(page, board.id);
  await rowActions(page, board.title); await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete account board", exact: true }).getByRole("button", { name: "Delete board", exact: true }).click();
  await closeDialogs(page); await expect(page.getByText("Your workspace is empty.", { exact: true })).toBeVisible();
  await expect(page.locator("#canvas-editor")).toBeHidden(); expect(await pages(context.request)).toHaveLength(0);
  await page.reload(); await expect(page.getByText("Your workspace is empty.", { exact: true })).toBeVisible();
  expect(await pages(context.request)).toHaveLength(0); expect(initializeCalls).toBe(1);
  await page.getByRole("button", { name: "New page", exact: true }).click();
  await expect(page.locator("#canvas-editor")).toBeVisible(); expect(await pages(context.request)).toHaveLength(1);
});

test("current viewer roles are respected and a revoked explicit page falls back", async ({ browser }) => {
  const owner = await browser.newContext(), viewer = await browser.newContext();
  try {
    await signIn(owner.request); const board = await pageRecord(owner.request, "Shared view");
    const viewerAccount = await signIn(viewer.request); await membership(owner.request, board.id, viewerAccount.user.id, "viewer");
    const own = await pageRecord(viewer.request, "Viewer own page");
    const page = await viewer.newPage(); await page.goto(`${BASE_URL}/scribble/?page=${board.id}`); await active(page, board.id);
    await expect(page.getByText("Shared with you · Can view", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Note tool", exact: true })).toBeDisabled();
    await membership(owner.request, board.id, viewerAccount.user.id, null);
    await page.reload(); await active(page, own.id);
    await expect(page.getByRole("alert").filter({ hasText: "That page is unavailable" })).toBeVisible();
  } finally { await owner.close(); await viewer.close(); }
});

test("page and invitation intent survive a simulated authentication redirect without acceptance", async ({ page, context }) => {
  const invite = randomUUID();
  const { subject } = await signIn(context.request); const board = await pageRecord(context.request, "Linked page");
  await context.request.post(`${BASE_URL}/api/auth/logout`, { headers: mutationHeaders });
  await page.goto(`/scribble/?page=${board.id}&invite=${invite}`);
  await expect(page.locator(".account-trigger")).toHaveText("Sign in");
  await page.evaluate(async () => {
    (await import(/* @vite-ignore */ "/scribble/src/persistence/workspaceNavigation.ts")).rememberPageIntent();
    (await import(/* @vite-ignore */ "/scribble/src/components/ServerBoards/invitationIntent.ts")).rememberInvitationIntent();
  });
  // Fixture restores the same Google subject; no real OAuth/provider is contacted.
  await signIn(context.request, subject);
  await page.goto("/scribble/");
  await expect(page.getByRole("dialog", { name: "Your boards", exact: true })).toBeVisible();
  await expect(page.getByText("Use the invited Google account. Acceptance is your choice; signing in does not accept or open a board.", { exact: true })).toBeVisible();
  await active(page, board.id);
  expect((await pages(context.request)).length).toBe(1);
});

test("a lost account save remains journaled while switching pages and navigating Back", async ({ page, context }) => {
  await signIn(context.request);
  const first = await pageRecord(context.request, "Pending first"), second = await pageRecord(context.request, "Pending second");
  await page.goto(`/scribble/?page=${first.id}`); await active(page, first.id);
  await network(context.request, 1);
  await createNote(page, "Pending response retained", 330, 500);
  await expect(page.locator(".save-status")).toContainText("Account save failed"); await flushLocalDraft(page);
  const pending = (await canvasState(page)).account!.pendingOperation!.input;
  await openBoard(page, second.title); await active(page, second.id);
  await page.goBack(); await active(page, first.id);
  await expect(page.getByText("Pending response retained", { exact: true })).toBeVisible();
  expect((await canvasState(page)).account!.pendingOperation!.input).toEqual(pending);
  await expect(page.locator(".save-status")).toContainText("Account save failed");
});

test("account switching clears the old visible page and cache while preserving its journal", async ({ page, context }) => {
  const original = await signIn(context.request); const first = await pageRecord(context.request, "Private original page");
  await page.goto(`/scribble/?page=${first.id}`); await active(page, first.id);
  await createNote(page, "Original account journal", 330, 500); await flushLocalDraft(page);
  const other = await signIn(context.request); const second = await pageRecord(context.request, "Other account page");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await active(page, second.id);
  expect((await canvasState(page)).account?.ownerId).toBe(other.user.id);
  await page.getByRole("button", { name: "Boards", exact: true }).click();
  await expect(page.getByRole("list", { name: "Account boards", exact: true }).getByText(first.title, { exact: true })).toHaveCount(0);
  await closeDialogs(page);
  const preserved = await page.evaluate(async ({ userId, boardId }) => {
    const { accountEditorJournals } = await import(/* @vite-ignore */ "/scribble/src/persistence/accountEditorJournals.ts");
    const { accountBoardStorageId } = await import(/* @vite-ignore */ "/scribble/src/persistence/localBoardStorage.ts");
    return (await accountEditorJournals.list(accountBoardStorageId(userId, boardId))).some((journal) => Object.values(journal.board.objects).some((object) => object.type === "card" && object.title === "Original account journal"));
  }, { userId: original.user.id, boardId: first.id });
  expect(preserved).toBe(true);
  await signIn(context.request, original.subject);
  await page.goto(`/scribble/?page=${first.id}`); await active(page, first.id);
  await expect(page.getByText("Original account journal", { exact: true })).toBeVisible();
});
