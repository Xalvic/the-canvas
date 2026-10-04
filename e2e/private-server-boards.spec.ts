import { expect, test } from "@playwright/test";

const user = { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", displayName: "Owner" };
const guest = { error: { code: "UNAUTHENTICATED", details: { googleSignInEnabled: false } } };

test("guest canvas stays available without requesting private boards", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: guest }));
  await page.route("**/api/boards", (route) => { requests++; return route.fulfill({ status: 401, json: guest }); });
  await page.goto("/scribble/");
  await expect(page.getByText("Sign in to see your server boards.")).toBeVisible();
  await expect(page.getByLabel("Board title")).toBeEnabled();
  await page.getByLabel("Board title").fill("Guest work stays local");
  expect(requests).toBe(0);
  await expect(page.getByText("Couldn’t load server boards. Try again.")).toHaveCount(0);
});

test("sign-out clears private titles immediately while preserving the local board", async ({ page }) => {
  let signedIn = true;
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { user } : guest }));
  await page.route("**/api/boards", (route) => route.fulfill({ json: { boards: [{ id: "private-board", title: "Only my account" }] } }));
  await page.route("**/api/auth/logout", (route) => { signedIn = false; return route.fulfill({ status: 204 }); });
  await page.goto("/scribble/");
  await expect(page.getByText("Only my account", { exact: true })).toBeVisible();
  await page.getByLabel("Board title").fill("My guest sketch");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByText("Only my account", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Sign in to see your server boards.")).toBeVisible();
  await expect(page.getByLabel("Board title")).toHaveValue("My guest sketch");
});

test("an expired board session clears the list and prompts sign-in", async ({ page }) => {
  let expired = false;
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: expired ? 401 : 200, json: expired ? { error: { code: "UNAUTHENTICATED", details: { googleSignInEnabled: true } } } : { user } }));
  await page.route("**/api/boards", (route) => route.fulfill({ status: expired ? 401 : 200, json: expired ? guest : { boards: [{ id: "private-board", title: "Private work" }] } }));
  await page.goto("/scribble/");
  await expect(page.getByText("Private work", { exact: true })).toBeVisible();
  expired = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Sign in to see your server boards.")).toBeVisible();
  await expect(page.getByText("Private work", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByLabel("Board title")).toBeEnabled();
});

test("a pending board response cannot restore private titles after sign-out", async ({ page }) => {
  let signedIn = true;
  let releaseResponse!: () => void;
  let requestStarted!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? { user } : guest }));
  await page.route("**/api/boards", async (route) => {
    requestStarted();
    await responseGate;
    await route.fulfill({ json: { boards: [{ id: "private-board", title: "Late private title" }] } }).catch(() => {});
  });
  await page.route("**/api/auth/logout", (route) => { signedIn = false; return route.fulfill({ status: 204 }); });
  await page.goto("/scribble/");
  await started;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByText("Sign in to see your server boards.")).toBeVisible();
  releaseResponse();
  await expect(page.getByText("Late private title", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Sign in to see your server boards.")).toBeVisible();
});
