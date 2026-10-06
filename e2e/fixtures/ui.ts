import { expect, type Page } from "@playwright/test";

export async function closeDialogs(page: Page) {
  while (await page.locator("dialog[open]").count()) await page.keyboard.press("Escape");
}
export async function browse(page: Page, category = "My boards") {
  if (!await page.getByRole("dialog", { name: "Your boards", exact: true }).isVisible()) {
    await closeDialogs(page);
    await page.getByRole("button", { name: "Boards", exact: true }).click();
  }
  const tab = page.getByRole("button", { name: category, exact: true });
  if (await tab.isVisible()) await tab.click();
}
export async function details(page: Page) {
  if (!await page.getByRole("dialog", { name: "Save details", exact: true }).isVisible()) {
    await closeDialogs(page);
    await page.locator(".save-status").click();
  }
}
export async function accountMenu(page: Page) {
  await closeDialogs(page);
  await page.locator(".account-trigger").click();
}
export async function backToDevice(page: Page) {
  await browse(page);
  await page.getByRole("button", { name: "Open device board", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Your boards", exact: true })).toBeHidden();
}
export async function newAccountBoard(page: Page) {
  await browse(page);
  await page.getByRole("button", { name: "New account board", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Your boards", exact: true })).toBeHidden();
}
export async function explicitSave(page: Page, kind: "Save to account" | "Save a copy" | "Upload and save") {
  if (kind !== "Save to account") await details(page);
  const trigger = kind === "Save to account" ? page.locator(".board-header") : page.getByRole("dialog", { name: "Save details", exact: true });
  await trigger.getByRole("button", { name: kind, exact: true }).click();
  await page.getByRole("dialog", { name: kind, exact: true }).getByRole("button", { name: kind, exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
}
export async function rowActions(page: Page, title: string) {
  await browse(page);
  const button = page.getByRole("button", { name: `Actions for ${title}`, exact: true });
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
}
