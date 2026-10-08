import { expect, test, type Page } from "@playwright/test";
import { firstId, savedBoard, mockAccount, canvasState } from "./fixtures/account";
import { browse, closeDialogs, details } from "./fixtures/ui";

async function controlsFit(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const visible = (element: HTMLElement) => element.getBoundingClientRect().width > 0 && getComputedStyle(element).visibility !== "hidden" && !element.closest('dialog:not([open])');
    const controls = [...document.querySelectorAll(".workspace-title-controls > *, .workspace-share-controls > *")].filter((element): element is HTMLElement => element instanceof HTMLElement && !element.matches("dialog"));
    const chrome = [...document.querySelectorAll<HTMLElement>(".desktop-tool-dock,.mobile-tool-dock,.history-controls,.zoom-controls,.tool-options,.mobile-selection-actions,.board-notice,.page-sidebar:not(dialog)")];
    const items = [...controls, ...chrome].filter(visible).map((element) => ({ name: element.className, rect: element.getBoundingClientRect() }));
    const overlaps = items.flatMap((a, index) => items.slice(index + 1).filter((b) => Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 1 && Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 1).map((b) => `${a.name}/${b.name}`));
    return { overlaps, outside: items.filter(({ rect }) => rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1).map(({ name }) => name), overflow: document.documentElement.scrollWidth > innerWidth };
  })).toEqual({ overlaps: [], outside: [], overflow: false });
}

for (const signedIn of [false, true]) {
  test(`${signedIn ? "owner" : "guest"} chrome fits light/dark, narrow screens, tablet and landscape`, async ({ page }) => {
    const board = savedBoard(firstId, "A very long example page title for checking a narrow workspace and account controls", []);
    const cloud = await mockAccount(page, [board]); cloud.signedIn = signedIn;
    await page.goto("/scribble/");
    await expect(page.getByLabel(signedIn ? "Page title" : "Drawing title", { exact: true })).toBeEnabled();
    if (signedIn) {
      await expect(page.locator(".save-status")).toHaveAccessibleName("Saved to account");
      await page.evaluate(async () => {
        const { useCollaborationStore } = await import(/* @vite-ignore */ "/scribble/src/store/collaborationStore.ts");
        useCollaborationStore.setState({ status: "connected", participants: [{ clientId: "layout-peer", userId: "fixture-peer", displayName: "Layout collaborator", cursor: null, selectedIds: [] }] });
      });
    } else {
      await page.getByLabel("Drawing title").fill(board.title); await page.getByLabel("Drawing title").press("Enter");
      await expect(page.locator(".save-status")).toHaveCount(0);
    }
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      for (const size of [{ width: 320, height: 700 }, { width: 360, height: 844 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(size); await controlsFit(page);
        await page.getByRole("button", { name: "Pen tool", exact: true }).click(); await controlsFit(page);
        const expand = page.getByRole("button", { name: "Expand settings", exact: true });
        if (await expand.isVisible()) await expand.click();
        await controlsFit(page);
        if (size.width === 390 || size.width === 1440) await page.screenshot({ path: `workspace-ux-evidence/m11-${signedIn ? "owner" : "guest"}-${size.width}-${theme}.png` });
        await page.getByRole("button", { name: "Close settings", exact: true }).click();
        if (signedIn && size.width <= 1100) {
          await browse(page); await expect(page.getByRole("dialog", { name: "Pages", exact: true })).toBeInViewport();
          for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); expect(await page.locator("dialog[open]").evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true); }
          await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Pages", exact: true })).toBeFocused();
        }
      }
    }
  });
}

