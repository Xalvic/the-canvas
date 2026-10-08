import { expect, test, type Page } from "@playwright/test";
import { BOARD_LEASE_DURATION_MS } from "../src/persistence/boardTabCoordinator";
import { createNote, firstId, mockAccount, openBoard, savedBoard } from "./fixtures/account";
import { closeDialogs, details } from "./fixtures/ui";

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const { useBoardStore } = await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts");
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const { useViewportStore } = await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts");
    const { openCanvasDatabase } = await import(/* @vite-ignore */ "/scribble/src/persistence/database.ts");
    const board = useBoardStore.getState(), document = useDocumentStore.getState();
    const database = await openCanvasDatabase();
    const records = await new Promise<any[]>((resolve, reject) => {
      const request = database.transaction("boards").objectStore("boards").getAll();
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return {
      id: board.id, ownership: board.tabOwnership, readOnly: board.readOnly,
      recoveryId: board.tabRecoveryId, sessionVersion: board.sessionVersion,
      objects: document.objects, past: document.past, future: document.future,
      viewport: useViewportStore.getState().viewport,
      recoveryRecords: records.filter((record) => record.id.startsWith(`${board.id}:recovery`)),
    };
  });
}

async function flush(page: Page) {
  await page.evaluate(async () => {
    const { waitForLocalBoardSave } = await import(/* @vite-ignore */ "/scribble/src/persistence/waitForLocalBoardSave.ts");
    await waitForLocalBoardSave(new AbortController().signal);
  });
}

for (const fallback of [false, true]) {
  for (const account of [false, true]) {
    test(`sole ${account ? "account" : "guest"} writer survives background/wake with ${fallback ? "lease fallback and no BroadcastChannel" : "Web Locks"}`, async ({ page }) => {
      if (fallback) await page.addInitScript(() => {
        Object.defineProperty(navigator, "locks", { value: undefined });
        Object.defineProperty(window, "BroadcastChannel", { value: undefined });
      });
      // Fixed Date advances independently of timers, modeling a missed heartbeat.
      // Hold the five-second heartbeat until after the injected lifecycle signals.
      await page.addInitScript(() => {
        const interval = window.setInterval.bind(window);
        window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
          interval(handler, delay === 5_000 ? 60_000 : delay, ...args)) as typeof window.setInterval;
      });
      const clock = Date.UTC(2026, 9, 6, 12);
      await page.clock.setFixedTime(clock);
      const board = savedBoard(firstId, "Wake recovery", []);
      const cloud = await mockAccount(page, account ? [board] : []);
      cloud.signedIn = account;
      await page.goto("/scribble/");
      await expect(page.getByLabel(account ? "Page title" : "Drawing title", { exact: true })).toBeEnabled();
      if (account) await openBoard(page, board.title);
      await createNote(page, "Keep this drawing");
      await page.evaluate(async () => {
        const { useViewportStore } = await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts");
        useViewportStore.getState().setViewport({ x: 120, y: -70, zoom: .8 });
      });
      await flush(page);
      if (account) await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account");
      const before = await snapshot(page);
      // Leave a real pen draft active when backgrounding; blur commits it once.
      await page.getByRole("button", { name: "Pen tool", exact: true }).click();
      await page.mouse.move(700, 600); await page.mouse.down();
      await page.mouse.move(760, 650, { steps: 4 });
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        window.dispatchEvent(new Event("blur"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.mouse.up();
      await flush(page);
      if (account) await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account");
      const background = await snapshot(page);
      expect(Object.values(background.objects)).toHaveLength(2);
      expect(background.past).toHaveLength(before.past.length + 1);
      expect(background.viewport).toEqual(before.viewport);
      await page.clock.setFixedTime(clock + BOARD_LEASE_DURATION_MS + 1);
      const expired = await page.evaluate(async () => {
        const { useBoardStore } = await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts");
        const { openCanvasDatabase } = await import(/* @vite-ignore */ "/scribble/src/persistence/database.ts");
        const { activeBoardLeaseId } = await import(/* @vite-ignore */ "/scribble/src/persistence/accountEditorJournals.ts");
        const database = await openCanvasDatabase();
        const lease = await new Promise<any>((resolve) => {
          const request = database.transaction("board-leases").objectStore("board-leases").get(activeBoardLeaseId(useBoardStore.getState().id));
          request.onsuccess = () => resolve(request.result);
        });
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("pageshow"));
        window.dispatchEvent(new Event("focus"));
        return lease.expiresAt <= Date.now();
      });
      expect(expired).toBe(true);
      await expect(page.getByRole("button", { name: "Note tool", exact: true })).toBeEnabled();
      await flush(page);
      if (account) await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account");
      else await expect(page.locator(".save-status")).toHaveCount(0);
      const after = await snapshot(page);
      expect(after).toEqual(background);
      expect(after.ownership).toBe("owned");
      expect(after.recoveryId).toBeNull();
      expect(after.recoveryRecords).toEqual([]);
      await page.keyboard.press("Control+z");
      expect((await snapshot(page)).objects).toEqual(before.objects);
      await page.keyboard.press("Control+Shift+z");
      expect((await snapshot(page)).objects).toEqual(background.objects);
      await flush(page);
      // Without Web Locks, a crashed/reloaded tab's durable lease remains until
      // expiry. Reload recovery after that boundary is existing fallback policy.
      if (fallback) await page.clock.setFixedTime(clock + 2 * (BOARD_LEASE_DURATION_MS + 1));
      await page.reload();
      if (account) await openBoard(page, board.title);
      await expect(page.getByLabel(account ? "Page title" : "Drawing title", { exact: true })).toBeEnabled();
      expect((await snapshot(page)).objects).toEqual(background.objects);
      expect((await snapshot(page)).viewport).toEqual(background.viewport);
    });
  }
}

