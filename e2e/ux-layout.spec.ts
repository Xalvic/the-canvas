import { expect, test, type Page } from "@playwright/test";
import { firstId, savedBoard, mockAccount, openBoard, editNote } from "./fixtures/account";
import { browse, closeDialogs, accountMenu, details } from "./fixtures/ui";

async function controlsFit(page: Page) {
  const result = await page.locator(".board-header").evaluate((header) => {
    const rects = [...header.querySelectorAll<HTMLElement>(":scope > button, :scope > .brand-mark, :scope > .account-trigger, :scope > .collaboration-summary")].filter((element) => element.getBoundingClientRect().width > 0).map((element) => ({ name: element.textContent, rect: element.getBoundingClientRect() }));
    const overlaps = rects.flatMap((a, i) => rects.slice(i + 1).filter((b) => Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 1 && Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 1).map((b) => `${a.name}/${b.name}`));
    const notice = document.querySelector(".board-notice")?.getBoundingClientRect();
    return { overlaps, outside: rects.filter(({ rect }) => rect.left < 0 || rect.right > innerWidth + 1).map(({ name }) => name), overflow: document.documentElement.scrollWidth > innerWidth,
      noticeOverlapsHeader: !!notice && notice.top < header.getBoundingClientRect().bottom };
  });
  expect(result).toEqual({ overlaps: [], outside: [], overflow: false, noticeOverlapsHeader: false });
}

