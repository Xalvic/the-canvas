import { test, expect, type Page } from "@playwright/test";

// Read the actual stores through Vite without adding a test API to the app.
async function snapshot(page: Page) {
  return page
    .evaluate(async () => {
      const path = "/scribble/src/store/documentStore.ts";
      const { useDocumentStore } = await import(/* @vite-ignore */ path);
      return useDocumentStore.getState();
    })
    .then(({ objects, past }) => ({
      objects: Object.values(objects) as any[],
      history: past.length,
    }));
}

async function mouseStroke(
  page: Page,
  y: number,
  slow: boolean,
  curved = false,
) {
  await page.mouse.move(160, y);
  await page.mouse.down();
  const steps = slow ? 35 : 14;
  for (let i = 1; i <= steps; i++) {
    if (slow) await page.waitForTimeout(25);
    const progress = i / steps;
    await page.mouse.move(
      160 + progress * 245,
      y + (curved ? 50 * Math.sin((progress * 35) / 8) : 0),
    );
  }
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Board title")).toBeEnabled();
});

test("one-shot Note, Text and Frame; continuous Pen; silent autosave; accessible icon toolbar", async ({
  page,
}) => {
  await expect(
    page.locator(".tool-button .tool-label, .tool-button kbd"),
  ).toHaveCount(0);
  await expect(page.locator(".board-save-status")).toHaveCount(0);
  await page.getByRole("button", { name: "Pen tool", exact: true }).focus();
  await expect(
    page.getByRole("tooltip", { name: "Pen P", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("region", { name: "Pen settings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Note tool", exact: true }).click();
  await page.mouse.click(250, 550);
  await expect(page.locator(".canvas-viewport")).toHaveAttribute(
    "data-active-tool",
    "select",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Text tool", exact: true }).click();
  await page.mouse.click(650, 560);
  await expect(page.locator(".canvas-viewport")).toHaveAttribute(
    "data-active-tool",
    "select",
  );
  await page
    .getByRole("textbox", { name: "Edit text", exact: true })
    .fill("A single text");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Frame tool", exact: true }).click();
  await page.mouse.move(120, 450);
  await page.mouse.down();
  await page.mouse.move(500, 800);
  await page.mouse.up();
  await expect(page.locator(".canvas-viewport")).toHaveAttribute(
    "data-active-tool",
    "select",
  );
  await expect(page.getByText("Moves contents", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator(".canvas-hint")).not.toContainText("Shift-click");
  const beforeMove = (await snapshot(page)).objects;
  const cardBefore = beforeMove.find((o) => o.type === "card");
  await page.mouse.move(170, 465);
  await page.mouse.down();
  await page.mouse.move(200, 490);
  await page.mouse.up();
  expect(
    (await snapshot(page)).objects.find((o) => o.type === "card").x,
  ).toBeCloseTo(cardBefore.x + 30);
  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
  await mouseStroke(page, 360, false);
  await expect(page.locator(".canvas-viewport")).toHaveAttribute(
    "data-active-tool",
    "pen",
  );
  await page.waitForTimeout(900);
  const saved = (await snapshot(page)).objects;
  await page.reload();
  await expect(page.getByLabel("Board title")).toBeEnabled();
  expect((await snapshot(page)).objects).toEqual(saved);
  await expect(page.locator(".tool-options")).toHaveCount(0);
});

test("Draw responds to real mouse velocity on lines and curves; Solid uses constant width", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
  await page.getByRole("button", { name: "XL", exact: true }).click();
  await mouseStroke(page, 470, true);
  await mouseStroke(page, 560, false);
  await mouseStroke(page, 670, true, true);
  await mouseStroke(page, 800, false, true);
  const strokes = (await snapshot(page)).objects;
  const width = (o: any) => {
    const settled = o.points.slice(Math.ceil(o.points.length / 3));
    return (
      settled.reduce((sum: number, p: any) => sum + p.widthRatio, 0) /
      settled.length
    );
  };
  expect(width(strokes[0])).toBeGreaterThan(width(strokes[1]) * 1.25);
  expect(width(strokes[2])).toBeGreaterThan(width(strokes[3]) * 1.25);
  await page.getByRole("button", { name: "Solid", exact: true }).click();
  await page.getByRole("button", { name: "Blue", exact: true }).click();
  await page.getByRole("slider", { name: "Opacity" }).fill("35");
  await mouseStroke(page, 500, false);
  const solid = page.locator(".stroke-shape").last();
  await expect(solid).toHaveAttribute("stroke-width", "20");
  await expect(solid).toHaveAttribute("stroke", "#3878d5");
  await expect(solid).toHaveAttribute("fill", "none");
  await expect(solid).toHaveAttribute("opacity", "0.35");
  expect((await snapshot(page)).objects.at(-1)).toMatchObject({
    mode: "solid",
    strokeWidth: 20,
    opacity: 0.35,
  });
  await page.keyboard.press("v");
  await expect(page.locator(".canvas-viewport")).toHaveAttribute(
    "data-active-tool",
    "select",
  );
  await page.keyboard.press("p");
  await page.screenshot({ path: "test-results/pen-modes.png" });
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.getByLabel("Board title")).toBeEnabled();
  await page.keyboard.press("p");
  for (const name of ["Solid", "Blue", "XL"])
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("slider", { name: "Opacity" })).toHaveValue("35");
});

test("text inherits preferences, resizes for XL, preserves styles through reload and supports undoable appearance", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Text tool", exact: true }).click();
  await page.getByRole("button", { name: "Purple", exact: true }).click();
  await page.getByRole("button", { name: "XL", exact: true }).click();
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.getByRole("button", { name: "Center", exact: true }).click();
  await page.getByRole("slider", { name: "Opacity" }).fill("65");
  await page.mouse.click(300, 550);
  await page
    .getByRole("textbox", { name: "Edit text", exact: true })
    .fill("Hello\ncanvas");
  await page.keyboard.press("Escape");
  const original = (await snapshot(page)).objects[0];
  expect(original).toMatchObject({
    color: "#9958c8",
    fontSize: 52,
    fontWeight: 700,
    textAlign: "center",
    opacity: 0.65,
  });
  expect(original.height).toBeGreaterThan(150);
  await expect(page.locator(".text-object-value")).toHaveCSS(
    "text-align",
    "center",
  );
  await page
    .getByRole("button", { name: "Edit appearance", exact: true })
    .click();
  await page.getByRole("button", { name: "Small", exact: true }).click();
  expect((await snapshot(page)).objects[0].height).toBeLessThan(
    original.height,
  );
  await page.keyboard.press("Control+z");
  expect((await snapshot(page)).objects[0]).toEqual(original);
  await page.getByRole("button", { name: "Close appearance" }).click();
  await page.getByRole("button", { name: "Text tool", exact: true }).click();
  await page.getByRole("button", { name: "Green", exact: true }).click();
  expect((await snapshot(page)).objects[0]).toEqual(original);
  await page.waitForTimeout(900);
  await page.reload();
  await expect(page.getByLabel("Board title")).toBeEnabled();
  expect((await snapshot(page)).objects[0]).toEqual(original);
  await page.getByRole("button", { name: "Text tool", exact: true }).click();
  for (const name of ["Green", "XL", "Bold", "Center"])
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("slider", { name: "Opacity" })).toHaveValue("65");
  await page.screenshot({ path: "test-results/text-settings.png" });
});