test("initial acquisition shows loading without flashing another-tab warnings", async ({ page }) => {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  await page.addInitScript(() => {
    const request = navigator.locks.request.bind(navigator.locks);
    Object.defineProperty(navigator.locks, "request", { value: async (name: string, options: LockOptions, callback: LockGrantedCallback) => {
      if (name === "scribble:local-board:current-board") await new Promise<void>((resolve) => {
        Object.assign(window, { releaseAcquisition: resolve });
      });
      return request(name, options, callback);
    } });
  });
  await page.goto("/scribble/");
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts")).useBoardStore.getState().isHydrated)).toBe(false);
  await expect(page.getByText("Editing in another tab", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Drawing title", { exact: true })).toBeDisabled();
  await page.evaluate(() => (window as unknown as { releaseAcquisition: () => void }).releaseAcquisition());
  await expect(page.locator(".save-status")).toHaveCount(0);
  await expect(page.getByLabel("Drawing title", { exact: true })).toBeEnabled();
});

test("storage outage preserves unsaved content and history, then retries the same writer", async ({ page }) => {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  await page.goto("/scribble/");
  await createNote(page, "Saved note"); await flush(page);
  const before = await snapshot(page);
  await page.evaluate(async () => {
    const { openCanvasDatabase } = await import(/* @vite-ignore */ "/scribble/src/persistence/database.ts");
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const database = await openCanvasDatabase(), transaction = database.transaction.bind(database);
    Object.assign(window, { restoreDeviceStorage: () => { database.transaction = transaction; } });
    database.transaction = () => { throw new DOMException("Device storage temporarily unavailable", "UnknownError"); };
    const document = useDocumentStore.getState();
    document.updateObject(Object.keys(document.objects)[0], { title: "Pending during outage" });
  });
  await expect(page.locator(".board-notice")).toContainText("Couldn’t save on this device");
  await expect(page.getByText("Editing in another tab", { exact: true })).toHaveCount(0);
  await details(page);
  await expect(page.getByRole("button", { name: "Retry device save", exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { restoreDeviceStorage: () => void }).restoreDeviceStorage());
  const pending = await snapshot(page);
  expect(pending.ownership).toBe("unavailable");
  expect(pending.past).toHaveLength(before.past.length + 1);
  expect(pending.recoveryRecords).toEqual([]);
  await page.getByRole("button", { name: "Retry device save", exact: true }).click();
  await closeDialogs(page);
  await expect(page.locator(".save-status")).toHaveCount(0);
  const after = await snapshot(page);
  expect(after.objects).toEqual(pending.objects);
  expect(after.past).toEqual(pending.past);
  expect(after.sessionVersion).toBe(before.sessionVersion);
  expect(after.readOnly).toBe(false);
  expect(after.recoveryRecords).toEqual([]);
  // Closing details restores focus to the header, whose shortcuts are isolated.
  await page.getByRole("button", { name: "Select tool", exact: true }).click();
  await page.mouse.click(1000, 650);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await snapshot(page)).objects).toEqual(before.objects);
});

test("initial IndexedDB failure offers storage retry and loads the retained guest drawing", async ({ page }) => {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  await page.goto("/scribble/"); await createNote(page, "Retained guest"); await flush(page);
  const before = await snapshot(page);
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB);
    Object.assign(window, { restoreDeviceStorage: () => { indexedDB.open = open; } });
    indexedDB.open = () => { throw new DOMException("Device storage temporarily unavailable", "UnknownError"); };
  });
  await page.reload();
  await expect(page.locator(".board-notice")).toContainText("Couldn’t save on this device");
  await expect(page.getByText("Editing in another tab", { exact: true })).toHaveCount(0);
  await details(page);
  await page.evaluate(() => (window as unknown as { restoreDeviceStorage: () => void }).restoreDeviceStorage());
  await page.getByRole("button", { name: "Retry device save", exact: true }).click();
  await closeDialogs(page);
  await expect(page.locator(".save-status")).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).objects).toEqual(before.objects);
});
