import { expect, test, type Page } from "@playwright/test";
import { createNote, mockAccount } from "./fixtures/account";
import { closeDialogs, details } from "./fixtures/ui";

async function guest(page: Page) {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  await page.goto("/scribble/");
}
async function local(page: Page) {
  return page.evaluate(async () => {
    const { useBoardStore } = await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts");
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const { useViewportStore } = await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts");
    const { boardTabCoordinator } = await import(/* @vite-ignore */ "/scribble/src/persistence/boardTabCoordinator.ts");
    const board = useBoardStore.getState();
    return { objects: useDocumentStore.getState().objects, history: useDocumentStore.getState().past.length,
      viewport: useViewportStore.getState().viewport, ownership: board.tabOwnership, owns: boardTabCoordinator.owns(board.id),
      recovery: board.tabRecoveryId };
  });
}
async function flush(page: Page) {
  await page.evaluate(async () => {
    const { flushLocalBoardSave } = await import(/* @vite-ignore */ "/scribble/src/persistence/useLocalBoardPersistence.ts");
    await flushLocalBoardSave();
  });
}

for (const missing of ["none", "locks", "channel", "both"] as const) {
  test(`guest snapshots and automatic active-tab handoff with missing ${missing}`, async ({ page, context }) => {
    if (missing !== "none") await context.addInitScript((mode) => {
      if (mode === "locks" || mode === "both") Object.defineProperty(navigator, "locks", { value: undefined });
      if (mode === "channel" || mode === "both") Object.defineProperty(window, "BroadcastChannel", { value: undefined });
    }, missing);
    await guest(page); await createNote(page, "First tab note");
    await page.evaluate(async () => {
      const { useViewportStore } = await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts");
      useViewportStore.getState().setViewport({ x: 210, y: -80, zoom: .8 });
    });
    await flush(page);
    const before = await local(page);
    const other = await context.newPage(); await guest(other); await other.bringToFront();
    await expect(other.getByLabel("Drawing title", { exact: true })).toBeEnabled();
    expect((await local(other)).objects).toEqual(before.objects);
    expect((await local(other)).viewport).toEqual(before.viewport);
    await expect.poll(async () => (await local(page)).ownership).toBe("passive");
    expect((await local(page)).owns).toBe(false);
    await createNote(other, "Second tab note"); await flush(other);
    const shared = await local(other);
    await expect.poll(async () => (await local(page)).objects).toEqual(shared.objects);
    await page.bringToFront();
    // Headless Chromium does not emit a tab-switch focus event consistently.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByLabel("Drawing title", { exact: true })).toBeEnabled();
    expect((await local(page)).objects).toEqual(shared.objects);
    expect((await local(page)).history).toBe(0);
    await page.getByRole("button", { name: "Note tool", exact: true }).click();
    await page.mouse.click(950, 650);
    await page.getByLabel("Card title", { exact: true }).fill("After returning");
    await page.keyboard.press("Escape"); await flush(page);
    await page.getByRole("button", { name: /^Undo / }).click(); await flush(page);
    await page.getByRole("button", { name: /^Undo / }).click(); await flush(page);
    expect((await local(page)).objects).toEqual(shared.objects);
    expect((await local(page)).recovery).toBeNull();
    expect((await local(other)).recovery).toBeNull();
  });
}

test("guest handoff waits for text composition and preserves the final committed text", async ({ page, context }) => {
  await guest(page); await createNote(page, "Before composition"); await flush(page);
  await page.locator(".card-object-value").filter({ has: page.getByText("Before composition", { exact: true }) }).dblclick();
  const input = page.getByLabel("Card title", { exact: true });
  await input.fill("Final composed text"); await input.dispatchEvent("compositionstart", { data: "Final" });
  const other = await context.newPage(); await guest(other); await other.bringToFront();
  await expect.poll(async () => (await local(other)).ownership, { timeout: 5000 }).toBe("passive");
  expect((await local(page)).owns).toBe(true);
  expect(Object.values((await local(other)).objects).some((object: any) => object.title === "Final composed text")).toBe(false);
  await input.dispatchEvent("compositionend", { data: "Final composed text" });
  await details(other);
  const continueHere = other.getByRole("button", { name: "Continue editing here", exact: true });
  if (await continueHere.isVisible()) await continueHere.click();
  await closeDialogs(other);
  await expect(other.getByLabel("Drawing title", { exact: true })).toBeEnabled();
  expect(Object.values((await local(other)).objects).some((object: any) => object.title === "Final composed text")).toBe(true);
});

test("an active pen stroke is committed once before guest ownership is handed off", async ({ page, context }) => {
  await guest(page);
  await expect(page.getByLabel("Drawing title", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
  await page.mouse.move(700, 600); await page.mouse.down();
  await page.mouse.move(780, 650, { steps: 5 });
  expect(Object.keys((await local(page)).objects)).toHaveLength(0);
  const other = await context.newPage(); await guest(other);
  await expect(other.getByLabel("Drawing title", { exact: true })).toBeEnabled();
  const objects = Object.values((await local(other)).objects) as any[];
  expect(objects).toHaveLength(1); expect(objects[0].type).toBe("stroke");
  expect(objects[0].points.length).toBeGreaterThan(1);
  await page.mouse.up();
  expect((await local(page)).objects).toEqual((await local(other)).objects);
  expect((await local(page)).history).toBe(1);
  expect((await local(other)).history).toBe(0);
  expect((await local(page)).recovery).toBeNull();
});

test("without signal transports a held Web Lock stays safe, snapshots poll and explicit continuation works after exit", async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, "BroadcastChannel", { value: undefined });
    Storage.prototype.setItem = () => { throw new DOMException("Storage signals unavailable", "SecurityError"); };
  });
  await guest(page); await createNote(page, "Protected first writer"); await flush(page);
  const other = await context.newPage(); await guest(other); await other.bringToFront();
  await expect.poll(async () => (await local(other)).ownership).toBe("passive");
  expect((await local(page)).owns).toBe(true);
  await page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const document = useDocumentStore.getState(); document.updateObject(Object.keys(document.objects)[0], { title: "Polled latest snapshot" });
  });
  await flush(page);
  await expect.poll(async () => (await local(other)).objects).toEqual((await local(page)).objects);
  // Keep the passive page from automatically claiming on the owner's exit so
  // this case exercises the explicit continuation path deterministically.
  await other.evaluate(() => { document.hasFocus = () => false; });
  await page.close();
  await details(other);
  await other.evaluate(() => { document.hasFocus = () => true; });
  await other.getByRole("button", { name: "Continue editing here", exact: true }).click(); await closeDialogs(other);
  await expect(other.getByLabel("Drawing title", { exact: true })).toBeEnabled();
  expect(Object.values((await local(other)).objects).some((object: any) => object.title === "Polled latest snapshot")).toBe(true);
});
