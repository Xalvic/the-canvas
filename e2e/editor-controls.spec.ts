import { expect, test, type Locator, type Page } from "@playwright/test";
import { canvasState, firstId, localBoard, mockAccount, savedBoard } from "./fixtures/account";
import { accountMenu, closeDialogs, details } from "./fixtures/ui";

test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: "reduce" }); });

async function renderedContrast(element: Locator) {
  return element.evaluate((node) => {
    const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const over = (paint: number[], base: number[]) => paint.slice(0, 3).map((value, index) => value * (paint[3] ?? 1) + base[index] * (1 - (paint[3] ?? 1)));
    const ancestors: Element[] = [];
    for (let current: Element | null = node; current; current = current.parentElement) ancestors.unshift(current);
    const background = ancestors.reduce((base, current) => over(rgb(getComputedStyle(current).backgroundColor), base), [255, 255, 255]);
    const foreground = over(rgb(getComputedStyle(node).color), background);
    const luminance = (paint: number[]) => paint.map((value) => value / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  });
}

async function guest(page: Page, width = 390, height = 844) {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  await page.setViewportSize({ width, height });
  await page.goto("/scribble/");
  await expect(page.getByLabel("Drawing title")).toBeEnabled();
}

test("compact styles dismiss when drawing resumes and tool switches retain preferences and atomic ink", async ({ page }) => {
  await guest(page);
  const before = await canvasState(page);
  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
  await page.getByRole("button", { name: "Expand settings", exact: true }).click();
  await page.getByRole("button", { name: "Red", exact: true }).click();
  await page.getByRole("button", { name: "Large", exact: true }).click();
  expect((await canvasState(page)).past.length).toBe(before.past.length);
  await page.mouse.move(70, 240); await page.mouse.down();
  await page.mouse.move(210, 270, { steps: 12 }); await page.mouse.up();
  await expect(page.getByRole("button", { name: "Expand settings", exact: true })).toBeVisible();
  const ink = await canvasState(page);
  expect(Object.values(ink.objects)).toHaveLength(1);
  expect(Object.values(ink.objects)[0]).toMatchObject({ type: "stroke", color: "#dc4545" });
  expect(ink.past.length).toBe(before.past.length + 1);
  await page.getByRole("button", { name: "Text tool", exact: true }).click();
  await expect(page.getByRole("button", { name: "Expand settings", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
  await page.getByRole("button", { name: "Expand settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Red", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Large", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await page.getByRole("button", { name: /^Undo / }).click();
  expect(Object.values((await canvasState(page)).objects)).toHaveLength(0);
  await page.getByRole("button", { name: /^Redo / }).click();
  expect((await canvasState(page)).objects).toEqual(ink.objects);
  await expect.poll(async () => (await localBoard(page))?.objects).toEqual(ink.objects);
  await page.reload(); await expect(page.getByLabel("Drawing title")).toBeEnabled();
  expect((await canvasState(page)).objects).toEqual(ink.objects);
});

test("compact and short-view styles keep touch targets, scrolling and canvas coordinates", async ({ page }) => {
  await guest(page);
  for (const size of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 320, height: 320 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 844, height: 390 }, { width: 1440, height: 390 }]) {
    await page.setViewportSize(size);
    await expect.poll(async () => (await canvasState(page)).viewport).toEqual({ x: size.width / 2, y: size.height / 2, zoom: 1 });
    const before = await canvasState(page);
    await page.getByRole("button", { name: "Text tool", exact: true }).click();
    await expect(page.getByRole("button", { name: "Expand settings", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Expand settings", exact: true }).click();
    const panel = page.getByRole("region", { name: "Text settings", exact: true });
    const bounds = (await panel.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(size.width);
    expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(size.height);
    expect(await panel.locator(".color-swatch, .option-segments button").evaluateAll((buttons) => buttons.every((button) => {
      const rect = button.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44;
    }))).toBe(true);
    await panel.getByRole("slider", { name: "Opacity" }).focus();
    await expect(panel.getByRole("slider", { name: "Opacity" })).toBeInViewport();
    await expect(panel.getByRole("button", { name: "Close settings", exact: true })).toBeInViewport();
    expect((await canvasState(page)).viewport).toEqual(before.viewport);
    expect((await canvasState(page)).past.length).toBe(before.past.length);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Select tool", exact: true })).toBeFocused();
  }
});

test("zoom percentage menu resets the existing viewport and returns keyboard focus", async ({ page }) => {
  await guest(page, 1440, 900);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByLabel("Current zoom")).toHaveText("120%");
  const trigger = page.getByRole("button", { name: "Zoom options", exact: true });
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "Reset viewport" })).toBeFocused();
  await page.keyboard.press("n");
  await expect(page.locator(".canvas-viewport")).toHaveAttribute("data-active-tool", "select");
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  await trigger.click(); await page.keyboard.press("Enter");
  await expect(page.getByLabel("Current zoom")).toHaveText("100%"); await expect(trigger).toBeFocused();
  expect((await canvasState(page)).past.length).toBe(0);
  await page.setViewportSize({ width: 320, height: 390 });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Zoom options" });
  await expect(menu).toBeInViewport();
  await page.keyboard.press("End"); await page.keyboard.press("Enter");
  await expect(page.getByLabel("Current zoom")).toHaveText("120%");
});

test("visual viewport bounds dock, styles and focused controls above a simulated keyboard", async ({ page }) => {
  await guest(page);
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, { height: { configurable: true, value: 380 }, offsetTop: { configurable: true, value: 120 } });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
  await page.getByRole("button", { name: "Expand settings", exact: true }).click();
  for (const selector of [".mobile-tool-dock", ".history-controls", ".zoom-controls", ".tool-options"]) {
    const bounds = (await page.locator(selector).boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(120); expect(bounds.y + bounds.height).toBeLessThanOrEqual(500);
  }
  await page.getByRole("slider", { name: "Opacity" }).focus();
  const slider = (await page.getByRole("slider", { name: "Opacity" }).boundingBox())!;
  expect(slider.y).toBeGreaterThanOrEqual(120); expect(slider.y + slider.height).toBeLessThanOrEqual(500);
  await page.screenshot({ path: "ui-redesign-evidence/r3-keyboard-controls.png" });
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme} rendered editor controls and account primary action retain contrast`, async ({ page }) => {
    await page.addInitScript((theme) => localStorage.setItem("scribble:theme", theme), theme);
    await guest(page, 1440, 900);
    const pen = page.getByRole("button", { name: "Pen tool", exact: true });
    expect(await renderedContrast(pen)).toBeGreaterThanOrEqual(4.5);
    await pen.click(); expect(await renderedContrast(pen)).toBeGreaterThanOrEqual(4.5);
    await pen.hover(); expect(await renderedContrast(pen)).toBeGreaterThanOrEqual(4.5);
    expect(await renderedContrast(page.getByRole("button", { name: "Select tool", exact: true }))).toBeGreaterThanOrEqual(4.5);
    expect(await renderedContrast(page.getByRole("region", { name: "Pen settings" }).getByText("Thickness", { exact: true }))).toBeGreaterThanOrEqual(4.5);
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await page.getByRole("button", { name: "Note tool", exact: true }).click(); await page.mouse.click(400, 250);
    await page.getByLabel("Card title", { exact: true }).fill("Consent fixture"); await page.keyboard.press("Escape");
    await accountMenu(page);
    const signIn = page.getByRole("link", { name: "Sign in with Google", exact: true });
    expect(await renderedContrast(signIn)).toBeGreaterThanOrEqual(4.5);
    await signIn.hover(); expect(await renderedContrast(signIn)).toBeGreaterThanOrEqual(4.5);
  });

  test(`${theme} account consent, help, empty canvas and recovery retain clear actions`, async ({ page }) => {
    await page.addInitScript((theme) => localStorage.setItem("scribble:theme", theme), theme);
    await guest(page);
    await expect(page.locator(".empty-prompt")).toContainText("Start creating");
    await page.getByRole("button", { name: "Note tool", exact: true }).click(); await page.mouse.click(140, 250);
    await page.getByLabel("Card title", { exact: true }).fill("Retained source"); await page.keyboard.press("Escape");
    const before = await canvasState(page);
    await accountMenu(page);
    const account = page.getByRole("dialog", { name: "Your account", exact: true });
    await expect(account.getByRole("checkbox")).not.toBeChecked();
    await expect(account.getByRole("link", { name: "Sign in with Google" })).toBeInViewport();
    await page.screenshot({ path: `ui-redesign-evidence/r3-consent-${theme}.png` });
    await page.keyboard.press("Escape"); expect((await canvasState(page)).objects).toEqual(before.objects);
    await page.getByRole("button", { name: "App menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Help and shortcuts" }).click();
    await page.screenshot({ path: `ui-redesign-evidence/r3-help-${theme}.png` });
    await closeDialogs(page);
    await page.evaluate(async () => {
      const { waitForLocalBoardSave } = await import(/* @vite-ignore */ "/scribble/src/persistence/waitForLocalBoardSave.ts");
      await waitForLocalBoardSave(new AbortController().signal);
      (await import(/* @vite-ignore */ "/scribble/src/store/boardStore.ts")).useBoardStore.getState().markSaveError("Disposable R3 storage error");
    });
    await details(page);
    await expect(page.getByRole("dialog", { name: "Save details", exact: true }).getByRole("alert")).toContainText("Disposable R3 storage error");
    await expect(page.getByRole("button", { name: "Retry device save" })).toBeInViewport();
    await page.screenshot({ path: `ui-redesign-evidence/r3-recovery-${theme}.png` });
  });
}

test("desktop styles and quiet history stay beside the exposed canvas with the sidebar open", async ({ page }) => {
  await mockAccount(page, [savedBoard(firstId, "Editor controls", [])]);
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto("/scribble/");
  await expect(page.getByLabel("Page title")).toBeEnabled();
  await page.getByRole("button", { name: "Text tool", exact: true }).click();
  const panel = page.getByRole("region", { name: "Text settings", exact: true });
  await expect(panel.getByRole("button", { name: "Red", exact: true })).toBeVisible();
  const tools = (await page.locator(".desktop-tool-dock").boundingBox())!;
  const history = (await page.locator(".history-controls").boundingBox())!;
  const sidebar = (await page.locator(".page-sidebar").boundingBox())!;
  expect(history.y + history.height).toBeLessThanOrEqual(tools.y);
  expect(tools.x + tools.width / 2).toBeCloseTo(sidebar.width + (1440 - sidebar.width) / 2);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    await page.screenshot({ path: `ui-redesign-evidence/r3-text-desktop-${theme}.png` });
  }
});
