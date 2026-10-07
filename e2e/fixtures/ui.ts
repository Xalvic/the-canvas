import { expect, type Page } from "@playwright/test";

export async function closeDialogs(page: Page) {
  while (await page.locator("dialog[open]").count()) await page.keyboard.press("Escape");
}
export async function browse(page: Page, category = "My pages") {
  await expect(page.getByRole("button", { name: "Pages", exact: true })).toBeVisible();
  if (!await page.locator(".page-sidebar").isVisible()) {
    await closeDialogs(page);
    await page.getByRole("button", { name: "Pages", exact: true }).click();
  }
  await expect(page.locator(".page-sidebar")).toBeVisible();
  if (category === "Invitations") await page.locator(".sidebar-footer").getByRole("button", { name: /^Invitations/ }).click();
}
export async function details(page: Page) {
  if (!await page.getByRole("dialog", { name: "Save details", exact: true }).isVisible()) {
    await closeDialogs(page);
    await page.getByRole("button", { name: "App menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Save details", exact: true }).click();
  }
}
export async function accountMenu(page: Page) {
  await closeDialogs(page);
  await page.locator(".account-trigger").click();
}
export async function backToDevice(page: Page) {
  await expect(page.locator(".account-trigger")).not.toHaveText("Connecting…");
  // Guest restoration now happens through sign-out, without a device/page chooser.
  if (await page.getByRole("button", { name: "Account menu", exact: true }).isVisible()) {
    await accountMenu(page); await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  }
  await closeDialogs(page); await expect(page.getByLabel("Drawing title")).toBeVisible();
}
export async function newAccountBoard(page: Page) {
  await browse(page);
  const previous = await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts")).useBoardStore.getState().account?.boardId);
  await page.getByRole("button", { name: "+ New page", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts")).useBoardStore.getState().account?.boardId)).not.toBe(previous);
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Untitled");
}
export async function explicitSave(page: Page, kind: "Save to account" | "Save a copy" | "Upload and save") {
  // Older provider fixtures are migrated at M11; recovery and legacy-consent
  // journeys use the same helper with the current UI label.
  const label = kind === "Upload and save" ? "Allow image upload" : kind;
  if (kind !== "Save to account") await details(page);
  const trigger = kind === "Save to account" ? page.locator(".board-header") : page.getByRole("dialog", { name: "Save details", exact: true });
  await trigger.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("dialog", { name: label, exact: true }).getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
}
export async function rowActions(page: Page, title: string) {
  await browse(page);
  const matches = page.getByRole("button", { name: `Actions for ${title}`, exact: true });
  const button = await matches.count() > 1 ? page.locator('.page-list li[aria-current="page"]').getByRole("button", { name: `Actions for ${title}`, exact: true }) : matches;
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
}
