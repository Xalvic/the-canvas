import { expect, test } from "@playwright/test";
import { firstId, savedBoard, mockAccount, createNote, canvasState, openBoard, editNote, documentWrites } from "./fixtures/account";
import { browse, closeDialogs, explicitSave, backToDevice, rowActions } from "./fixtures/ui";

test("compact guest workspace, account dialog isolation, sign-in without uploads and sign-out", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Fixture board")]);
  cloud.signedIn = false;
  await page.goto("/scribble/");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Saved on this device", exact: true })).toBeVisible();
  await createNote(page, "Device note");
  await expect(page.getByRole("button", { name: "Saved on this device", exact: true })).toBeVisible();
  const before = await canvasState(page);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.keyboard.press("Delete");
  await page.keyboard.press("n");
  expect(await canvasState(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeFocused();
  cloud.signedIn = true;
  await page.reload();
  await expect(page.getByRole("button", { name: "Account", exact: true })).toBeVisible();
  expect((await canvasState(page)).objects).toEqual(before.objects);
  expect(cloud.mutations).toHaveLength(0);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
  expect((await canvasState(page)).objects).toEqual(before.objects);
});

test("board categories, search, contextual rename/delete and explicit account copy preserve the device board", async ({ page }) => {
  const owner = savedBoard(firstId, "Owner example");
  const shared = savedBoard("33333333-3333-4333-8333-333333333333", "Shared example");
  shared.role = "editor"; shared.document!.role = "editor";
  const cloud = await mockAccount(page, [owner, shared]);
  await page.goto("/scribble/");
  await createNote(page, "Guest source");
  const original = (await canvasState(page)).objects;
  await browse(page);
  await expect(page.locator(".board-browser-list")).toContainText(owner.title);
  await expect(page.locator(".board-browser-list")).not.toContainText(shared.title);
  await page.getByRole("button", { name: "Shared with me", exact: true }).click();
  await expect(page.locator(".board-browser-list")).toContainText(shared.title);
  await page.getByRole("button", { name: "My boards", exact: true }).click();
  await page.getByLabel("Find a board").fill("unknown");
  await expect(page.getByText("No matching boards.", { exact: true })).toBeVisible();
  await page.getByLabel("Find a board").fill("");
  await rowActions(page, owner.title);
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("New board title").fill("Renamed example");
  await page.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(page.getByText("Renamed example", { exact: true })).toBeVisible();
  await closeDialogs(page);
  await page.getByRole("button", { name: "Save to account", exact: true }).click();
  expect(cloud.mutations.filter((mutation) => mutation.method === "POST")).toHaveLength(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await explicitSave(page, "Save to account");
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  expect(cloud.mutations.filter((mutation) => mutation.method === "POST" && mutation.path === "/api/boards")).toHaveLength(1);
  await backToDevice(page);
  expect((await canvasState(page)).objects).toEqual(original);
  await rowActions(page, "Renamed example");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Delete account board" })).toContainText("Renamed example");
  await page.getByRole("button", { name: "Delete board", exact: true }).click();
  await expect(page.getByText("Renamed example", { exact: true })).toHaveCount(0);
  await closeDialogs(page);
  expect((await canvasState(page)).objects).toEqual(original);
});

test("cloud save, explicit image state and simultaneous local/cloud failure stay visible with menus closed", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Status board")]);
  await page.goto("/scribble/");
  await openBoard(page, "Status board");
  await expect(page.getByRole("button", { name: "Saved to account", exact: true })).toBeVisible();
  await editNote(page, "Status board", "Cloud edit");
  await expect.poll(() => documentWrites(cloud).length).toBe(1);
  await expect(page.getByRole("button", { name: "Saved to account", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    useDocumentStore.getState().addObject({ id: "ux-image", type: "image", assetId: "ux-local-asset", name: "Fixture image", x: 600, y: 500, width: 40, height: 40, originalWidth: 40, originalHeight: 40, zIndex: 2, createdAt: 1, updatedAt: 1 });
  });
  await expect(page.locator(".board-notice")).toContainText(/image waiting to upload|Account save failed/);
  await expect(page.locator(".save-status")).toHaveText("Account save failed · saved on this device");
  await page.evaluate(async () => {
    const { useBoardStore } = await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts");
    useBoardStore.getState().markSaveError("Disposable device write failure");
  });
  await expect(page.locator(".save-status")).toHaveText("Your changes haven’t been saved");
  await expect(page.locator(".board-notice")).toContainText("Your changes haven’t been saved");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(cloud.mutations.filter((mutation) => mutation.path.includes("assets"))).toHaveLength(0);
});

test("sharing double-submit/lost response is not replayed and a manual invitation link remains reachable", async ({ page }) => {
  await mockAccount(page, [savedBoard(firstId, "Share fixture")]);
  const invites: { id: string; email: string; role: string; expiresAt: number }[] = [];
  let writes = 0;
  await page.route(`**/api/boards/${firstId}/sharing`, (route) => route.fulfill({ json: { members: [], invitations: invites } }));
  await page.route(`**/api/boards/${firstId}/invitations`, async (route) => {
    writes++;
    invites.push({ id: "44444444-4444-4444-8444-444444444444", ...route.request().postDataJSON(), expiresAt: Date.now() + 86400000 });
    await route.abort("failed");
  });
  await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("Fixture clipboard refusal"); } } }); });
  await page.goto("/scribble/");
  await openBoard(page, "Share fixture");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByLabel("Google email", { exact: true }).fill("friend@example.com");
  await page.locator(".board-sharing form").evaluate((form) => { (form as HTMLFormElement).requestSubmit(); (form as HTMLFormElement).requestSubmit(); });
  await expect(page.getByText(/request may have reached your account/)).toBeVisible();
  expect(writes).toBe(1);
  await expect(page.getByRole("button", { name: "Create invitation", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Copy invitation link", exact: true }).click();
  await expect(page.getByLabel("Invitation link", { exact: true })).toHaveValue(/\?invite=44444444/);
  await expect(page.getByText(/No email is sent/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeFocused();
});

test("invitation intent survives a Google redirect and acceptance remains explicit", async ({ page }) => {
  const cloud = await mockAccount(page);
  cloud.signedIn = false;
  const id = "44444444-4444-4444-8444-444444444444";
  let accepts = 0;
  await page.route("**/api/auth/google", (route) => { cloud.signedIn = true; return route.fulfill({ status: 302, headers: { location: "/scribble/" } }); });
  await page.route("**/api/invitations", (route) => route.fulfill({ json: { invitations: [{ id, email: "owner@example.com", role: "viewer", expiresAt: Date.now() + 86400000, boardId: firstId, boardTitle: "Linked fixture", ownerEmail: "friend@example.com" }] } }));
  await page.route(`**/api/invitations/${id}/accept`, (route) => { accepts++; return route.fulfill({ status: 204 }); });
  await page.goto(`/scribble/?invite=${id}`);
  await page.getByRole("dialog", { name: "Your boards", exact: true }).getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Sign in with Google" }).click();
  await expect(page.getByRole("button", { name: "Accept invitation", exact: true })).toBeVisible();
  expect(page.url()).not.toContain("invite=");
  expect(accepts).toBe(0);
  expect(cloud.mutations).toHaveLength(0);
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open board", exact: true })).toBeVisible();
  expect(accepts).toBe(1);
});