test("stroke appearance slider previews without document writes and commits one history entry", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
  await mouseStroke(page, 550, false);
  await page.getByRole("button", { name: "Select tool", exact: true }).click();
  await expect(page.locator(".tool-options")).toHaveCount(0);
  await page.mouse.click(280, 550);
  await page
    .getByRole("button", { name: "Edit appearance", exact: true })
    .click();
  await page.getByRole("button", { name: "Red", exact: true }).click();
  await expect(page.locator(".stroke-shape")).toHaveCSS(
    "fill",
    "rgb(220, 69, 69)",
  );
  await page.getByRole("button", { name: "XL", exact: true }).click();
  const before = await snapshot(page);
  const slider = page.getByRole("slider", { name: "Opacity" });
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, {
    steps: 25,
  });
  expect((await snapshot(page)).history).toBe(before.history);
  expect((await snapshot(page)).objects[0].opacity).toBe(1);
  expect(
    Number(await page.locator(".stroke-shape").getAttribute("opacity")),
  ).toBeLessThan(0.5);
  await page.mouse.up();
  expect((await snapshot(page)).history).toBe(before.history + 1);
  const after = (await snapshot(page)).objects[0];
  await page
    .getByRole("button", { name: "Undo Change opacity", exact: true })
    .click();
  expect((await snapshot(page)).objects[0].opacity).toBe(1);
  await page
    .getByRole("button", { name: "Redo Change opacity", exact: true })
    .click();
  expect((await snapshot(page)).objects[0]).toEqual(after);
  await page.getByRole("button", { name: "Close appearance" }).click();
  await page.mouse.move(280, 550);
  await page.mouse.down();
  await page.mouse.move(320, 590);
  await page.mouse.up();
  const moved = (await snapshot(page)).objects[0];
  expect(moved.points[0].widthRatio).toBe(after.points[0].widthRatio);
  expect(moved.points[0].x).toBeCloseTo(after.points[0].x + 40);
  await page.keyboard.press("Delete");
  expect((await snapshot(page)).objects).toHaveLength(0);
  await page.keyboard.press("Control+z");
  expect((await snapshot(page)).objects[0]).toEqual(moved);
});

