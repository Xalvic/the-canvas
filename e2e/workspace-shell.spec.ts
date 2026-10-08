import { expect, test } from "@playwright/test";
import { firstId, secondId, user, savedBoard, mockAccount, canvasState } from "./fixtures/account";
import { browse, closeDialogs, rowActions } from "./fixtures/ui";

test("long account names stay inside the sidebar and leave zoom controls clickable", async ({ page }) => {
  await mockAccount(page, [savedBoard(firstId, "Long account name", [])]);
  const displayName = "An account with a very long display name that must stay inside its sidebar";
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: { user: { ...user, displayName }, capabilities: { guestTransfer: 1 } } }));
  await page.setViewportSize({ width: 1280, height: 720 }); await page.goto("/scribble/");
  await expect(page.getByLabel("Page title")).toBeEnabled();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [1280, 1440, 1101, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 720 });
      await browse(page);
      const sidebar = page.locator(".page-sidebar"), button = sidebar.getByRole("button", { name: "Account menu", exact: true });
      const bounds = (await sidebar.boundingBox())!, account = (await button.boundingBox())!;
      expect(account.x + account.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(await button.locator(".account-name").evaluate((name) => name.scrollWidth > name.clientWidth)).toBe(true);
      await button.click(); await expect(page.getByRole("menu", { name: "Account menu" })).toContainText(displayName);
      await page.keyboard.press("Escape"); await expect(button).toBeFocused();
      if (width === 1280 || width === 390) await page.screenshot({ path: `ui-redesign-evidence/r7-long-account-${width}-${theme}.png` });
      await closeDialogs(page);
      const before = await canvasState(page);
      await page.getByRole("button", { name: "Zoom options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Reset viewport", exact: true }).click();
      expect((await canvasState(page)).objects).toEqual(before.objects);
      expect((await canvasState(page)).past).toEqual(before.past);
    }
  }
});

test("flat desktop sidebar and adaptive drawer retain visibility, coordinates and one account controller", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Navigation page", [])]);
  let accountReads = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/auth/me") accountReads++; });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/scribble/");
  await expect(page.getByLabel("Page title", { exact: true })).toBeEnabled();
  const sidebar = page.locator("aside.page-sidebar");
  await expect(sidebar).toBeVisible();
  const box = (await sidebar.boundingBox())!;
  expect(box.x).toBe(0); expect(box.y).toBe(0); expect(box.height).toBe(900);
  await expect(page.locator(".board-header")).toHaveCount(0);
  await expect(page.locator(".sidebar-account .account-trigger")).toHaveCount(1);
  const tools = (await page.locator(".toolbar-area").boundingBox())!;
  expect(tools.x + tools.width / 2).toBeCloseTo((box.width + 1440) / 2);
  expect((await page.locator(".zoom-dock").boundingBox())!.x).toBeGreaterThan(box.width);
  await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts")).useViewportStore.getState().setViewport({ x: 120, y: -80, zoom: 1.5 }));
  const before = await canvasState(page), canvas = await page.locator(".canvas-viewport").boundingBox();
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await expect(sidebar).toHaveCount(0); await expect(page.locator(".workspace-account-corner .account-trigger")).toHaveCount(1);
  expect((await canvasState(page)).viewport).toEqual(before.viewport); expect(await page.locator(".canvas-viewport").boundingBox()).toEqual(canvas);
  await page.reload(); await expect(page.getByLabel("Page title", { exact: true })).toBeEnabled(); await expect(sidebar).toHaveCount(0);
  await page.getByRole("button", { name: "Pages", exact: true }).click(); await expect(sidebar).toBeVisible();
  const reads = accountReads;
  for (const width of [1100, 768, 390]) {
    await page.setViewportSize({ width, height: 844 }); await expect(sidebar).toHaveCount(0);
    expect(await page.evaluate((id) => localStorage.getItem(`scribble:page-sidebar:${id}`), user.id)).toBe("open");
    await browse(page); await expect(page.getByRole("dialog", { name: "Pages", exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Pages", exact: true })).toBeFocused();
  }
  await page.setViewportSize({ width: 1101, height: 900 }); await expect(sidebar).toBeVisible();
  expect(accountReads).toBe(reads); expect(cloud.mutations).toHaveLength(0);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Your account and retained drawing", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Your account", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole("dialog", { name: "Your account", exact: true })).toBeVisible();
  await closeDialogs(page); await expect(page.locator(".account-trigger")).toHaveCount(1);
});

test("title editing commits on Enter and blur, cancels on Escape and respects composing keys", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "Original title", [])]);
  await page.goto("/scribble/"); const title = page.getByLabel("Page title", { exact: true }); await expect(title).toBeEnabled();
  const before = await canvasState(page);
  await title.fill("Cancelled title"); await title.press("Escape"); await expect(title).toHaveValue("Original title");
  expect(cloud.boards.get(firstId)!.title).toBe("Original title");
  await title.focus(); await title.dispatchEvent("compositionstart"); await title.fill("例のページ");
  for (const key of ["Enter", "Escape"]) {
    await title.dispatchEvent("keydown", { key, isComposing: true }); await expect(title).toBeFocused(); await expect(title).toHaveValue("例のページ");
  }
  expect(cloud.boards.get(firstId)!.title).toBe("Original title");
  await title.dispatchEvent("compositionend"); await title.press("Enter");
  await expect.poll(() => cloud.boards.get(firstId)!.title).toBe("例のページ");
  await title.fill("Committed on blur"); await page.getByRole("button", { name: "App menu", exact: true }).click();
  await expect.poll(() => cloud.boards.get(firstId)!.title).toBe("Committed on blur"); await page.keyboard.press("Escape");
  await expect(title).toHaveAttribute("title", "Committed on blur");
  expect((await canvasState(page)).objects).toEqual(before.objects); expect((await canvasState(page)).past).toEqual(before.past);
});