test("toolbar traversal, settings Escape, menus and focused zoom isolate canvas shortcuts", async ({ page }) => {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  await page.goto("/scribble/"); await expect(page.getByLabel("Drawing title")).toBeEnabled();
  const select = page.getByRole("button", { name: "Select tool", exact: true });
  await select.focus(); await page.keyboard.press("ArrowRight"); await expect(page.getByRole("button", { name: "Hand tool", exact: true })).toBeFocused();
  await page.keyboard.press("End"); await expect(page.getByRole("button", { name: "Pen tool", exact: true })).toBeFocused();
  await page.keyboard.press("Space"); await expect(page.locator(".canvas-viewport")).toHaveAttribute("data-space-pressed", "false");
  await page.getByRole("button", { name: "Red", exact: true }).focus(); await page.keyboard.press("n"); await expect(page.locator(".canvas-viewport")).toHaveAttribute("data-active-tool", "pen");
  await page.keyboard.press("Escape"); await expect(select).toBeFocused(); await expect(page.locator(".tool-options")).toHaveCount(0);
  await page.getByRole("button", { name: "Zoom in", exact: true }).focus(); const before = await canvasState(page);
  await page.keyboard.press("n"); await page.keyboard.press("+");
  expect((await canvasState(page)).viewport).toEqual(before.viewport); await expect(page.locator(".canvas-viewport")).toHaveAttribute("data-active-tool", "select");
  await page.keyboard.press("Space"); await expect(page.getByLabel("Current zoom")).toHaveText("120%"); await expect(page.locator(".canvas-viewport")).toHaveAttribute("data-space-pressed", "false");
  await page.getByRole("button", { name: "App menu", exact: true }).click(); await page.keyboard.press("End"); await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Help and shortcuts" })).toBeVisible(); await closeDialogs(page); await expect(page.getByRole("button", { name: "App menu", exact: true })).toBeFocused();
  expect(await page.getByRole("button", { name: "App menu", exact: true }).evaluate((button) => {
    const data = new DataTransfer(); data.items.add(new File(["fixture"], "fixture.png", { type: "image/png" }));
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }); button.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(false);
});

test("mobile More tools navigates, dismisses and restores focus; dock collapse keeps zoom/history", async ({ page }) => {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  await page.setViewportSize({ width: 320, height: 700 }); await page.goto("/scribble/"); await expect(page.getByLabel("Drawing title")).toBeEnabled();
  const more = page.getByRole("button", { name: "More tools", exact: true });
  await more.click(); await expect(page.getByRole("menuitemradio", { name: "Hand tool" })).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(page.getByRole("menuitemradio", { name: "Connect tool" })).toBeFocused();
  await page.keyboard.press("n"); await expect(page.locator(".canvas-viewport")).toHaveAttribute("data-active-tool", "select");
  await page.keyboard.press("Escape"); await expect(more).toBeFocused(); await expect(page.getByRole("menu")).toHaveCount(0);
  await more.click(); await page.keyboard.press("End"); await page.keyboard.press("Enter"); await expect(page.locator(".canvas-viewport")).toHaveAttribute("data-active-tool", "frame"); await expect(more).toBeFocused();
  await more.click(); await page.mouse.click(50, 200); await expect(page.getByRole("menu")).toHaveCount(0);
  await page.getByRole("button", { name: "Collapse tool dock", exact: true }).click(); await expect(page.getByRole("button", { name: "Show tool dock", exact: true })).toBeFocused();
  await expect(page.getByRole("group", { name: "Viewport controls" })).toBeVisible(); await expect(page.getByRole("group", { name: "History controls" })).toBeVisible(); await controlsFit(page);
  await page.getByRole("button", { name: "Show tool dock", exact: true }).click(); await expect(page.getByRole("button", { name: "Select tool", exact: true })).toBeFocused();
});

test("viewer toolbar skips disabled tools and keeps navigation available", async ({ page }) => {
  const board = savedBoard(firstId, "Viewer page", []); board.role = "viewer"; board.document!.role = "viewer";
  await mockAccount(page, [board]); await page.goto("/scribble/"); await expect(page.getByLabel("Page title")).toBeDisabled();
  await page.getByRole("button", { name: "Select tool", exact: true }).focus(); await page.keyboard.press("ArrowRight"); await expect(page.getByRole("button", { name: "Hand tool", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight"); await expect(page.getByRole("button", { name: "Select tool", exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("button", { name: "More tools", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: "Hand tool" })).toBeFocused(); await page.keyboard.press("ArrowDown"); await expect(page.getByRole("menuitemradio", { name: "Hand tool" })).toBeFocused();
  await page.keyboard.press("Escape"); await controlsFit(page);
});

test("text editing and IME rename retain work in reduced keyboard viewports", async ({ page }) => {
  const board = savedBoard(firstId, "IME page", []); await mockAccount(page, [board]);
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/scribble/"); await expect(page.getByLabel("Page title")).toBeEnabled();
  await page.getByRole("button", { name: "Text tool", exact: true }).click(); await page.mouse.click(120, 270);
  const input = page.getByRole("textbox", { name: "Edit text", exact: true }); await input.fill("Mobile text");
  await page.setViewportSize({ width: 390, height: 420 }); await expect(input).toBeInViewport(); await expect(page.locator(".workspace-title-controls")).toBeHidden(); await expect(page.locator(".zoom-dock")).toBeHidden();
  await input.fill("Keyboard viewport retained text"); await page.keyboard.press("Escape"); await page.setViewportSize({ width: 390, height: 844 }); await expect(page.locator(".workspace-title-controls")).toBeVisible();
  await browse(page); await page.getByRole("button", { name: "Actions for IME page", exact: true }).click(); await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const title = page.getByRole("textbox", { name: "Rename IME page", exact: true }); await title.dispatchEvent("compositionstart"); await title.fill("例のページ");
  await title.dispatchEvent("keydown", { key: "Enter", isComposing: true }); await expect(title).toBeVisible(); await title.dispatchEvent("compositionend"); await title.press("Enter"); await closeDialogs(page);
  await expect(page.getByLabel("Page title")).toHaveValue("例のページ"); await expect(page.getByText("Keyboard viewport retained text", { exact: true })).toBeVisible();
});

test("drawer and sharing stay inside the visual viewport when a keyboard pans the page", async ({ page }) => {
  const board = savedBoard(firstId, "Keyboard page", []); await mockAccount(page, [board]);
  await page.route(`**/api/boards/${firstId}/sharing`, (route) => route.fulfill({ json: { members: [], invitations: [] } }));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/scribble/"); await expect(page.getByLabel("Page title")).toBeEnabled();
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, { height: { configurable: true, value: 380 }, offsetTop: { configurable: true, value: 120 } }); window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  for (const label of ["Pages", "Link settings"]) {
    if (label === "Pages") await page.getByRole("button", { name: label, exact: true }).click();
    else { await page.getByRole("button", { name: "App menu", exact: true }).click(); await page.getByRole("menuitem", { name: label, exact: true }).click(); }
    const dialog = page.locator("dialog[open]"); const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(120); expect(box.y + box.height).toBeLessThanOrEqual(500);
    for (let i = 0; i < 10; i++) { await page.keyboard.press("Tab"); expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true); }
    await page.screenshot({ path: `workspace-ux-evidence/m11-keyboard-${label.toLowerCase().replaceAll(" ", "-")}.png` }); await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: label === "Pages" ? label : "App menu", exact: true })).toBeFocused();
  }
});

