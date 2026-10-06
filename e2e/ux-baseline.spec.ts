import { expect, test } from "@playwright/test";
import { firstId, savedBoard, mockAccount, openBoard, editNote } from "./fixtures/account";

// Capture once before the redesign; ordinary runs use ux-simplification instead.
test.skip(!process.env.SCRIBBLE_UX_BASELINE, "Baseline is an opt-in, pre-redesign capture");
test("anonymized baseline and clickable proposal", async ({ page }) => {
  const board = savedBoard(firstId, "Example board");
  const cloud = await mockAccount(page, [board]);
  const capture = async (name: string) => {
    await page.screenshot({ path: `docs/ux-evidence/baseline-${name}.png` });
  };
  cloud.signedIn = false;
  await page.goto("/scribble/");
  await expect(page.getByLabel("Board title")).toBeEnabled();
  await capture("guest-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("guest-mobile");
  await page.setViewportSize({ width: 1440, height: 900 });
  cloud.signedIn = true;
  await page.reload();
  await openBoard(page, board.title);
  await capture("owner");
  cloud.failSaves = true;
  await editNote(page, board.title, "Disposable unsent edit");
  await expect(page.getByRole("button", { name: "Retry account save", exact: true })).toBeVisible();
  await capture("cloud-error");
  cloud.failSaves = false;
  cloud.conflictOnNextSave = true;
  await page.getByRole("button", { name: "Retry account save", exact: true }).click();
  await expect(page.getByText(/This board changed elsewhere\. Your edits/)).toBeVisible();
  await capture("conflict");
  await page.evaluate(async () => {
    const { useBoardStore } = await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts");
    useBoardStore.getState().markSaveError("Disposable storage failure");
  });
  await capture("combined-failure");
  // Fixture-only store state: read-only controls are also exercised by HTTP tests.
  await page.evaluate(async () => {
    const { useBoardStore } = await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts");
    useBoardStore.getState().setTabReadOnly(true);
  });
  await capture("tab-restriction");
  await page.goto("/scribble/docs/ux-wireframe.html");
  await page.locator("#boards").click();
  await page.locator("#search").fill("weekend");
  await expect(page.locator("#board-list")).toContainText("Weekend plans");
  await page.keyboard.press("Escape");
  await expect(page.locator("#boards")).toBeFocused();
  await page.locator("#scenario").selectOption("images");
  await page.locator("#notice-action").click();
  await expect(page.locator("#dialog")).toContainText("Image upload needed");
  await page.keyboard.press("Escape");
  await capture("proposal-desktop");
});
