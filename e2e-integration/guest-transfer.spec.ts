import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { accountMenu, closeDialogs } from "../e2e/fixtures/ui";
import { BASE_URL, canvasState, createNote, fixtureHeaders, flushLocalDraft, mutationHeaders, network, signIn, state } from "./fixture";

async function pages(request: APIRequestContext) {
  const response = await request.get(`${BASE_URL}/api/boards`); expect(response.ok()).toBeTruthy();
  return (await response.json()).boards as { id: string; title: string }[];
}
async function guest(page: Page, path = "/scribble/") {
  await page.goto(path); await expect(page.locator(".account-trigger")).toHaveAccessibleName("Sign in with Google");
  await closeDialogs(page);
  await createNote(page, "Guest original", 340, 510); await page.getByLabel("Drawing title").fill("Guest drawing"); await page.getByLabel("Drawing title").press("Enter");
  await flushLocalDraft(page);
}
async function continueGoogle(page: Page, navigation = true) {
  if (!navigation) { await page.getByRole("link", { name: "Sign in with Google", exact: true }).click(); return; }
  await Promise.all([
    page.waitForEvent("framenavigated", { predicate: (frame) => frame === page.mainFrame() && new URL(frame.url()).pathname === "/scribble/" }),
    page.getByRole("link", { name: "Sign in with Google", exact: true }).click(),
  ]);
  await page.waitForLoadState("domcontentloaded");
}
async function google(page: Page, bring = true, navigation = true) {
  await accountMenu(page);
  if (await page.getByRole("menuitem", { name: "Your account and retained drawing", exact: true }).isVisible()) await page.getByRole("menuitem", { name: "Your account and retained drawing", exact: true }).click();
  const choice = page.getByRole("checkbox", { name: "Bring this drawing into my workspace", exact: true });
  if (await choice.count()) { await expect(choice).not.toBeChecked(); if (bring) await choice.check(); }
  await continueGoogle(page, navigation);
}
async function opened(page: Page) {
  await expect.poll(async () => (await canvasState(page)).account?.boardId ?? null).not.toBeNull();
  await expect(page.locator("#canvas-editor")).toBeVisible();
  return (await canvasState(page)).account!.boardId;
}
async function deviceOriginal(page: Page) {
  return page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/persistence/localBoardStorage.ts")).loadLocalBoard());
}
async function image(page: Page) {
  const bytes = await sharp({ create: { width: 80, height: 60, channels: 4, background: "#168acf" } }).png().toBuffer();
  await page.locator(".canvas-viewport").evaluate((element, input) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(input), (char) => char.charCodeAt(0))], "guest.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 650, clientY: 550 }));
  }, bytes.toString("base64"));
  await expect(page.locator(".image-object-value")).toHaveCount(1); await flushLocalDraft(page);
}

test("empty drawing continues directly through controlled Google OAuth and creates one default page", async ({ page, context }) => {
  await page.goto("/scribble/"); await expect(page.locator(".account-trigger")).toHaveAccessibleName("Sign in with Google");
  await page.getByRole("button", { name: "Sign in with Google", exact: true }).click(); const id = await opened(page);
  expect(await pages(context.request)).toHaveLength(1); expect((await canvasState(page)).objects).toHaveLength(0);
  await page.reload(); expect(await opened(page)).toBe(id);
});