test("mobile object appearance replaces the action row in short landscape and restores Style focus", async ({ page }) => {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  await page.setViewportSize({ width: 740, height: 390 }); await page.goto("/scribble/"); await expect(page.getByLabel("Drawing title")).toBeEnabled();
  await page.getByRole("button", { name: "Text tool", exact: true }).click(); await page.mouse.click(320, 170);
  await page.getByLabel("Edit text", { exact: true }).fill("Landscape appearance"); await page.keyboard.press("Escape");
  const before = await canvasState(page); const style = page.getByRole("button", { name: "Style", exact: true }); await style.click();
  await expect(page.locator(".mobile-selection-actions")).toBeHidden(); await controlsFit(page);
  await page.getByRole("button", { name: "Collapse settings", exact: true }).click();
  await page.getByRole("button", { name: "Expand settings", exact: true }).click();
  await page.getByRole("button", { name: "Red", exact: true }).focus(); await page.keyboard.press("Escape");
  await expect(style).toBeFocused(); expect((await canvasState(page)).objects).toEqual(before.objects); expect((await canvasState(page)).past.length).toBe(before.past.length); await controlsFit(page);
});

test("a pending save notice and expanded mobile settings reserve separate space", async ({ page }) => {
  const board = savedBoard(firstId, "Pending mobile page", []), cloud = await mockAccount(page, [board]);
  await page.setViewportSize({ width: 320, height: 700 }); await page.goto("/scribble/"); await expect(page.getByLabel("Page title")).toBeEnabled();
  cloud.failSaves = true;
  await page.getByRole("button", { name: "Pen tool", exact: true }).click(); await page.mouse.move(100, 220); await page.mouse.down(); await page.mouse.move(200, 230, { steps: 5 }); await page.mouse.up();
  await expect(page.locator(".board-notice")).toBeVisible({ timeout: 20000 }); await page.getByRole("button", { name: "Expand settings", exact: true }).click(); await controlsFit(page);
  const message = (await page.locator(".board-notice").boundingBox())!, panel = (await page.locator(".tool-options").boundingBox())!;
  expect(panel.y).toBeGreaterThan(message.y + message.height); await page.screenshot({ path: "workspace-ux-evidence/m11-pending-mobile.png" });
});

