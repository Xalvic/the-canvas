import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { accountMenu, browse, closeDialogs } from "../e2e/fixtures/ui";
import { BASE_URL, canvasState, connected, createNote, editNote, flushLocalDraft, membership, mutationHeaders, signIn, state } from "./fixture";

async function owner(page: Page, context: BrowserContext) {
  const account = await signIn(context.request);
  const title = `R5-${randomUUID()}`;
  const create = await context.request.post(`${BASE_URL}/api/boards`, { headers: mutationHeaders, data: { title, requestId: randomUUID(), initializeDocument: true } });
  expect(create.status()).toBe(201); const id = (await create.json()).board.id as string;
  const note = { id: "shared-note", type: "card", title: "Link baseline", body: "", x: 360, y: 320, width: 260, height: 150, zIndex: 1, createdAt: 1, updatedAt: 1 };
  expect((await context.request.put(`${BASE_URL}/api/boards/${id}/document`, { headers: mutationHeaders,
    data: { schemaVersion: 1, expectedRevision: 1, content: { objects: [note] } } })).ok()).toBeTruthy();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/scribble/?page=${id}`); await expect(page.getByLabel("Page title")).toHaveValue(title); await connected(page);
  await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts")).useViewportStore.getState().setViewport({ x: 0, y: 0, zoom: 1 }));
  return { id, title, account };
}
async function copy(page: Page) {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}
async function settings(page: Page) {
  await closeDialogs(page); await page.getByRole("button", { name: "App menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Link settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Link settings", exact: true }); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Link permission", exact: true })).toBeEnabled(); return dialog;
}
async function openLink(page: Page, url: string) {
  // Avoid embedding a disposable secret in a Playwright navigation log or trace.
  await page.evaluate((target) => { window.location.assign(target); }, url);
}
async function source(page: Page) {
  return page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/persistence/localBoardStorage.ts")).loadLocalBoard());
}
async function browserErrors(page: Page) {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message)); return errors;
}

test("one-click reusable Share, two recipients, server-enforced viewer/editor roles and live revocation", async ({ page, context, browser }) => {
  const errors = await browserErrors(page); const { id, title } = await owner(page, context);
  const before = await context.request.get(`${BASE_URL}/api/boards/${id}/share-link`); expect((await before.json()).settings.enabled).toBe(false);
  const url = await copy(page); expect(new URL(url).pathname).toBe("/scribble/"); expect(new URL(url).hash.startsWith("#share=")).toBe(true);
  await expect(page.locator("dialog[open]")).toHaveCount(0); await expect(page.locator('input[type="email"]')).toHaveCount(0);
  expect((await copy(page)) === url).toBe(true);
  const viewerContext = await browser.newContext(), editorContext = await browser.newContext();
  try {
    await signIn(viewerContext.request); const viewer = await viewerContext.newPage(); await openLink(viewer, url);
    await expect(viewer.getByLabel("Page title")).toHaveValue(title); await expect(viewer.locator(".board-location")).toHaveText("Can view");
    await expect(viewer.getByRole("button", { name: "Note tool", exact: true })).toBeDisabled();
    const viewerDocument = (await state(context.request, id)).document!;
    const viewedNote = viewerDocument.content.objects[0];
    expect((await viewerContext.request.post(`${BASE_URL}/api/boards/${id}/operations`, { headers: mutationHeaders,
      data: { operationId: randomUUID(), baseRevision: viewerDocument.revision, changes: [{ id: viewedNote.id, before: viewedNote, after: { ...viewedNote, title: "Forbidden viewer write" } }] } })).status()).toBe(403);
    expect((await viewerContext.request.get(`${BASE_URL}/api/boards`)).ok()).toBeTruthy();
    const viewerList = (await (await viewerContext.request.get(`${BASE_URL}/api/boards`)).json()).boards;
    expect(viewerList).toHaveLength(1); expect(viewerList[0].id).toBe(id);
    expect(new URL(viewer.url()).hash).toBe(""); expect(new URL(viewer.url()).searchParams.get("page")).toBe(id);
    expect(await viewer.evaluate(() => sessionStorage.getItem("scribble:pending-share-link"))).toBeNull();
    await browse(viewer, "Shared with me"); await expect(viewer.locator(".page-sidebar")).toContainText("Shared with me");
    const dialog = await settings(page); await dialog.getByLabel("Link permission").selectOption("editor");
    await expect(dialog.getByText("Link permission updated.", { exact: true })).toBeVisible(); await closeDialogs(page);
    await signIn(editorContext.request); const editor = await editorContext.newPage(); await openLink(editor, url);
    await expect(editor.getByLabel("Page title")).toHaveValue(title); await expect(editor.locator(".board-location")).toHaveText("Can edit");
    await connected(editor); await editNote(editor, "Link baseline", "Link editor save");
    await expect.poll(async () => (await state(context.request, id)).document!.content.objects[0]).toMatchObject({ title: "Link editor save" });
    await expect.poll(async () => (await canvasState(page)).objects[0]).toMatchObject({ title: "Link editor save" });
    await expect(editor.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
    expect((await editorContext.request.patch(`${BASE_URL}/api/boards/${id}/share-link`, { headers: mutationHeaders,
      data: { requestId: randomUUID(), expectedVersion: 2, enabled: false } })).status()).toBe(403);
    await editorContext.setOffline(true); await editNote(editor, "Link editor save", "Retained link draft"); await flushLocalDraft(editor);
    const stopDialog = await settings(page); await stopDialog.getByRole("button", { name: "Stop sharing", exact: true }).click();
    await expect(stopDialog.getByText("Link sharing is off.", { exact: true })).toBeVisible();
    await editorContext.setOffline(false); await expect(editor.locator(".board-location")).toHaveText("Access removed", { timeout: 10_000 });
    expect((await editorContext.request.get(`${BASE_URL}/api/boards/${id}/document`)).status()).toBe(404);
    expect((await canvasState(editor)).objects[0]).toMatchObject({ title: "Retained link draft" });
    expect((await viewerContext.request.get(`${BASE_URL}/api/boards/${id}/document`)).status()).toBe(404);
    await closeDialogs(page); const fresh = await copy(page); expect(fresh !== url).toBe(true);
    const unavailable = await viewerContext.request.post(`${BASE_URL}/api/share-links/open`, { headers: mutationHeaders, data: { token: new URL(url).hash.slice(7) } });
    expect(unavailable.status()).toBe(404);
    expect(errors).toEqual([]);
  } finally { await viewerContext.setOffline(false).catch(() => {}); await editorContext.setOffline(false).catch(() => {}); await viewerContext.close(); await editorContext.close(); }
});

test("signed-out recipient keeps guest work, survives cancelled Google sign-in and opens without an incidental page", async ({ page, context, browser }) => {
  const { id, title } = await owner(page, context); const url = await copy(page);
  const guestContext = await browser.newContext();
  try {
    const recipient = await guestContext.newPage(); await recipient.goto("/scribble/");
    await expect(recipient.getByLabel("Drawing title")).toBeVisible(); await createNote(recipient, "Recipient guest", 340, 500); await flushLocalDraft(recipient);
    const original = await source(recipient); const reads: string[] = [];
    recipient.on("request", (request) => { const path = new URL(request.url()).pathname; if (/^\/api\/(boards|share-links|workspace)/.test(path)) reads.push(path); });
    await openLink(recipient, url); await expect(recipient.getByRole("region", { name: "Shared page", exact: true })).toContainText("Sign in with Google");
    await expect(recipient.getByText(title, { exact: true })).toHaveCount(0); expect(reads).toHaveLength(0);
    expect((await guestContext.request.get(`${BASE_URL}/api/boards/${id}/document`)).status()).toBe(401);
    await recipient.getByRole("button", { name: "Sign in to open page", exact: true }).click();
    await expect(recipient.getByRole("checkbox", { name: "Bring this drawing into my workspace" })).toHaveCount(0);
    await recipient.route("**/api/auth/google", (route) => route.fulfill({ status: 302, headers: { location: "/scribble/?authError=denied" } }));
    const providerPaths: string[] = [];
    recipient.on("request", (request) => { if (new URL(request.url()).pathname === "/api/auth/google") providerPaths.push(request.url()); });
    await recipient.getByRole("link", { name: "Sign in with Google", exact: true }).click();
    await expect(recipient.getByRole("alert").filter({ hasText: "cancelled" })).toBeVisible();
    expect(await source(recipient)).toEqual(original); expect(await recipient.evaluate(() => !!sessionStorage.getItem("scribble:pending-share-link"))).toBe(true);
    expect(providerPaths.every((path) => new URL(path).search === "")).toBe(true);
    await recipient.unroute("**/api/auth/google"); await recipient.getByRole("link", { name: "Sign in with Google", exact: true }).click();
    await expect(recipient.getByLabel("Page title")).toHaveValue(title); await expect(recipient.locator(".board-location")).toHaveText("Can view");
    const list = (await (await guestContext.request.get(`${BASE_URL}/api/boards`)).json()).boards;
    expect(list).toHaveLength(1); expect(list[0].role).toBe("viewer"); expect(await source(recipient)).toEqual(original);
    expect(new URL(recipient.url()).hash).toBe("");
    await accountMenu(recipient); await recipient.getByRole("menuitem", { name: "Sign out", exact: true }).click(); await closeDialogs(recipient);
    await expect(recipient.getByText("Recipient guest", { exact: true })).toBeVisible(); await expect(recipient.getByText("Link baseline", { exact: true })).toHaveCount(0);
  } finally { await guestContext.close(); }
});

test("clipboard failure offers selectable fallback and a fresh copy click without a second link mutation", async ({ page, context }) => {
  await owner(page, context); let posts = 0;
  page.on("request", (request) => { if (request.url().endsWith("/share-link/copy")) posts++; });
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Blocked"); } } }); });
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Copy link", exact: true }); await expect(dialog).toBeVisible();
  const field = dialog.getByLabel("Shared page link", { exact: true }); expect(await field.inputValue().then((value) => new URL(value).hash.startsWith("#share="))).toBe(true);
  await field.focus(); expect(await field.evaluate((input) => (input as HTMLInputElement).selectionStart === 0 && (input as HTMLInputElement).selectionEnd === (input as HTMLInputElement).value.length)).toBe(true);
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } }); });
  await dialog.getByRole("button", { name: "Copy link again", exact: true }).click();
  await expect(dialog).toBeHidden(); await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible(); expect(posts).toBe(1);
});

test("lost committed response and reload retry the original intent, while a later Stop supersedes it", async ({ page, context }) => {
  const { id } = await owner(page, context); const identities: string[] = []; let lose = true;
  await page.route("**/share-link/copy", async (route) => {
    identities.push(route.request().postDataJSON().requestId);
    if (lose) { lose = false; expect((await route.fetch()).ok()).toBeTruthy(); await route.abort("failed"); } else await route.continue();
  });
  await page.getByRole("button", { name: "Share", exact: true }).click(); await expect(page.getByRole("button", { name: "Retry link request", exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByLabel("Page title")).toBeVisible(); await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible(); expect(identities).toHaveLength(2); expect(identities[0]).toBe(identities[1]);
  lose = true; await page.getByRole("button", { name: "Share", exact: true }).click(); await expect(page.getByRole("button", { name: "Retry link request", exact: true })).toBeVisible();
  const current = (await (await context.request.get(`${BASE_URL}/api/boards/${id}/share-link`)).json()).settings;
  expect((await context.request.patch(`${BASE_URL}/api/boards/${id}/share-link`, { headers: mutationHeaders,
    data: { requestId: randomUUID(), expectedVersion: current.version, enabled: false } })).ok()).toBeTruthy();
  await page.getByRole("button", { name: "Retry link request", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Review the current settings" })).toBeVisible();
  expect((await (await context.request.get(`${BASE_URL}/api/boards/${id}/share-link`)).json()).settings.enabled).toBe(false);
});

test("navigation fences a delayed Share response and preserves edited work", async ({ page, context }) => {
  const { id } = await owner(page, context); let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
  let dispatched = false, writes = 0;
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { (window as unknown as { writes: number }).writes = ((window as unknown as { writes?: number }).writes ?? 0) + 1; } } }); });
  await page.route("**/share-link/copy", async (route) => { const response = await route.fetch(); dispatched = true; await wait; await route.fulfill({ response }).catch(() => {}); });
  await editNote(page, "Link baseline", "Saved before Share"); await flushLocalDraft(page);
  await page.getByRole("button", { name: "Share", exact: true }).click(); await expect.poll(() => dispatched).toBe(true);
  await page.getByRole("button", { name: "+ New page", exact: true }).click();
  await expect.poll(async () => (await canvasState(page)).account?.boardId).not.toBe(id); release();
  await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toHaveCount(0);
  writes = await page.evaluate(() => (window as unknown as { writes?: number }).writes ?? 0); expect(writes).toBe(0);
  await expect.poll(async () => (await state(context.request, id)).document!.content.objects[0]).toMatchObject({ title: "Saved before Share" });
});

test("guest Share requires explicit transfer consent and resumes on its sole exact destination", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/scribble/"); await expect(page.getByLabel("Drawing title")).toBeVisible();
  await createNote(page, "Shared guest original", 340, 500); await flushLocalDraft(page); const original = await source(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share this drawing", exact: true }); await expect(dialog).toBeVisible();
  const consent = dialog.getByRole("checkbox", { name: "Bring this drawing into my workspace", exact: true }); await expect(consent).not.toBeChecked();
  await expect(dialog.getByRole("link", { name: "Sign in with Google", exact: true })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape"); expect(await source(page)).toEqual(original);
  await page.getByRole("button", { name: "Share", exact: true }).click(); await consent.check();
  await dialog.getByRole("link", { name: "Sign in with Google", exact: true }).click();
  await expect(page.getByLabel("Page title")).toBeVisible(); await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
  const id = (await canvasState(page)).account!.boardId; const list = (await (await context.request.get(`${BASE_URL}/api/boards`)).json()).boards;
  expect(list).toHaveLength(1); expect(list[0].id).toBe(id); expect((await state(context.request, id)).document!.content.objects).toHaveLength(1);
  expect(await source(page)).toEqual(original); expect((await (await context.request.get(`${BASE_URL}/api/boards/${id}/share-link`)).json()).settings.enabled).toBe(true);
});

test("legacy invitation acceptance and independent invited membership survive Stop", async ({ page, context, browser }) => {
  const { id, title } = await owner(page, context); await copy(page); const memberContext = await browser.newContext();
  try {
    const member = await signIn(memberContext.request); await membership(context.request, id, member.user.id, "editor");
    const dialog = await settings(page); await dialog.getByRole("button", { name: "Stop sharing", exact: true }).click(); await expect(dialog.getByText("Link sharing is off.", { exact: true })).toBeVisible();
    expect((await memberContext.request.get(`${BASE_URL}/api/boards/${id}/document`)).status()).toBe(200);
    const inviteSubject = `legacy-${randomUUID()}`; const invitation = await context.request.post(`${BASE_URL}/api/boards/${id}/invitations`, {
      headers: mutationHeaders, data: { email: `${inviteSubject}@example.com`, role: "viewer" } }); expect(invitation.ok()).toBeTruthy();
    const invitationId = (await invitation.json()).invitation.id as string;
    await signIn(memberContext.request, inviteSubject); const recipient = await memberContext.newPage(); await recipient.goto(`/scribble/?invite=${invitationId}`);
    const inbox = recipient.getByRole("region", { name: "Invitations", exact: true }); await expect(inbox.getByText(title, { exact: true })).toBeVisible();
    await inbox.getByRole("button", { name: "Accept invitation", exact: true }).click(); await inbox.getByRole("button", { name: "Open page", exact: true }).click();
    await expect(recipient.getByLabel("Page title")).toHaveValue(title); await expect(recipient.locator(".board-location")).toHaveText("Can view");
  } finally { await memberContext.close(); }
});

test("light/dark desktop/mobile Link settings stay bounded with keyboard focus and no email form", async ({ page, context }) => {
  await owner(page, context); await copy(page);
  for (const theme of ["light", "dark"] as const) for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.evaluate(async (preference) => (await import(/* @vite-ignore */ "/scribble/src/store/themeStore.ts")).useThemeStore.getState().setPreference(preference), theme);
    const dialog = await settings(page); await expect(page.locator('input[type="email"]')).toHaveCount(0);
    const box = (await dialog.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
    const body = dialog.locator(".dialog-body"); if (await body.count()) await body.evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: `ui-redesign-evidence/r5-settings-${width}-${theme}.png` });
    await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "App menu", exact: true })).toBeFocused();
  }
});

test("a transient recipient failure offers Retry, while invalid/stopped links reveal no document", async ({ page, context, browser }) => {
  const { id, title } = await owner(page, context); const url = await copy(page); const recipientContext = await browser.newContext();
  try {
    await signIn(recipientContext.request); const recipient = await recipientContext.newPage(); let drop = true;
    await recipient.route("**/api/share-links/open", async (route) => { if (drop) { drop = false; await route.abort("failed"); } else await route.continue(); });
    await openLink(recipient, url);
    const entry = recipient.getByRole("region", { name: "Shared page", exact: true }); await expect(entry.getByRole("button", { name: "Retry shared page" })).toBeVisible();
    await expect(recipient.getByText(title, { exact: true })).toHaveCount(0); await expect(entry).not.toContainText("Ask its owner");
    await entry.getByRole("button", { name: "Retry shared page" }).click(); await expect(recipient.getByLabel("Page title")).toHaveValue(title);
    const dialog = await settings(page); await dialog.getByRole("button", { name: "Stop sharing", exact: true }).click(); await expect(dialog.getByText("Link sharing is off.", { exact: true })).toBeVisible();
    await recipient.goto("/scribble/"); await openLink(recipient, url); await expect(entry).toContainText("Ask its owner for a current link");
    expect((await recipientContext.request.get(`${BASE_URL}/api/boards/${id}/document`)).status()).toBe(404);
    await recipient.evaluate(() => { window.location.hash = "share=invalid"; }); await expect(entry).toContainText("Check the original link");
  } finally { await recipientContext.close(); }
});

test("unsupported capability makes Share recoverable without copying a nonfunctional URL", async ({ page, context }) => {
  const { id } = await owner(page, context); let linkRequests = 0;
  await page.route("**/api/auth/me", async (route) => { const response = await route.fetch(); const payload = await response.json(); delete payload.capabilities.shareLinks; await route.fulfill({ response, json: payload }); });
  page.on("request", (request) => { if (/share-link/.test(new URL(request.url()).pathname)) linkRequests++; });
  await page.reload(); await expect(page.getByLabel("Page title")).toBeVisible(); await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "unavailable on this server" })).toBeVisible(); expect(linkRequests).toBe(0);
  expect((await (await context.request.get(`${BASE_URL}/api/boards/${id}/share-link`)).json()).settings.enabled).toBe(false);
});

test("blocked tab storage keeps the recipient link and provides explicit Google redirect recovery", async ({ page, context, browser }) => {
  await owner(page, context); const url = await copy(page); const recipientContext = await browser.newContext();
  try {
    const recipient = await recipientContext.newPage(); await openLink(recipient, url);
    await recipient.getByRole("button", { name: "Sign in to open page", exact: true }).click();
    let redirects = 0; recipient.on("request", (request) => { if (new URL(request.url()).pathname === "/api/auth/google") redirects++; });
    await recipient.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("Blocked"); }; });
    await recipient.getByRole("link", { name: "Sign in with Google", exact: true }).click();
    await expect(recipient.getByRole("alert").filter({ hasText: "reopen the original link" })).toBeVisible(); expect(redirects).toBe(0);
    expect(new URL(recipient.url()).hash.startsWith("#share=")).toBe(true);
  } finally { await recipientContext.close(); }
});

test("opening a link preserves a pending consented transfer and resumes its recorded destination", async ({ page, context, browser }) => {
  const { id, title } = await owner(page, context); const url = await copy(page); const transferContext = await browser.newContext();
  try {
    await transferContext.grantPermissions(["clipboard-read", "clipboard-write"]); const recipient = await transferContext.newPage();
    await recipient.goto("/scribble/"); await expect(recipient.getByLabel("Drawing title")).toBeVisible(); await createNote(recipient, "Pending transfer original", 340, 500); await flushLocalDraft(recipient);
    const original = await source(recipient); let drop = true;
    await recipient.route("**/api/boards", async (route) => {
      if (route.request().method() === "POST" && drop) { drop = false; expect((await route.fetch()).ok()).toBeTruthy(); await route.abort("failed"); }
      else await route.continue();
    });
    await recipient.getByRole("button", { name: "Share", exact: true }).click();
    const transferDialog = recipient.getByRole("dialog", { name: "Share this drawing", exact: true });
    await transferDialog.getByRole("checkbox", { name: "Bring this drawing into my workspace" }).check(); await transferDialog.getByRole("link", { name: "Sign in with Google", exact: true }).click();
    await expect(recipient.getByRole("button", { name: "Retry transfer", exact: true })).toBeVisible();
    const before = (await (await transferContext.request.get(`${BASE_URL}/api/boards`)).json()).boards; expect(before).toHaveLength(1); const destination = before[0].id as string;
    await openLink(recipient, url); await expect(recipient.getByLabel("Page title")).toHaveValue(title); await expect(recipient.locator(".board-location")).toHaveText("Can view");
    expect((await canvasState(recipient)).account!.boardId).toBe(id); expect((await state(context.request, id)).document!.content.objects).toHaveLength(1);
    await accountMenu(recipient); await recipient.getByRole("menuitem", { name: "Resume drawing transfer", exact: true }).click();
    await recipient.getByRole("button", { name: "Resume drawing transfer", exact: true }).click();
    await expect.poll(async () => (await canvasState(recipient)).account?.boardId).toBe(destination);
    await expect(recipient.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
    expect((await state(transferContext.request, destination)).document!.content.objects[0]).toMatchObject({ title: "Pending transfer original" });
    const after = (await (await transferContext.request.get(`${BASE_URL}/api/boards`)).json()).boards; expect(after).toHaveLength(2); expect(after.filter((board: { role: string }) => board.role === "owner")).toHaveLength(1);
    expect(await source(recipient)).toEqual(original);
  } finally { await transferContext.close(); }
});

test("session expiry clears the recipient canvas and restores the retained guest drawing", async ({ page, context, browser }) => {
  const { title } = await owner(page, context); const url = await copy(page); const recipientContext = await browser.newContext();
  try {
    const recipient = await recipientContext.newPage(); await recipient.goto("/scribble/"); await expect(recipient.getByLabel("Drawing title")).toBeVisible();
    await createNote(recipient, "Expiry guest original", 340, 500); await flushLocalDraft(recipient);
    await signIn(recipientContext.request); await recipient.evaluate((target) => { window.location.href = target; window.location.reload(); }, url);
    await expect(recipient.getByLabel("Page title")).toHaveValue(title); await connected(recipient);
    expect((await recipientContext.request.post(`${BASE_URL}/api/auth/logout`, { headers: mutationHeaders })).status()).toBe(204);
    await expect(recipient.getByLabel("Drawing title")).toBeVisible({ timeout: 10_000 });
    await expect(recipient.getByText("Expiry guest original", { exact: true })).toBeVisible(); await expect(recipient.getByText("Link baseline", { exact: true })).toHaveCount(0);
    const data = await recipient.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts")).useBoardStore.getState().account);
    expect(data).toBeNull();
  } finally { await recipientContext.close(); }
});

test("share errors reserve space below recovery notices and above appearance controls without moving the canvas", async ({ page, context }) => {
  await owner(page, context); await page.getByRole("button", { name: "Text tool", exact: true }).click();
  await expect(page.getByRole("region", { name: "Text settings", exact: true })).toBeVisible();
  const canvas = await page.locator(".canvas-viewport").boundingBox();
  await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts")).useDocumentStore.setState({ historyError: "Controlled recovery notice" }));
  await context.setOffline(true);
  try {
    await expect(page.locator(".board-notice")).toBeVisible();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const feedback = page.getByRole("complementary", { name: "Link sharing", exact: true }); await expect(feedback).toBeVisible();
    const notice = (await page.locator(".board-notice").boundingBox())!, toast = (await feedback.boundingBox())!;
    expect(toast.y).toBeGreaterThanOrEqual(notice.y + notice.height);
    const panel = (await page.locator(".tool-options").boundingBox())!; expect(panel.y).toBeGreaterThan(toast.y + toast.height);
    expect(await page.locator(".canvas-viewport").boundingBox()).toEqual(canvas);
    await page.screenshot({ path: "ui-redesign-evidence/r5-pending-share-error.png" });
  } finally {
    await context.setOffline(false).catch(() => {});
    await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts")).useDocumentStore.setState({ historyError: null })).catch(() => {});
  }
});

test("another tab's settings change requires review before Stop and never silently rebases", async ({ page, context }) => {
  const { id } = await owner(page, context); await copy(page); const dialog = await settings(page);
  const current = (await (await context.request.get(`${BASE_URL}/api/boards/${id}/share-link`)).json()).settings;
  expect((await context.request.patch(`${BASE_URL}/api/boards/${id}/share-link`, { headers: mutationHeaders,
    data: { requestId: randomUUID(), expectedVersion: current.version, role: "editor" } })).status()).toBe(200);
  await dialog.getByRole("button", { name: "Stop sharing", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Review the current settings");
  expect((await (await context.request.get(`${BASE_URL}/api/boards/${id}/share-link`)).json()).settings.enabled).toBe(true);
  await expect(dialog.getByRole("combobox", { name: "Link permission", exact: true })).toHaveValue("editor");
  await dialog.getByRole("button", { name: "Stop sharing", exact: true }).click(); await expect(dialog.getByText("Link sharing is off.", { exact: true })).toBeVisible();
});