test("mobile contextual panels stay on screen and touch velocity is expressive", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
  const box = (await page
    .getByRole("region", { name: "Pen settings" })
    .boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThan(844);
  // CDP creates native touch events, exercising pointer capture and touch routing.
  const client = await page.context().newCDPSession(page);
  for (const slow of [true, false]) {
    const y = slow ? 590 : 700;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 50, y }],
    });
    for (let i = 1; i <= 25; i++) {
      if (slow) await page.waitForTimeout(25);
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 50 + i * 10, y }],
      });
    }
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  const strokes = (await snapshot(page)).objects;
  expect(strokes).toHaveLength(2);
  expect(strokes[0].points.at(-1).widthRatio).toBeGreaterThan(
    strokes[1].points.at(-1).widthRatio,
  );
  await page.screenshot({ path: "test-results/mobile-pen.png" });
});

test("simulated stylus pressure and speed combine; Solid stays constant for every size", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
  await page.getByRole("button", { name: "Large", exact: true }).click();
  const client = await page.context().newCDPSession(page);
  for (const [index, force] of [0.1, 0.9].entries()) {
    const y = 560 + index * 100;
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      buttons: 1,
      pointerType: "pen",
      force,
      x: 140,
      y,
    });
    for (let i = 1; i <= 25; i++) {
      await page.waitForTimeout(20);
      await client.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        button: "left",
        buttons: 1,
        pointerType: "pen",
        force,
        x: 140 + i * 6,
        y,
      });
    }
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      buttons: 0,
      pointerType: "pen",
      force: 0,
      x: 290,
      y,
    });
  }
  const strokes = (await snapshot(page)).objects;
  expect(strokes[1].points.at(-1).widthRatio).toBeGreaterThan(
    strokes[0].points.at(-1).widthRatio * 1.4,
  );
  await page.getByRole("button", { name: "Solid", exact: true }).click();
  for (const [i, [name, width]] of [
    ["Small", 4],
    ["Large", 10],
    ["XL", 20],
  ].entries()) {
    await page.getByRole("button", { name: String(name), exact: true }).click();
    await mouseStroke(page, 470 + i * 100, false);
    await expect(page.locator(".stroke-shape").last()).toHaveAttribute(
      "stroke-width",
      String(width),
    );
    await expect(page.locator(".stroke-shape").last()).toHaveAttribute(
      "fill",
      "none",
    );
  }
});