test("device write failure stays below measured chrome and retries the existing queue", async ({ page }) => {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  await page.setViewportSize({ width: 320, height: 700 }); await page.goto("/scribble/"); await expect(page.getByLabel("Drawing title")).toBeEnabled();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put; (window as any).restoreFixtureStorage = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "boards") throw new DOMException("Disposable quota failure", "QuotaExceededError"); return put.apply(this, args);
    };
  });
  await page.getByLabel("Drawing title").fill("Retained through failure"); await page.getByLabel("Drawing title").press("Enter");
  await expect(page.locator(".board-notice")).toContainText("Couldn’t save on this device"); await controlsFit(page);
  await details(page); await expect(page.getByText("Current draft could not be saved", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).restoreFixtureStorage()); await page.getByRole("button", { name: "Retry device save", exact: true }).click(); await expect(page.getByText("Current draft saved", { exact: true })).toBeVisible();
  await closeDialogs(page); await page.reload(); await expect(page.getByLabel("Drawing title")).toHaveValue("Retained through failure"); expect(cloud.mutations).toHaveLength(0);
});

test("theme text, active tools, boundaries and focus retain readable contrast", async ({ page }) => {
  const cloud = await mockAccount(page); cloud.signedIn = false; await page.goto("/scribble/"); await expect(page.getByLabel("Drawing title")).toBeEnabled();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const ratios = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const rgb = (value: string) => value.startsWith("#") ? [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) : value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const luminance = (value: string) => rgb(value).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((total, v, i) => total + v * [.2126, .7152, .0722][i], 0);
      const ratio = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const token = (name: string) => css.getPropertyValue(name).trim(), surface = token("--surface");
      return { text: ratio(token("--text-secondary"), surface), active: ratio(token("--accent-ink"), token("--accent")), field: ratio(token("--control-border"), surface), focus: ratio(token("--accent"), surface) };
    });
    expect(ratios.text).toBeGreaterThanOrEqual(4.5); expect(ratios.active).toBeGreaterThanOrEqual(4.5); expect(ratios.field).toBeGreaterThanOrEqual(3); expect(ratios.focus).toBeGreaterThanOrEqual(3);
  }
});

test("mobile safe areas and equivalent 200% layout keep chrome and dialogs reachable", async ({ page, browser }) => {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/scribble/"); await expect(page.getByLabel("Drawing title")).toBeEnabled();
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 24, bottom: 34, left: 18, right: 18 } });
  await controlsFit(page);
  expect((await page.locator(".workspace-title-controls").boundingBox())!.y).toBeGreaterThanOrEqual(24);
  const zoom = (await page.locator(".zoom-dock").boundingBox())!; expect(zoom.y + zoom.height).toBeLessThanOrEqual(844 - 34);
  await page.getByRole("button", { name: "Pen tool", exact: true }).click(); await page.getByRole("button", { name: "Expand settings", exact: true }).click(); await controlsFit(page);
  await page.screenshot({ path: "workspace-ux-evidence/m11-safe-area.png" });
  // Half the CSS viewport and twice the density models 200% layout, not browser chrome zoom.
  const context = await browser.newContext({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
  try {
    const zoomPage = await context.newPage(); await mockAccount(zoomPage, [savedBoard(firstId, "Zoomed page", [])]);
    await zoomPage.goto("/scribble/"); await expect(zoomPage.getByLabel("Page title")).toBeEnabled(); await controlsFit(zoomPage);
    await browse(zoomPage); await expect(zoomPage.getByRole("dialog", { name: "Pages", exact: true })).toBeInViewport(); await closeDialogs(zoomPage);
    await zoomPage.getByRole("button", { name: "App menu", exact: true }).click(); await zoomPage.getByRole("menuitem", { name: "Help and shortcuts" }).click();
    await expect(zoomPage.getByRole("button", { name: "Close Help and shortcuts" })).toBeInViewport(); await closeDialogs(zoomPage);
    await zoomPage.screenshot({ path: "workspace-ux-evidence/m11-zoom-layout.png" });
  } finally { await context.close(); }
});

