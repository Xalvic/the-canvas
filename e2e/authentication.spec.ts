import { test, expect, type Page } from "@playwright/test";

const user = { id: "550e8400-e29b-41d4-a716-446655440000", email: "artist@example.com", displayName: "Artist" };
const guest = (enabled = true) => ({ error: { code: "UNAUTHENTICATED", details: { googleSignInEnabled: enabled } } });
async function canvasState(page: Page) {
  return page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    const state = useDocumentStore.getState();
    return { objects: state.objects, past: state.past, future: state.future };
  });
}

test("optional Google account state, logout and retry preserve the guest drawing/history across reload", async ({ page }) => {
  let signedIn = false, offline = false, logoutFailure = false;
  await page.route("**/api/auth/me", async (route) => {
    if (offline) { await route.abort("failed"); return; }
    await route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { user } : guest() });
  });
  await page.route("**/api/auth/logout", async (route) => {
    expect(route.request().headers()["x-scribble-request"]).toBe("1");
    if (logoutFailure) { await route.fulfill({ status: 500, json: { error: {} } }); return; }
    signedIn = false; await route.fulfill({ status: 204 });
  });
  await page.route("**/api/boards", (route) => route.fulfill({ json: { boards: [] } }));
  await page.goto("/scribble/");
  const account = page.getByRole("region", { name: "Your account" });
  await expect(account.getByRole("link", { name: "Sign in with Google" })).toHaveAttribute("href", "/api/auth/google");
  await page.getByRole("button", { name: "Note tool", exact: true }).click();
  await page.mouse.click(240, 420);
  await page.keyboard.press("Escape");
  const drawing = (await canvasState(page)).objects;
  const before = await canvasState(page);
  await account.getByRole("link").focus(); await page.keyboard.press("Backspace");
  expect(await canvasState(page)).toEqual(before);
  await page.waitForTimeout(800); // Allow the existing guest autosave debounce.
  signedIn = true; await page.reload();
  await expect(account).toContainText("artist@example.com");
  expect((await canvasState(page)).objects).toEqual(drawing);
  const authenticated = await canvasState(page);
  logoutFailure = true; await account.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(account.getByRole("alert")).toContainText("Couldn’t sign out");
  await expect(account).toContainText("artist@example.com"); expect(await canvasState(page)).toEqual(authenticated);
  logoutFailure = false; await account.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(account.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
  expect(await canvasState(page)).toEqual(authenticated);
  offline = true; await page.reload();
  await expect(account.getByRole("alert")).toContainText("Couldn’t check sign-in");
  offline = false; await account.getByRole("button", { name: "Retry sign-in check" }).click();
  await expect(account.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
  expect((await canvasState(page)).objects).toEqual(drawing);
});

test("cancelled Google sign-in is clear in Strict Mode, strips its query and keeps the mobile guest canvas available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: guest(false) }));
  await page.route("**/api/boards", (route) => route.fulfill({ json: { boards: [] } }));
  await page.goto("/scribble/?authError=denied");
  const account = page.getByRole("region", { name: "Your account" });
  await expect(account.getByRole("alert")).toContainText("Google sign-in was cancelled");
  await expect(account).toContainText("Google sign-in isn’t available");
  await expect(account.getByRole("link", { name: "Sign in with Google" })).toHaveCount(0);
  expect(page.url()).not.toContain("authError");
  await expect(page.getByLabel("Board title")).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Google navigation waits for a just-edited guest board to finish IndexedDB autosave", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: guest() }));
  await page.route("**/api/boards", (route) => route.fulfill({ json: { boards: [] } }));
  await page.route("**/api/auth/google", (route) => route.fulfill({ status: 302, headers: { location: "/scribble/?authError=denied" } }));
  await page.goto("/scribble/");
  await page.getByLabel("Board title").fill("Fresh edit before Google");
  await page.getByRole("link", { name: "Sign in with Google" }).click();
  await expect(page.getByRole("region", { name: "Your account" }).getByRole("alert")).toContainText("Google sign-in was cancelled");
  await expect(page.getByLabel("Board title")).toHaveValue("Fresh edit before Google");
});
