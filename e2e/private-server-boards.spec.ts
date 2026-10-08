import { browse, closeDialogs, accountMenu } from "./fixtures/ui";
import { firstId, mockAccount, restoreAccount, savedBoard } from "./fixtures/account";
import { expect, test } from "@playwright/test";

test("guest canvas stays available without requesting private boards", async ({ page }) => {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  await page.goto("/scribble/");
  await expect(page.getByLabel("Drawing title")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Pages", exact: true })).toHaveCount(0);
  await page.getByLabel("Drawing title").fill("Guest work stays local");
  await page.getByLabel("Drawing title").press("Enter");
  expect(cloud.listRequests).toBe(0);
  await expect(page.locator(".page-sidebar")).toHaveCount(0);
});

test("sign-out clears private titles immediately while preserving the retained guest drawing", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Only my account", [])]); cloud.signedIn = false;
  await page.goto("/scribble/");
  await page.getByLabel("Drawing title").fill("My guest sketch");
  await page.getByLabel("Drawing title").press("Enter");
  await restoreAccount(page, cloud); await browse(page);
  await expect(page.locator(".page-list").getByText("Only my account", { exact: true })).toBeVisible();
  await accountMenu(page); await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pages", exact: true })).toHaveCount(0);
  await expect(page.getByText("Only my account", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Drawing title")).toHaveValue("My guest sketch");
});

test("an expired board session clears private pages and restores the guest canvas", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Private work", [])]);
  await page.goto("/scribble/"); await browse(page);
  await expect(page.locator(".page-list").getByText("Private work", { exact: true })).toBeVisible();
  cloud.signedIn = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Pages", exact: true })).toHaveCount(0);
  await expect(page.getByText("Private work", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in with Google", exact: true })).toBeVisible();
  await expect(page.getByLabel("Drawing title")).toBeEnabled();
});

test("a pending board response cannot restore private titles after sign-out", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Late private title", [])]);
  let releaseResponse!: () => void, requestStarted!: () => void;
  cloud.listGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  cloud.listStarted = requestStarted;
  await page.goto("/scribble/"); await started;
  await accountMenu(page); await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await closeDialogs(page);
  await expect(page.getByLabel("Drawing title")).toBeEnabled();
  releaseResponse();
  await expect(page.getByText("Late private title", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pages", exact: true })).toHaveCount(0);
});