test("sidebar and resized chrome preserve world coordinates, drag/resize, pen and atomic history", async ({ page }) => {
  await mockAccount(page, [savedBoard(firstId, "Coordinate page", [])]); await page.goto("/scribble/"); await expect(page.getByLabel("Page title")).toBeEnabled();
  await page.evaluate(async () => (await import(/* @vite-ignore */ "/scribble/src/store/viewportStore.ts")).useViewportStore.getState().setViewport({ x: 120, y: -90, zoom: 1.5 }));
  const before = await canvasState(page), bounds = await page.locator(".canvas-viewport").boundingBox();
  await page.getByRole("button", { name: "Pages", exact: true }).click(); await expect(page.locator(".page-sidebar")).toHaveCount(0);
  expect((await canvasState(page)).viewport).toEqual(before.viewport); expect(await page.locator(".canvas-viewport").boundingBox()).toEqual(bounds);
  await page.getByRole("button", { name: "Pages", exact: true }).click();
  await page.getByRole("button", { name: "Close page sidebar", exact: true }).focus(); await page.keyboard.press("Escape");
  await expect(page.locator(".page-sidebar")).toHaveCount(0); await expect(page.getByRole("button", { name: "Pages", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Note tool", exact: true }).click(); await page.mouse.click(450, 360); await page.getByLabel("Card title", { exact: true }).fill("Coordinate note"); await page.keyboard.press("Escape");
  const created = await canvasState(page), card = Object.values(created.objects)[0];
  if (card.type !== "card") throw new Error("Expected a card");
  expect((card.x + card.width / 2) * 1.5 + 120).toBeCloseTo(450); expect((card.y + 32) * 1.5 - 90).toBeCloseTo(360);
  const box = (await page.locator(".canvas-object--card").boundingBox())!;
  await page.mouse.move(box.x + 25, box.y + 25); await page.mouse.down(); await page.mouse.move(box.x + 85, box.y + 70); await page.mouse.up();
  const dragged = await canvasState(page), draggedCard = dragged.objects[card.id];
  if (draggedCard.type !== "card") throw new Error("Expected a card");
  expect(draggedCard.x).toBeCloseTo(card.x + 40); expect(draggedCard.y).toBeCloseTo(card.y + 30); expect(dragged.past.length).toBe(created.past.length + 1);
  const handle = page.locator(".resize-handle--corner"), resize = (await handle.boundingBox())!;
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2); await page.mouse.down(); await page.mouse.move(resize.x + resize.width / 2 + 60, resize.y + resize.height / 2 + 45); await page.mouse.up();
  const resized = await canvasState(page), resizedCard = resized.objects[card.id];
  if (resizedCard.type !== "card") throw new Error("Expected a card");
  expect(resizedCard.width).toBeCloseTo(card.width + 40); expect(resized.past.length).toBe(dragged.past.length + 1);
  await page.getByRole("button", { name: /^Undo / }).click(); expect((await canvasState(page)).objects).toEqual(dragged.objects);
  await page.getByRole("button", { name: /^Redo / }).click(); expect((await canvasState(page)).objects).toEqual(resized.objects);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click(); await expect(page.getByLabel("Current zoom")).toHaveText("180%");
  await page.getByRole("button", { name: "Pen tool", exact: true }).click(); const inkViewport = (await canvasState(page)).viewport;
  await page.mouse.move(750, 350); await page.mouse.down(); await page.mouse.move(900, 380, { steps: 12 }); await page.mouse.up();
  const ink = await canvasState(page), stroke = Object.values(ink.objects).find((object) => object.type === "stroke")!;
  if (stroke.type !== "stroke") throw new Error("Expected a stroke");
  expect(stroke.points[0].x * inkViewport.zoom + inkViewport.x).toBeCloseTo(750); expect(stroke.points.at(-1)!.x * inkViewport.zoom + inkViewport.x).toBeCloseTo(900); expect(ink.past.length).toBe(resized.past.length + 1);
  const width = (await page.locator(".canvas-viewport").boundingBox())!.width;
  await page.setViewportSize({ width: 1024, height: 768 }); await expect.poll(async () => (await canvasState(page)).viewport.x).toBeCloseTo(inkViewport.x + (1024 - width) / 2);
  expect((await canvasState(page)).objects).toEqual(ink.objects); expect((await canvasState(page)).past.length).toBe(ink.past.length); await controlsFit(page);
});