test("desktop/mobile, long titles, light/dark, landscape and zoom keep the header and dialogs reachable", async ({ page, browser }) => {
  const board = savedBoard(firstId, "A very long example board title for checking a narrow workspace and account controls");
  const cloud = await mockAccount(page, [board]);
  await page.route(`**/api/boards/${firstId}/sharing`, (route) => route.fulfill({ json: { members: [], invitations: [] } }));
  cloud.signedIn = false;
  await page.goto("/scribble/");
  await expect(page.getByLabel("Board title", { exact: true })).toBeEnabled();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [320, 360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await controlsFit(page);
      if (theme === "light" && (width === 390 || width === 1440)) {
        await expect(page.locator(".save-status")).toHaveText("Saved on this device");
        await page.screenshot({ path: `docs/ux-evidence/after-guest-${width}.png` });
      }
      await browse(page);
      await expect(page.getByRole("dialog", { name: "Your boards", exact: true })).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Boards", exact: true })).toBeFocused();
    }
  }
  cloud.signedIn = true;
  await page.reload();
  await openBoard(page, board.title);
  // Presentation fixture only; actual SSE and identities are covered by integration.
  await page.evaluate(async () => {
    const { useCollaborationStore } = await import(/* @vite-ignore */ "/scribble/src/store/collaborationStore.ts");
    useCollaborationStore.setState({ status: "connected", participants: [{ clientId: "layout-peer", userId: "fixture-peer", displayName: "Layout collaborator", cursor: null, selectedIds: [] }] });
  });
  for (const width of [320, 360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await controlsFit(page);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(page.getByRole("dialog", { name: `Share ${board.title}`, exact: true })).toBeInViewport();
    await closeDialogs(page);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".save-status")).toHaveText("Saved to account");
  await page.screenshot({ path: "docs/ux-evidence/after-account-desktop.png" });
  cloud.conflictOnNextSave = true;
  await editNote(page, board.title, "Disposable conflict");
  await expect(page.locator(".save-status")).toHaveText("This board changed elsewhere");
  await page.setViewportSize({ width: 390, height: 844 });
  await controlsFit(page);
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeEnabled();
  // Allow responsive text paint to settle after the viewport change.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: "docs/ux-evidence/after-recovery-mobile.png" });
  await details(page);
  await expect(page.getByText("Current draft saved", { exact: true })).toBeVisible();
  await page.screenshot({ path: "docs/ux-evidence/after-recovery-dialog.png" });
  await closeDialogs(page);
  await page.setViewportSize({ width: 844, height: 390 });
  await controlsFit(page);
  await details(page);
  await expect(page.getByRole("button", { name: "Close Save details", exact: true })).toBeInViewport();
  await closeDialogs(page);
  // Equivalent 200% layout: half the CSS viewport, twice the raster density.
  // Actual browser chrome zoom and hardware keyboards remain human checks.
  const zoomContext = await browser.newContext({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
  try {
    const zoom = await zoomContext.newPage();
    await mockAccount(zoom);
    await zoom.goto("/scribble/");
    await controlsFit(zoom);
    await accountMenu(zoom);
    await expect(zoom.getByRole("button", { name: "Close Your account", exact: true })).toBeInViewport();
    await zoom.getByRole("button", { name: "Help and shortcuts", exact: true }).click();
    await expect(zoom.getByRole("dialog", { name: "Help and shortcuts", exact: true })).toBeVisible();
    await zoom.keyboard.press("Escape");
    await expect(zoom.getByRole("button", { name: "Help and shortcuts", exact: true })).toBeFocused();
    await zoom.screenshot({ path: "docs/ux-evidence/after-zoom-layout.png" });
    await closeDialogs(zoom);
  } finally { await zoomContext.close(); }
});

test("real device write failure has a truthful notice and targeted retry uses the existing save queue", async ({ page }) => {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  await page.goto("/scribble/");
  await expect(page.getByLabel("Board title", { exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restoreFixtureStorage = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (this.name === "boards") throw new DOMException("Disposable quota failure", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await page.getByLabel("Board title", { exact: true }).fill("Retained through failure");
  await expect(page.locator(".save-status")).toHaveText("Couldn’t save on this device");
  await details(page);
  await expect(page.getByText("Current draft could not be saved", { exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).restoreFixtureStorage());
  await page.getByRole("button", { name: "Retry device save", exact: true }).click();
  await expect(page.getByText("Current draft saved", { exact: true })).toBeVisible();
  await closeDialogs(page);
  await page.reload();
  await expect(page.getByLabel("Board title", { exact: true })).toHaveValue("Retained through failure");
  expect(cloud.mutations).toHaveLength(0);
});

test("modal keyboard trapping, IME input, contrast and a reduced mobile keyboard viewport", async ({ page }) => {
  const cloud = await mockAccount(page); cloud.signedIn = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/scribble/");
  await expect(page.getByLabel("Board title", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Text tool", exact: true }).click();
  await page.mouse.click(120, 270);
  const input = page.getByRole("textbox", { name: "Edit text", exact: true });
  await input.fill("Mobile text");
  await page.setViewportSize({ width: 390, height: 420 });
  await expect(input).toBeInViewport();
  await expect(page.locator(".board-header")).toBeHidden();
  await input.fill("Keyboard viewport retained text");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".board-header")).toBeVisible();
  await browse(page);
  const modal = page.getByRole("dialog", { name: "Your boards", exact: true });
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await modal.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  }
  await closeDialogs(page);
  await page.getByRole("button", { name: "Save to account", exact: true }).click();
  await page.getByRole("button", { name: "Continue to sign in", exact: true }).click();
  const account = page.getByRole("dialog", { name: "Your account", exact: true });
  await expect(account).toContainText("Keep drawing as a guest");
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await account.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
  }
  // Compute contrast for new normal text, primary labels and form/focus boundaries.
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    const ratios = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const rgb = (value: string) => value.startsWith("#") ? [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) : value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const luminance = (value: string) => rgb(value).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((total, v, i) => total + v * [.2126, .7152, .0722][i], 0);
      const ratio = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const surface = css.getPropertyValue("--surface").trim();
      return { text: ratio(css.getPropertyValue("--text-secondary").trim(), surface), primary: ratio("#ffffff", "#5146df"), field: ratio(css.getPropertyValue("--control-border").trim(), surface), focus: ratio(css.getPropertyValue("--accent").trim(), surface) };
    });
    expect(ratios.text).toBeGreaterThanOrEqual(4.5);
    expect(ratios.primary).toBeGreaterThanOrEqual(4.5);
    expect(ratios.field).toBeGreaterThanOrEqual(3);
    expect(ratios.focus).toBeGreaterThanOrEqual(3);
  }
  await closeDialogs(page);
  cloud.signedIn = true; await page.reload();
  await browse(page);
  await page.getByRole("button", { name: "New account board", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Your boards", exact: true })).toBeHidden();
  await browse(page);
  await page.getByRole("button", { name: "Actions for Untitled board", exact: true }).click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  const title = page.getByLabel("New board title", { exact: true });
  await title.dispatchEvent("compositionstart");
  await title.fill("例のボード");
  await title.dispatchEvent("compositionend");
  await expect(title).toBeFocused();
  await page.getByRole("button", { name: "Save title", exact: true }).click();
  await expect(page.getByLabel("Board title", { exact: true })).toHaveValue("例のボード");
});