test("explicit Google transfer includes images, preserves guest IDs/viewport and creates one ready page", async ({ page, context }) => {
  await guest(page); await image(page);
  await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts")).useViewportStore.getState().setViewport({ x: 120, y: 90, zoom: 1.5 }));
  await flushLocalDraft(page); const original = await deviceOriginal(page);
  await google(page); const id = await opened(page);
  expect(await pages(context.request)).toHaveLength(1);
  expect((await state(context.request, id)).assets).toHaveLength(1);
  expect((await state(context.request, id)).document?.content.objects).toHaveLength(2);
  expect(await deviceOriginal(page)).toEqual(original);
  expect(await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts")).useViewportStore.getState().viewport)).toEqual(original!.viewport);
  await expect.poll(() => page.locator(".image-object-value").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(80);
  const idBefore = (await canvasState(page)).objects.map((object) => object.id);
  await page.reload(); expect(await opened(page)).toBe(id); expect((await canvasState(page)).objects.map((object) => object.id)).toEqual(idBefore);
  await accountMenu(page); await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await closeDialogs(page); await expect(page.getByText("Guest original", { exact: true })).toBeVisible();
  expect((await canvasState(page)).objects).toEqual(Object.values(original!.objects));
});

test("declining keeps the drawing here; a later account-menu import requires fresh unselected consent", async ({ page, context }) => {
  await guest(page); await google(page, false); await opened(page);
  expect((await canvasState(page)).objects).toHaveLength(0); expect(await pages(context.request)).toHaveLength(1);
  await accountMenu(page);
  if (await page.getByRole("menuitem", { name: "Your account and retained drawing", exact: true }).isVisible()) await page.getByRole("menuitem", { name: "Your account and retained drawing", exact: true }).click();
  const choice = page.getByRole("checkbox", { name: "Bring this drawing into my workspace", exact: true });
  await expect(choice).not.toBeChecked(); await expect(page.getByRole("button", { name: "Bring drawing", exact: true })).toBeDisabled();
  await choice.check(); await page.getByRole("button", { name: "Bring drawing", exact: true }).click();
  await expect(page.getByText("Guest original", { exact: true })).toBeVisible(); await opened(page);
  expect(await pages(context.request)).toHaveLength(2); expect(Object.values((await deviceOriginal(page))!.objects)).toHaveLength(1);
});

for (const reason of ["denied", "failed", "invalid_state"]) test(`${reason} authentication preserves the source and cannot trigger a stale transfer on subsequent login`, async ({ page, context }) => {
  await guest(page);
  await page.route("**/api/auth/google?*", (route) => route.fulfill({ status: 302, headers: { location: `/scribble/?authError=${reason}` } }));
  await google(page); await expect(page.getByRole("alert")).toContainText(reason === "denied" ? "cancelled" : reason === "failed" ? "didn’t finish" : "expired");
  expect((await canvasState(page)).account).toBeNull(); expect(Object.values((await deviceOriginal(page))!.objects)).toHaveLength(1);
  await page.unroute("**/api/auth/google?*");
  await google(page, false); await opened(page);
  expect(await pages(context.request)).toHaveLength(1); expect((await canvasState(page)).objects).toHaveLength(0);
});

test("a lost creation response resumes the persisted request after reload with one destination", async ({ page, context }) => {
  await guest(page); const identities: string[] = []; let drop = true;
  await page.route("**/api/boards", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    identities.push(route.request().postDataJSON().requestId);
    if (drop) { drop = false; expect((await route.fetch()).ok()).toBeTruthy(); await route.abort("failed"); }
    else await route.continue();
  });
  await google(page); await expect(page.getByRole("button", { name: "Retry transfer", exact: true })).toBeVisible();
  const [created] = await pages(context.request); expect(await pages(context.request)).toHaveLength(1);
  await page.reload(); expect(await opened(page)).toBe(created.id);
  expect(identities).toHaveLength(2); expect(identities[0]).toBe(identities[1]);
  expect(await pages(context.request)).toHaveLength(1); expect((await canvasState(page)).objects).toHaveLength(1);
});

test("a lost image response reconciles the same reservation after reload without sending bytes again", async ({ page, context }) => {
  await guest(page); await image(page); let writes = 0;
  await page.route("**/api/boards/*/assets", async (route) => {
    writes++; expect(route.request().headers()["x-scribble-upload-request"]).toBeTruthy();
    expect((await route.fetch()).ok()).toBeTruthy(); await route.abort("failed");
  });
  await google(page); await expect(page.getByRole("button", { name: "Retry transfer", exact: true })).toBeVisible();
  const [created] = await pages(context.request); expect((await state(context.request, created.id)).assets).toHaveLength(1);
  await page.reload(); expect(await opened(page)).toBe(created.id); expect(writes).toBe(1);
  expect((await state(context.request, created.id)).assets).toHaveLength(1); expect(await pages(context.request)).toHaveLength(1);
});

test("a pending guest image retries the original reservation after reload and the provider delay", async ({ page, context }) => {
  await guest(page); await image(page);
  const original = await deviceOriginal(page), uploads: string[] = [];
  await page.route("**/api/boards/*/assets", async (route) => {
    uploads.push(route.request().headers()["x-scribble-upload-request"]);
    await route.continue();
  });
  expect((await context.request.post(`${BASE_URL}/api/__fixture/provider`, {
    headers: fixtureHeaders(), data: { failUploads: 1 },
  })).ok()).toBeTruthy();
  try {
    await google(page);
    await expect(page.getByRole("button", { name: "Retry transfer", exact: true })).toBeVisible();
    const [created] = await pages(context.request);
    const pending = await state(context.request, created.id);
    expect(pending.assets).toHaveLength(1); expect(pending.assets[0].status).toBe("pending");
    await page.reload();
    await expect(page.getByRole("button", { name: "Retry transfer", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
      const { openCanvasDatabase, BOARD_STORE_NAME } = await import(/* @vite-ignore */ "/scribble/src/persistence/database.ts");
      const database = await openCanvasDatabase();
      const records = await new Promise<{ images: { nextAttemptAt: number }[] }[]>((resolve, reject) => {
        const request = database.transaction(BOARD_STORE_NAME).objectStore(BOARD_STORE_NAME)
          .getAll(IDBKeyRange.bound("guest-transfer:", "guest-transfer:\uffff"));
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const intent = records[0];
      return intent && Date.now() >= intent.images[0].nextAttemptAt;
    }), { timeout: 10_000 }).toBeTruthy();
    await page.getByRole("button", { name: "Retry transfer", exact: true }).click();
    expect(await opened(page)).toBe(created.id);
    const saved = await state(context.request, created.id);
    expect(saved.assets).toHaveLength(1);
    expect(saved.assets[0]).toMatchObject({ id: pending.assets[0].id, status: "ready" });
    expect(saved.document?.content.objects).toHaveLength(2); expect(saved.receipts).toHaveLength(1);
    expect(uploads).toHaveLength(2); expect(uploads[1]).toBe(uploads[0]);
    expect(await pages(context.request)).toHaveLength(1); expect(await deviceOriginal(page)).toEqual(original);
  } finally {
    await context.request.post(`${BASE_URL}/api/__fixture/provider`, { headers: fixtureHeaders(), data: {} });
  }
});

test("lost document acknowledgement reuses its receipt and opens newer edits without importing the old snapshot", async ({ page, context }) => {
  await guest(page); await network(context.request, 1); await google(page);
  await expect(page.getByRole("button", { name: "Retry transfer", exact: true })).toBeVisible();
  const [created] = await pages(context.request); const saved = await state(context.request, created.id);
  expect(saved.document?.revision).toBe(2); expect(saved.receipts).toHaveLength(1);
  const objects = saved.document!.content.objects.map((object) => object.type === "card" ? { ...object, title: "Newer account edit", updatedAt: object.updatedAt + 1 } : object);
  expect((await context.request.put(`${BASE_URL}/api/boards/${created.id}/document`, { headers: mutationHeaders,
    data: { schemaVersion: 1, expectedRevision: 2, content: { objects } } })).ok()).toBeTruthy();
  await page.reload(); expect(await opened(page)).toBe(created.id);
  await expect(page.getByText("Newer account edit", { exact: true })).toBeVisible();
  const after = await state(context.request, created.id); expect(after.document?.revision).toBe(3); expect(after.receipts).toHaveLength(1);
  expect(await pages(context.request)).toHaveLength(1);
});

test("invitation and explicit page take priority, retaining the drawing for deliberate resume", async ({ page, context }) => {
  const { subject } = await signIn(context.request);
  const response = await context.request.post(`${BASE_URL}/api/boards`, { headers: mutationHeaders, data: { title: "Linked page", requestId: randomUUID(), initializeDocument: true } });
  const linked = (await response.json()).board.id as string;
  await context.request.post(`${BASE_URL}/api/auth/logout`, { headers: mutationHeaders });
  await guest(page, `/scribble/?page=${linked}&invite=${randomUUID()}`);
  // Keep the known recipient identity while simulating this OAuth return. All
  // subsequent workspace/transfer requests still use real API/Prisma/PostgreSQL.
  await page.route("**/api/auth/google?*", async (route) => {
    const flow = new URL(route.request().url()).searchParams.get("clientFlow");
    await signIn(context.request, subject);
    await route.fulfill({ status: 302, headers: { location: `/scribble/?authFlow=${flow}` } });
  });
  await google(page); await expect(page.getByRole("dialog", { name: "Invitations", exact: true })).toBeVisible();
  await expect.poll(async () => (await canvasState(page)).account?.boardId).toBe(linked); expect(await pages(context.request)).toHaveLength(1);
  expect((await canvasState(page)).objects).toHaveLength(0);
  await accountMenu(page); await page.getByRole("menuitem", { name: "Resume drawing transfer", exact: true }).click(); await page.getByRole("button", { name: "Resume drawing transfer", exact: true }).click();
  await expect(page.getByText("Guest original", { exact: true })).toBeVisible();
  expect(await pages(context.request)).toHaveLength(2); expect(await opened(page)).not.toBe(linked);
});

test("account switching pauses an interrupted transfer and cannot import into another account", async ({ page, context }) => {
  await guest(page); await network(context.request, 1); await google(page);
  await expect(page.getByRole("button", { name: "Retry transfer", exact: true })).toBeVisible();
  const originalUser = (await (await context.request.get(`${BASE_URL}/api/auth/me`)).json()).user.id;
  const [created] = await pages(context.request);
  await signIn(context.request); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await opened(page); expect((await canvasState(page)).account?.ownerId).not.toBe(originalUser);
  expect((await canvasState(page)).objects).toHaveLength(0); expect(await pages(context.request)).toHaveLength(1);
  const intents = await page.evaluate(async () => {
    const { openCanvasDatabase, BOARD_STORE_NAME, requestResult } = await import(/* @vite-ignore */ "/scribble/src/persistence/database.ts");
    const db = await openCanvasDatabase();
    return await requestResult(db.transaction(BOARD_STORE_NAME).objectStore(BOARD_STORE_NAME).getAll(IDBKeyRange.bound("guest-transfer:", "guest-transfer:\uffff"))) as { accountId: string; status: string; destinationId: string }[];
  });
  expect(intents).toHaveLength(1); expect(intents[0]).toMatchObject({ accountId: originalUser, status: "paused", destinationId: created.id });
});

test("an account-cookie change immediately before creation cannot transfer into the replacement account", async ({ page, context }) => {
  await guest(page); let originalUser = "", changed = false;
  await page.route("**/api/boards", async (route) => {
    if (route.request().method() === "POST" && !changed) {
      changed = true; originalUser = route.request().headers()["x-scribble-account"];
      expect(originalUser).toBeTruthy(); await signIn(context.request);
    }
    await route.continue();
  });
  await google(page); await opened(page);
  await expect.poll(async () => (await canvasState(page)).account?.ownerId).not.toBe(originalUser);
  expect(await pages(context.request)).toHaveLength(1); expect((await canvasState(page)).objects).toHaveLength(0);
  const original = await deviceOriginal(page); expect(Object.values(original!.objects)).toHaveLength(1);
});

test("the final document read also rejects an account change after transfer confirmation", async ({ page, context }) => {
  await guest(page); let reads = 0, originalUser = "";
  await page.route("**/api/boards/*/document", async (route) => {
    if (route.request().method() === "GET" && ++reads === 2) {
      originalUser = route.request().headers()["x-scribble-account"]; expect(originalUser).toBeTruthy();
      await signIn(context.request);
    }
    await route.continue();
  });
  await google(page); await opened(page);
  expect((await canvasState(page)).account?.ownerId).not.toBe(originalUser);
  expect((await canvasState(page)).objects).toHaveLength(0); expect(await pages(context.request)).toHaveLength(1);
});

test("closing consent while image preparation waits cancels OAuth and leaves the drawing intact", async ({ page, context }) => {
  await guest(page); await image(page); let oauth = 0;
  page.on("request", (request) => { if (request.url().includes("/api/auth/google")) oauth++; });
  await page.evaluate(() => {
    const browser = window as unknown as { releaseTransferImage: () => void; transferImageFinished: boolean };
    const originalGet = IDBObjectStore.prototype.get;
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    browser.releaseTransferImage = () => { IDBObjectStore.prototype.get = originalGet; release(); };
    IDBObjectStore.prototype.get = function(key) {
      const request = originalGet.call(this, key);
      if (this.name === "assets") Object.defineProperty(request, "onsuccess", { set(handler) {
        Object.getOwnPropertyDescriptor(IDBRequest.prototype, "onsuccess")!.set!.call(request, (event: Event) => {
          void gate.then(() => { handler?.call(request, event); browser.transferImageFinished = true; });
        });
      } });
      return request;
    };
  });
  await google(page, true, false); await expect(page.getByRole("link", { name: "Saving canvas…", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as unknown as { releaseTransferImage: () => void }).releaseTransferImage());
  await expect.poll(() => page.evaluate(() => (window as unknown as { transferImageFinished: boolean }).transferImageFinished)).toBe(true);
  expect(oauth).toBe(0); expect((await canvasState(page)).objects).toHaveLength(2);
  await google(page, false); await opened(page); expect(await pages(context.request)).toHaveLength(1);
  expect((await canvasState(page)).objects).toHaveLength(0);
});

test("mobile consent supports keyboard navigation, starts unchecked, and stays within the viewport", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await guest(page); await accountMenu(page);
  const choice = page.getByRole("checkbox", { name: "Bring this drawing into my workspace", exact: true });
  await expect(choice).not.toBeChecked(); await choice.focus(); await page.keyboard.press("Space"); await expect(choice).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "workspace-ux-evidence/m11-mobile-consent.png" });
  await continueGoogle(page); await opened(page);
  expect(await pages(context.request)).toHaveLength(1); await expect(page.getByText("Guest original", { exact: true })).toBeVisible();
});

test("failed durable consent storage blocks OAuth and preserves the guest drawing", async ({ page }) => {
  await guest(page); let oauth = 0; page.on("request", (request) => { if (request.url().includes("/api/auth/google")) oauth++; });
  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (typeof value?.id === "string" && value.id.startsWith("guest-transfer:")) throw new DOMException("Storage full", "QuotaExceededError");
      return originalPut.call(this, value, key);
    };
  });
  await google(page, true, false); await expect(page.getByRole("alert")).toContainText("Storage full"); expect(oauth).toBe(0);
  await closeDialogs(page); await expect(page.getByText("Guest original", { exact: true })).toBeVisible();
});
