import { expect, test, type Page } from "@playwright/test";
import { mockAccount } from "./fixtures/account";

test.beforeEach(async ({ page }) => { const cloud = await mockAccount(page); cloud.signedIn = false; });

async function openMobile(page: Page, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.getByLabel("Drawing title")).toBeEnabled();
}

async function tap(
  page: Page,
  points: Array<{ x: number; y: number; id?: number }>,
) {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points,
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

test("mobile dock, settings tray, and persisted themes fit narrow screens", async ({
  page,
}) => {
  await openMobile(page, 320, 700);

  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/scribble/favicon.svg",
  );
  await expect(page.locator(".brand-symbol")).toHaveAttribute(
    "src",
    "/scribble/favicon.svg",
  );

  const dock = page.locator(".mobile-tool-dock");
  await expect(dock).toBeVisible();
  const dockBox = (await dock.boundingBox())!;
  expect(dockBox.x).toBeGreaterThanOrEqual(0);
  expect(dockBox.x + dockBox.width).toBeLessThanOrEqual(320);

  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
  const settings = page.getByRole("region", { name: "Pen settings" });
  await expect(settings).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Expand settings", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Expand settings", exact: true })
    .click();
  const settingsBox = (await settings.boundingBox())!;
  expect(settingsBox.x).toBeGreaterThanOrEqual(0);
  expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(320);
  expect(settingsBox.height).toBeLessThanOrEqual(340);
  await page.getByRole("button", { name: "Red", exact: true }).click();
  await page.getByRole("button", { name: "Large", exact: true }).click();
  await page
    .getByRole("button", { name: "Collapse settings", exact: true })
    .click();

  await page.getByRole("button", { name: "App menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(() => localStorage.getItem("scribble:theme")),
  ).toBe("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page
    .getByRole("button", { name: "Collapse tool dock", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Show tool dock", exact: true }),
  ).toBeVisible();
});

test("phone and tablet breakpoints keep controls reachable", async ({ page }) => {
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.getByLabel("Drawing title")).toBeEnabled();
    const dockBox = (await page.locator(".mobile-tool-dock").boundingBox())!;
    expect(dockBox.x).toBeGreaterThanOrEqual(0);
    expect(dockBox.x + dockBox.width).toBeLessThanOrEqual(width);
    expect(dockBox.height).toBeGreaterThanOrEqual(52);
  }

  for (const size of [
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(size);
    const dock = page.locator(".desktop-tool-dock");
    await expect(dock).toBeVisible();
    const dockBox = (await dock.boundingBox())!;
    expect(dockBox.x).toBeGreaterThanOrEqual(0);
    expect(dockBox.x + dockBox.width).toBeLessThanOrEqual(size.width);
    expect(dockBox.height).toBeGreaterThanOrEqual(48);
  }
});

test("light is the default and replaces the retired system preference", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("scribble:theme", "system"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(
    await page.evaluate(() => localStorage.getItem("scribble:theme")),
  ).toBe("light");
  await page.getByRole("button", { name: "App menu", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Dark theme", exact: true })).toBeVisible();
});

test("touch select pans empty space, drags objects, pinches, and multi-selects", async ({
  page,
}) => {
  await openMobile(page);
  const client = await page.context().newCDPSession(page);

  await page.getByRole("button", { name: "Note tool", exact: true }).click();
  await page.mouse.click(155, 280);
  await page.keyboard.press("Escape");
  const first = page.locator(".canvas-object--card").first();
  const firstBox = (await first.boundingBox())!;
  const leftBefore = await first.evaluate((element) =>
    Number.parseFloat((element as HTMLElement).style.left),
  );

  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { id: 1, x: firstBox.x + 30, y: firstBox.y + 30 },
    ],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { id: 1, x: firstBox.x + 72, y: firstBox.y + 58 },
    ],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() =>
      first.evaluate((element) =>
        Number.parseFloat((element as HTMLElement).style.left),
      ),
    )
    .toBeGreaterThan(leftBefore + 35);

  await tap(page, [{ id: 2, x: 28, y: 590 }]);
  await expect(page.locator(".canvas-object.is-selected")).toHaveCount(0);

  const transformBeforePan = await page
    .locator(".world-layer")
    .evaluate((element) => (element as HTMLElement).style.transform);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 20, x: 360, y: 610 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ id: 20, x: 325, y: 565 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() =>
      page
        .locator(".world-layer")
        .evaluate((element) => (element as HTMLElement).style.transform),
    )
    .not.toBe(transformBeforePan);

  const transformBefore = await page
    .locator(".world-layer")
    .evaluate((element) => (element as HTMLElement).style.transform);
  const objectLeftBeforePinch = await first.evaluate(
    (element) => (element as HTMLElement).style.left,
  );
  const movedBox = (await first.boundingBox())!;
  const firstTouch = {
    id: 3,
    x: movedBox.x + 30,
    y: movedBox.y + 30,
  };
  const secondTouch = { id: 4, x: 320, y: 520 };
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [firstTouch],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [firstTouch, secondTouch],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { ...firstTouch, x: firstTouch.x - 25, y: firstTouch.y - 15 },
      { ...secondTouch, x: secondTouch.x + 28, y: secondTouch.y + 20 },
    ],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() =>
      page
        .locator(".world-layer")
        .evaluate((element) => (element as HTMLElement).style.transform),
    )
    .not.toBe(transformBefore);
  expect(
    await first.evaluate((element) => (element as HTMLElement).style.left),
  ).toBe(objectLeftBeforePinch);

  await page.getByRole("button", { name: "Note tool", exact: true }).click();
  await page.mouse.click(34, 610);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Multi-select", exact: true })
    .click();
  const firstAfterPinch = (await first.boundingBox())!;
  await tap(page, [
    {
      id: 5,
      x: firstAfterPinch.x + firstAfterPinch.width / 2,
      y: firstAfterPinch.y + firstAfterPinch.height / 2,
    },
  ]);
  await expect(page.locator(".canvas-object.is-selected")).toHaveCount(2);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".canvas-object")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Undo Delete selection", exact: true })
    .click();
  await expect(page.locator(".canvas-object")).toHaveCount(2);
});

test("mobile text creation and contextual editing keep canvas gestures out of the editor", async ({
  page,
}) => {
  await openMobile(page, 375, 812);
  await page.getByRole("button", { name: "Text tool", exact: true }).click();
  await page.mouse.click(180, 300);
  const editor = page.getByRole("textbox", { name: "Edit text", exact: true });
  await editor.fill("Mobile text");
  await page.keyboard.press("Escape");
  await expect(page.getByText("Mobile text", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(editor).toBeFocused();
  await editor.fill("Mobile text updated");
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("Mobile text updated", { exact: true }),
  ).toBeVisible();
});
