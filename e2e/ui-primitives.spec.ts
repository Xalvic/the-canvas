import { expect, test, type Locator } from "@playwright/test";
import { firstId, savedBoard, mockAccount } from "./fixtures/account";
import { linkSettings, mockShareLinks } from "./fixtures/shareLinks";

// Inspect rendered controls, including hover/focus and nested surfaces, rather than token values.
async function contrast(element: Locator, kind: "text" | "border" | "focus" = "text") {
  return element.evaluate((node, kind) => {
    const rgb = (value: string) => value.match(/[\d.]+/g)!.map(Number);
    const over = (paint: number[], base: number[]) => paint.slice(0, 3).map((v, i) => v * (paint[3] ?? 1) + base[i] * (1 - (paint[3] ?? 1)));
    const ancestors: Element[] = [];
    for (let current: Element | null = node; current; current = current.parentElement) ancestors.unshift(current);
    const background = ancestors.reduce((base, current) => over(rgb(getComputedStyle(current).backgroundColor), base), [255, 255, 255]);
    const style = getComputedStyle(node);
    const foreground = over(rgb(kind === "focus" ? style.outlineColor : kind === "border" ? style.borderTopColor : style.color), background);
    const luminance = (color: number[]) => color.map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  }, kind);
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme} link settings keep contrast, native focus and error-only retries`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript((theme) => localStorage.setItem("scribble:theme", theme), theme);
    const cloud = await mockAccount(page, [savedBoard(firstId, "Visual foundation", [])]);
    const links = await mockShareLinks(page, cloud, firstId);
    await page.route(`**/api/boards/${firstId}/sharing`, (route) => route.fulfill({ json: { members: [], invitations: [] } }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/scribble/");
    await expect(page.getByLabel("Page title")).toBeEnabled();
    const share = page.getByRole("button", { name: "Share", exact: true });
    expect(await contrast(share)).toBeGreaterThanOrEqual(4.5);
    await share.hover();
    expect(await contrast(share)).toBeGreaterThanOrEqual(4.5);
    expect(await share.evaluate((button) => button.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
    await page.getByRole("button", { name: "App menu", exact: true }).click();
    await page.screenshot({ path: `ui-redesign-evidence/r1-menu-${theme}.png`, animations: "disabled" });
    await page.keyboard.press("Escape");
    const dialog = await linkSettings(page);
    const permission = dialog.getByRole("combobox", { name: "Link permission", exact: true });
    const submit = dialog.getByRole("button", { name: "Enable and copy link", exact: true });
    await expect(permission).toBeEnabled();
    await permission.focus(); await permission.press("Tab"); await page.keyboard.press("Shift+Tab");
    await expect(permission).toBeFocused();
    expect(await contrast(permission, "border")).toBeGreaterThanOrEqual(3);
    expect(await contrast(permission, "focus")).toBeGreaterThanOrEqual(3);
    expect(await contrast(dialog.locator(".dialog-footnote").first())).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(submit)).toBeGreaterThanOrEqual(4.5);
    await expect(dialog.locator('input[type="email"]')).toHaveCount(0);
    await page.screenshot({ path: `ui-redesign-evidence/r1-sharing-${theme}.png`, animations: "disabled" });
    await page.keyboard.press("Escape");
    links.failReads = true;
    // Start a new controller lifetime to exercise an initial failed settings read.
    await page.reload(); await expect(page.getByLabel("Page title")).toBeEnabled();
    await linkSettings(page);
    const alert = dialog.getByRole("alert");
    await expect(alert).toBeVisible();
    expect(await contrast(alert)).toBeGreaterThanOrEqual(4.5);
    const checkSharing = dialog.getByRole("button", { name: "Retry link settings", exact: true });
    await expect(checkSharing).toBeEnabled();
    await page.screenshot({ path: `ui-redesign-evidence/r1-sharing-error-${theme}.png`, animations: "disabled" });
    links.failReads = false;
    await checkSharing.click(); await expect(submit).toBeEnabled();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "App menu", exact: true })).toBeFocused();
  });
}
