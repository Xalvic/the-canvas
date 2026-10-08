import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, json: {
    error: { code: "UNAUTHENTICATED", details: { googleSignInEnabled: true } },
  } }));
});

test("legacy board styles stay independent of saved tool preferences, including zero opacity", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Drawing title")).toBeEnabled();
  await page.evaluate(async () => {
    const storePath = "/scribble/src/store/documentStore.ts";
    const preferencePath = "/scribble/src/store/toolPreferencesStore.ts";
    const { useDocumentStore } = await import(/* @vite-ignore */ storePath);
    const { useToolPreferencesStore } = await import(
      /* @vite-ignore */ preferencePath
    );
    useToolPreferencesStore.getState().setText({ opacity: 0 });
    useToolPreferencesStore.getState().setPen({ opacity: 0 });
    useDocumentStore.getState().loadDocument({
      "old-text": {
        id: "old-text",
        type: "text",
        text: "Legacy text",
        x: -470,
        y: 90,
        width: 220,
        height: 52,
        zIndex: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      "old-stroke": {
        id: "old-stroke",
        type: "stroke",
        points: [
          { x: -500, y: 230, pressure: 0.2 },
          { x: -280, y: 230, pressure: 1 },
        ],
        strokeWidth: 4,
        color: "#3f413d",
        x: -502,
        y: 228,
        width: 224,
        height: 4,
        zIndex: 2,
        createdAt: 1,
        updatedAt: 1,
      },
      "points-only": {
        id: "points-only",
        type: "stroke",
        points: [
          { x: -500, y: 280 },
          { x: -280, y: 280 },
        ],
        strokeWidth: 4,
        color: "#3f413d",
        x: -502,
        y: 278,
        width: 224,
        height: 4,
        zIndex: 3,
        createdAt: 1,
        updatedAt: 1,
      },
    });
  });
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.getByLabel("Drawing title")).toBeEnabled();
  await expect(page.locator(".stroke-shape")).toHaveCount(2);
  await expect(page.locator(".text-object-value")).toHaveCSS("opacity", "1");
  await expect(page.locator(".text-object-value")).toHaveCSS(
    "font-weight",
    "550",
  );
  await page.locator(".text-object-value").click();
  await page
    .getByRole("button", { name: "Edit appearance", exact: true })
    .click();
  await expect(page.getByRole("slider", { name: "Opacity" })).toHaveValue(
    "100",
  );
  await page.getByRole("slider", { name: "Opacity" }).focus();
  await page.keyboard.press("Home");
  await expect(page.locator(".text-object-value")).toHaveCSS("opacity", "0");
  await page
    .getByRole("button", { name: "Undo Change opacity", exact: true })
    .click();
  await expect(page.locator(".text-object-value")).toHaveCSS("opacity", "1");
  await page.getByRole("button", { name: "Close appearance" }).click();
  const strokeBox = (await page
    .locator('[data-stroke-object-id="old-stroke"] .stroke-shape')
    .boundingBox())!;
  await page.mouse.click(
    strokeBox.x + strokeBox.width / 2,
    strokeBox.y + strokeBox.height / 2,
  );
  await page
    .getByRole("button", { name: "Edit appearance", exact: true })
    .click();
  await expect(page.getByRole("slider", { name: "Opacity" })).toHaveValue(
    "100",
  );
  await page.getByRole("slider", { name: "Opacity" }).focus();
  await page.keyboard.press("Home");
  await expect(
    page.locator('[data-stroke-object-id="old-stroke"] .stroke-shape'),
  ).toHaveAttribute("opacity", "0");
  await page.getByRole("button", { name: "Close appearance" }).click();
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.getByLabel("Drawing title")).toBeEnabled();
  await expect(
    page.locator('[data-stroke-object-id="old-stroke"] .stroke-shape'),
  ).toHaveAttribute("opacity", "0");
  await expect(
    page.locator('[data-stroke-object-id="points-only"] .stroke-shape'),
  ).not.toHaveAttribute("d", /NaN|undefined/);
});

test("shows actual storage failures and cancels unfinished creation without history", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Drawing title")).toBeEnabled();
  await page.getByRole("button", { name: "Frame tool", exact: true }).click();
  await page.mouse.move(150, 500);
  await page.mouse.down();
  await page.mouse.move(400, 750);
  await page
    .locator(".canvas-viewport")
    .dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" });
  await page.mouse.up();
  await expect(page.locator(".canvas-object--frame")).toHaveCount(0);
  await expect(page.locator(".canvas-viewport")).toHaveAttribute(
    "data-active-tool",
    "frame",
  );
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException("Storage full", "QuotaExceededError");
    };
  });
  await page.getByLabel("Drawing title").fill("Changed title");
  await page.getByLabel("Drawing title").press("Enter");
  await expect(page.locator(".save-status")).toHaveCount(0);
  await expect(page.locator(".board-notice")).toContainText("Couldn’t save on this device");
});
