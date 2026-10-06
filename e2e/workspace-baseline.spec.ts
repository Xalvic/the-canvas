import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { IDBFactory } from "fake-indexeddb";
import { BoardTabCoordinator, BOARD_LEASE_DURATION_MS } from "../src/persistence/boardTabCoordinator";
import { BOARD_LEASE_STORE_NAME, BOARD_STORE_NAME } from "../src/persistence/database";
import { savePresentation } from "../src/components/SaveStatus";
import { firstId, mockAccount, note, openBoard, savedBoard } from "./fixtures/account";
import { accountMenu, closeDialogs } from "./fixtures/ui";

// M0 captures are opt-in; its former defect assertion now checks M1 recovery.
test.skip(process.env.SCRIBBLE_WORKSPACE_BASELINE !== "1", "Opt-in workspace M0 baseline");
const evidence = "docs/workspace-ux-evidence";

test("workspace recovery: a sole expired writer resumes without the false other-tab warning", async () => {
  const factory = new IDBFactory();
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open("workspace-m0-expiry", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(BOARD_STORE_NAME, { keyPath: "id" });
      request.result.createObjectStore(BOARD_LEASE_STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  let now = 1_000;
  // One active coordinator, no Web Locks, heartbeat or competing acquisition.
  const coordinator = new BoardTabCoordinator(async () => database, () => now, "sole-writer", null);
  const ownershipEvents: { id: string; owned: boolean; lost: boolean }[] = [];
  const unsubscribe = coordinator.subscribe((event) => ownershipEvents.push(event));
  try {
    expect(await coordinator.acquire("current-board")).not.toBeNull();
    const record = { id: "current-board", title: "Disposable baseline drawing" };
    await coordinator.write(record.id, [record]);
    const ownedBefore = coordinator.owns(record.id);
    now += BOARD_LEASE_DURATION_MS + 1;
    const renewed = await coordinator.renew(record.id);
    const ownedAfter = coordinator.owns(record.id);
    const presentation = savePresentation({
      local: "saved", cloud: "local", account: false, role: null,
      tabReadOnly: !ownedAfter, pendingImages: 0, recovery: false,
    });
    const stored = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction(BOARD_STORE_NAME).objectStore(BOARD_STORE_NAME).get(record.id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(ownedBefore).toBe(true);
    expect(renewed).toBe(true);
    expect(ownedAfter).toBe(true);
    expect(ownershipEvents.every((event) => !event.lost)).toBe(true);
    expect(presentation.label).toBe("Saved on this device");
    expect(stored).toEqual(record);
    await mkdir(evidence, { recursive: true });
    await writeFile(`${evidence}/m1-sole-writer-expiry.json`, `${JSON.stringify({
      activeCoordinators: 1, webLocks: false, clockAdvanceMs: BOARD_LEASE_DURATION_MS + 1,
      ownedBefore, renewed, ownedAfter, ownershipEvents, presentation, canonicalRecordUnchanged: true,
      limitation: "Deterministic injected-clock reproduction; not a measurement of browser timer throttling.",
    }, null, 2)}\n`);
  } finally {
    unsubscribe();
    await coordinator.close();
    database.close();
  }
});

test("workspace baseline: capture guest and owner desktop/mobile using existing account fixtures", async ({ page }) => {
  const board = savedBoard(firstId, "Workspace baseline", [{ ...note("baseline-note", "Example drawing"), x: 40, y: 220 }]);
  const cloud = await mockAccount(page, [board]);
  cloud.signedIn = false;
  await page.goto("/scribble/");
  await expect(page.getByLabel("Board title", { exact: true })).toBeEnabled();
  await expect(page.locator(".save-status")).toHaveText("Saved on this device");
  await expect(page.getByRole("button", { name: "Boards", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save to account", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(cloud.listRequests).toBe(0);
  const capture = async (name: string) => {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      // Resizing updates the persisted viewport; capture its settled save state.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page.locator(".save-status")).toHaveText(name === "guest" ? "Saved on this device" : "Saved to account");
      await page.screenshot({ path: `${evidence}/m0-${name}-${viewport.width}.png`, animations: "disabled" });
    }
  };
  await capture("guest");
  await accountMenu(page);
  await expect(page.getByRole("dialog", { name: "Your account", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in with Google", exact: true })).toBeVisible();
  await closeDialogs(page);

  // Deterministic auth state; no real Google navigation or remote account writes.
  cloud.signedIn = true;
  await page.reload();
  await openBoard(page, board.title);
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
  await expect(page.getByLabel("Board title", { exact: true })).toBeEnabled();
  await capture("owner");
  expect(cloud.mutations).toHaveLength(0);
});
