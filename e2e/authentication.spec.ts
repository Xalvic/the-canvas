import { accountMenu, closeDialogs } from "./fixtures/ui";
import { canvasState, createNote, localBoard, mockAccount } from "./fixtures/account";
import { test, expect } from "@playwright/test";

test("Google account state, logout failure and retry preserve the retained guest drawing", async ({ page }) => {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  let offline = false, logoutFailure = false;
  await page.route("**/api/auth/me", async (route) => {
    if (offline) await route.abort("failed"); else await route.fallback();
  });
  await page.route("**/api/auth/logout", async (route) => {
    expect(route.request().headers()["x-scribble-request"]).toBe("1");
    if (logoutFailure) await route.fulfill({ status: 500, json: { error: {} } }); else await route.fallback();
  });
  await page.goto("/scribble/");
  await createNote(page, "Retained guest drawing");
  await accountMenu(page);
  const account = page.getByRole("region", { name: "Your account", exact: true });
  await expect(account.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/api/auth/google");
  await expect(account.getByRole("checkbox")).not.toBeChecked();
  const before = await canvasState(page);
  await account.getByRole("link").focus(); await page.keyboard.press("Backspace");
  expect(await canvasState(page)).toEqual(before);
  await closeDialogs(page);
  await expect.poll(async () => (await localBoard(page))?.objects).toEqual(before.objects);
  cloud.signedIn = true; await page.reload();
  await expect(page.getByRole("region", { name: "Workspace", exact: true })).toContainText("Your workspace is empty");
  expect((await localBoard(page))?.objects).toEqual(before.objects);
  await accountMenu(page);
  await page.getByRole("menuitem", { name: "Your account and retained drawing", exact: true }).click();
  await expect(account).toContainText("owner@example.com");
  logoutFailure = true; await account.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(account.getByRole("alert")).toContainText("Could not sign out");
  await expect(account).toContainText("owner@example.com");
  logoutFailure = false; await account.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Drawing title")).toBeEnabled();
  expect((await canvasState(page)).objects).toEqual(before.objects);
  offline = true; await page.reload(); await accountMenu(page);
  await expect(account.getByRole("alert")).toBeVisible();
  offline = false; await account.getByRole("button", { name: "Retry sign-in check" }).click();
  await expect(account.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
  expect((await canvasState(page)).objects).toEqual(before.objects);
});

test("cancelled Google sign-in strips its query and keeps the mobile guest canvas available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: { error: { code: "UNAUTHENTICATED", details: { googleSignInEnabled: false } } } }));
  await page.goto("/scribble/?authError=denied");
  const account = page.getByRole("region", { name: "Your account", exact: true });
  await expect(account.getByRole("alert")).toContainText("Google sign-in was cancelled");
  await expect(account).toContainText("Google sign-in isn’t available");
  await expect(account.getByRole("link", { name: "Sign in with Google" })).toHaveCount(0);
  expect(page.url()).not.toContain("authError");
  await expect(page.getByLabel("Drawing title")).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("direct Google entry flushes a just-committed guest title before navigation", async ({ page }) => {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  await page.route("**/api/auth/google", (route) => route.fulfill({ status: 302, headers: { location: "/scribble/?authError=denied" } }));
  await page.goto("/scribble/");
  await page.getByLabel("Drawing title").fill("Fresh edit before Google");
  // Clicking outside commits the header title before the direct auth action.
  await page.getByRole("button", { name: "Sign in with Google", exact: true }).click();
  await expect(page.getByRole("region", { name: "Your account" }).getByRole("alert")).toContainText("Google sign-in was cancelled");
  await expect(page.getByLabel("Drawing title")).toHaveValue("Fresh edit before Google");
  expect((await localBoard(page))?.title).toBe("Fresh edit before Google");
});