test("page search, shared roles and scrolled row actions preserve rename and deletion confirmation", async ({ page }) => {
  const shared = savedBoard(secondId, "Shared viewer page", []); shared.role = "viewer"; shared.document!.role = "viewer";
  const extras = Array.from({ length: 24 }, (_, i) => savedBoard(`${String(i + 10).padStart(8, "0")}-4444-4444-8444-444444444444`, `Example page ${i}`, []));
  const cloud = await mockAccount(page, [savedBoard(firstId, "Owned page", []), ...extras, shared]);
  await page.setViewportSize({ width: 1440, height: 600 }); await page.goto("/scribble/"); await expect(page.getByLabel("Page title", { exact: true })).toBeEnabled();
  const search = page.getByRole("searchbox", { name: "Find a page" });
  await search.fill("Shared viewer"); await expect(page.getByRole("list", { name: "Shared with me", exact: true })).toContainText(shared.title);
  await expect(page.getByRole("button", { name: "Actions for Shared viewer page", exact: true })).toHaveCount(0);
  await search.fill("No such page"); await expect(page.getByText("No matching pages.", { exact: true })).toBeVisible();
  await search.fill(""); await rowActions(page, "Example page 23");
  const menu = page.getByRole("menu", { name: "Actions for Example page 23", exact: true }); await expect(menu).toBeInViewport();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("textbox", { name: "Rename Example page 23", exact: true });
  await rename.fill("Cancelled row title"); await rename.press("Escape");
  await rowActions(page, "Example page 23"); await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  await rename.fill("Renamed row"); await rename.press("Enter");
  await expect.poll(() => cloud.boards.get(extras.at(-1)!.id)!.title).toBe("Renamed row");
  await rowActions(page, "Renamed row"); await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Delete page", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); expect(cloud.boards.has(extras.at(-1)!.id)).toBe(true);
  await search.fill("Shared viewer"); await page.getByRole("button", { name: /^Shared viewer page/ }).click();
  await expect(page.getByLabel("Page title", { exact: true })).toBeDisabled(); await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
});

test("drawer backdrop and footer keys cannot draw, delete or paste; modal focus includes relocated controls", async ({ page }) => {
  await mockAccount(page, [savedBoard(firstId, "Protected drawing")]);
  await page.goto("/scribble/"); await expect(page.getByLabel("Page title", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
  for (const size of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    const previous = await canvasState(page), bounds = (await page.locator(".canvas-viewport").boundingBox())!;
    await page.setViewportSize(size);
    await expect.poll(async () => (await canvasState(page)).viewport).toEqual({
      ...previous.viewport, x: previous.viewport.x + (size.width - bounds.width) / 2, y: previous.viewport.y + (size.height - bounds.height) / 2,
    });
    const before = await canvasState(page);
    await browse(page); const drawer = page.getByRole("dialog", { name: "Pages", exact: true });
    await page.getByRole("button", { name: "Account menu", exact: true }).focus();
    await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Close Pages", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(page.getByRole("button", { name: "Account menu", exact: true })).toBeFocused();
    await page.keyboard.press("Delete"); await page.keyboard.press("n");
    expect(await page.locator(".account-trigger").evaluate((button) => {
      const data = new DataTransfer(); data.items.add(new File(["fixture"], "fixture.png", { type: "image/png" }));
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }); button.dispatchEvent(event); return event.defaultPrevented;
    })).toBe(false);
    await page.getByRole("button", { name: "Help and shortcuts", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Help and shortcuts", exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Help and shortcuts", exact: true })).toBeFocused();
    const box = (await drawer.boundingBox())!; await page.mouse.click(box.x + box.width + 12, box.y + 180);
    await expect(drawer).toHaveCount(0); await expect(page.getByRole("button", { name: "Pages", exact: true })).toBeFocused();
    expect(await canvasState(page)).toEqual(before); await expect(page.locator(".canvas-viewport")).toHaveAttribute("data-active-tool", "pen");
  }
});

test("mobile page navigation closes the drawer and footer theme/help preserve account and canvas work", async ({ page }) => {
  const cloud = await mockAccount(page, [savedBoard(firstId, "First page", []), savedBoard(secondId, "Second page", [])]);
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/scribble/"); await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("First page");
  await browse(page); await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Second page", exact: true }).click();
  await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Second page"); await expect(page.locator(".page-sidebar")).toHaveCount(0);
  await expect(page.locator(".account-trigger")).toHaveCount(1); expect(cloud.mutations).toHaveLength(0);
  await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark"); await expect(page.getByLabel("Page title", { exact: true })).toHaveValue("Second page");
  await browse(page); await page.screenshot({ path: "ui-redesign-evidence/r2-drawer-dark.png" });
});
