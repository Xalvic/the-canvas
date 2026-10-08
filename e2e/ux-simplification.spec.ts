import { expect, test } from "@playwright/test";import { readFile } from "node:fs/promises";
import { firstId, savedBoard, mockAccount, createNote, canvasState, localBoard, openBoard, editNote, documentWrites } from "./fixtures/account";
import { browse, closeDialogs, accountMenu, rowActions } from "./fixtures/ui";

test("minimal guest UI keeps local saving quiet and consent keyboard actions isolated", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Fixture page")]); cloud.signedIn = false;
  await page.goto("/scribble/");
  await expect(page.getByRole("button", { name: "Sign in with Google", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Pages|Save to account|New page)$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
  await expect(page.locator(".save-status")).toHaveCount(0);
  await createNote(page, "Device note"); const before = await canvasState(page);
  await accountMenu(page); await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page.keyboard.press("Delete"); await page.keyboard.press("n"); expect(await canvasState(page)).toEqual(before);
  await page.keyboard.press("Escape"); await expect(page.locator(".account-trigger")).toBeFocused();
  await expect.poll(async () => (await localBoard(page))?.objects).toEqual(before.objects);  cloud.signedIn = true; await page.reload(); await expect(page.getByLabel("Page title")).toHaveValue("Fixture page");
  expect(cloud.mutations).toHaveLength(0);
  await accountMenu(page); await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Drawing title")).toBeVisible(); expect((await canvasState(page)).objects).toEqual(before.objects);
});

test("page search, inline rename, cancel and deletion preserve the local guest drawing", async ({ page }) => {
  const owner = savedBoard(firstId, "Owner example"), shared = savedBoard("33333333-3333-4333-8333-333333333333", "Shared example");
  shared.role = "editor"; shared.document!.role = "editor";
  const cloud = await mockAccount(page, [owner, shared]); cloud.signedIn = false;
  await page.goto("/scribble/"); await createNote(page, "Guest source"); const original = (await canvasState(page)).objects;
  await expect.poll(async () => (await localBoard(page))?.objects).toEqual(original);  cloud.signedIn = true; await page.reload(); await expect(page.getByLabel("Page title")).toHaveValue(owner.title); await browse(page);
  await expect(page.getByRole("list", { name: "My pages", exact: true })).toContainText(owner.title);
  await expect(page.getByRole("list", { name: "Shared with me", exact: true })).toContainText(shared.title);
  await page.getByRole("searchbox", { name: "Find a page" }).fill("unknown"); await expect(page.getByText("No matching pages.", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Find a page" }).fill(""); await rowActions(page, owner.title);
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click(); const rename = page.getByRole("textbox", { name: `Rename ${owner.title}`, exact: true });
  await rename.fill("Cancelled"); await rename.press("Escape"); expect(cloud.mutations).toHaveLength(0);
  await rowActions(page, owner.title); await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await rename.fill("Renamed example"); await rename.press("Enter"); await expect.poll(() => cloud.boards.get(firstId)!.title).toBe("Renamed example");
  await rowActions(page, "Renamed example"); await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete page", exact: true }).getByRole("button", { name: "Delete page", exact: true }).click();
  await expect(page.getByLabel("Page title")).toHaveValue(shared.title);
  expect((await localBoard(page))!.objects).toEqual(original);
});

test("missing images and device failures produce one notice with menus closed", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Status page")]); await page.goto("/scribble/"); await openBoard(page, "Status page");
  await editNote(page, "Status page", "Cloud edit"); await expect.poll(() => documentWrites(cloud).length).toBe(1);
  await page.evaluate(async () => {
    const { useDocumentStore } = await import(/* @vite-ignore */ "/scribble/src/store/documentStore.ts");
    useDocumentStore.getState().addObject({ id: "ux-image", type: "image", assetId: "ux-local-asset", name: "Fixture image", x: 600, y: 500, width: 40, height: 40, originalWidth: 40, originalHeight: 40, zIndex: 2, createdAt: 1, updatedAt: 1 });
  });
  await expect(page.locator(".board-notice")).toContainText(/Restore the image/); await expect(page.locator(".save-status")).toHaveCount(0);  await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts")).useBoardStore.getState().markSaveError("Disposable device write failure"));
  await expect(page.locator(".board-notice")).toHaveCount(1); await expect(page.locator(".board-notice")).toContainText("Your changes haven’t been saved");
  expect(cloud.mutations.filter((mutation) => mutation.path.includes("assets"))).toHaveLength(0);
});

test("lost Share response reconciles the original request without stealing focus and manual copying remains reachable", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Share fixture")]);
  const { mockShareLinks } = await import("./fixtures/shareLinks");
  const links = await mockShareLinks(page, cloud, firstId); links.loseNextCopyResponse = true;
  await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("Fixture clipboard refusal"); } } }); });
  await page.goto("/scribble/");
  await openBoard(page, "Share fixture");
  const share = page.getByRole("button", { name: "Share", exact: true });
  await share.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByText(/original request is saved/)).toBeVisible();
  await page.getByLabel("Page title").focus();
  await expect(page.getByRole("complementary", { name: "Link sharing", exact: true })).toContainText("request is confirmed");
  await expect(page.getByLabel("Page title")).toBeFocused();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(links.copyRequests).toHaveLength(2);
  expect(links.copyRequests[1]).toEqual(links.copyRequests[0]);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByLabel("Shared page link", { exact: true })).toHaveValue(/#share=/);
  expect(links.copyRequests).toHaveLength(2);
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Shared page link", { exact: true })).toHaveCount(0);
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
  await page.getByRole("dialog", { name: "Invitations", exact: true }).getByRole("button", { name: "Sign in with Google", exact: true }).click();
  await page.getByRole("link", { name: "Sign in with Google" }).click();
  await expect(page.getByRole("button", { name: "Accept invitation", exact: true })).toBeVisible();
  expect(page.url()).not.toContain("invite=");
  expect(accepts).toBe(0);
  expect(cloud.mutations).toHaveLength(0);
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open page", exact: true })).toBeVisible();
  expect(accepts).toBe(1);
});test("the app menu exports local drawing data and image bytes without cloud writes", async ({ page }) => {  const cloud = await mockAccount(page); cloud.signedIn = false;  await page.goto("/scribble/"); await createNote(page, "Exported note");  await page.locator(".canvas-viewport").evaluate(async (element) => {    const canvas = document.createElement("canvas"); canvas.width = 20; canvas.height = 10; canvas.getContext("2d")!.fillRect(0, 0, 20, 10);    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));    const data = new DataTransfer(); data.items.add(new File([blob], "export.png", { type: "image/png" }));    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data, clientX: 650, clientY: 510 }));  });  await expect(page.locator(".image-object-value")).toHaveCount(1);  await page.getByRole("button", { name: "App menu", exact: true }).click();  const downloadEvent = page.waitForEvent("download"); await page.getByRole("menuitem", { name: "Export drawing data", exact: true }).click();  const download = await downloadEvent; const payload = JSON.parse(await readFile((await download.path())!, "utf8"));  expect(download.suggestedFilename()).toMatch(/\.scribble\.json$/); expect(payload.format).toBe("scribble-drawing");  expect(Object.values(payload.objects)).toHaveLength(2); expect(payload.images[0].data).toMatch(/^data:image\/png;base64,/);  expect(payload.account).toBeUndefined(); expect(cloud.mutations).toHaveLength(0);});test("app menu keyboard navigation restores focus and help describes automatic page saving", async ({ page }) => {  const cloud = await mockAccount(page); cloud.signedIn = false;  await page.goto("/scribble/"); await createNote(page, "Menu preserves selection"); const before = await canvasState(page);  const trigger = page.getByRole("button", { name: "App menu", exact: true }); await trigger.click();  await page.keyboard.press("End"); await expect(page.getByRole("menuitem", { name: "Help and shortcuts", exact: true })).toBeFocused();  await page.keyboard.press("Enter"); await expect(page.getByRole("dialog", { name: "Help and shortcuts", exact: true })).toBeVisible();  await page.keyboard.press("Delete"); expect((await canvasState(page)).objects).toEqual(before.objects);  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();  await trigger.click(); await page.getByRole("menuitem", { name: "Dark theme", exact: true }).click();  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");});
