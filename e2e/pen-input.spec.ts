import { expect, test, type Page } from "@playwright/test";

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const path = "/scribble/src/store/documentStore.ts";
    const { useDocumentStore } = await import(/* @vite-ignore */ path);
    const { objects, past } = useDocumentStore.getState();
    return { objects: Object.values(objects) as any[], history: past.length };
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Sign in required" } }) }));
  await page.goto("/");
  await expect(page.getByLabel("Drawing title")).toBeEnabled();
  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
});

test("native touch stylus keeps first-contact ownership after drawing; fingers cannot pinch or erase it", async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  const viewport = page.locator(".canvas-viewport");
  const owner = { id: 1, x: 400, y: 560 };
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [owner] });
  owner.x += 30;
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [owner] });
  const palm = { id: 2, x: 650, y: 720 };
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [owner, palm] });
  await expect(viewport).toHaveAttribute("data-pinching", "false");
  await expect(viewport).toHaveAttribute("data-drawing", "true");
  await viewport.dispatchEvent("pointercancel", { pointerId: 999, pointerType: "touch" });
  await viewport.dispatchEvent("lostpointercapture", { pointerId: 999, pointerType: "touch" });
  owner.x += 50;
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [owner, palm] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [palm] });
  owner.x += 30;
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [owner] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const saved = await snapshot(page);
  expect(saved.objects).toHaveLength(1);
  expect(saved.history).toBe(1);
  expect(saved.objects[0].points.at(-1).x - saved.objects[0].points[0].x).toBeCloseTo(110);
  await page.keyboard.press("Control+z");
  expect((await snapshot(page)).objects).toHaveLength(0);
  await page.keyboard.press("Control+Shift+z");
  expect((await snapshot(page)).objects).toEqual(saved.objects);
});

test("provisional touch can become an intentional pinch with no stroke history", async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  const points = [{ id: 1, x: 400, y: 560 }, { id: 2, x: 600, y: 560 }];
  // Same native event removes host timing from the gesture-start window.
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points });
  await expect(page.locator(".canvas-viewport")).toHaveAttribute("data-pinching", "true");
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [points[0], { ...points[1], x: 650 }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  expect(await snapshot(page)).toEqual({ objects: [], history: 0 });
  await expect(page.locator(".canvas-viewport")).toHaveAttribute("data-drawing", "false");
});

test("recognized pen rejects touch palms before they enter the gesture registry", async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", pointerType: "pen", button: "left", buttons: 1, force: 0.5, x: 400, y: 560 });
  const viewport = page.locator(".canvas-viewport");
  for (const pointerId of [70, 71]) {
    await viewport.dispatchEvent("pointerdown", { pointerId, pointerType: "touch", button: 0, clientX: 600, clientY: 700 });
  }
  await expect(viewport).toHaveAttribute("data-pinching", "false");
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", pointerType: "pen", button: "left", buttons: 1, force: 0.8, x: 550, y: 600 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", pointerType: "pen", button: "left", buttons: 0, force: 0, x: 550, y: 600 });
  expect((await snapshot(page)).objects).toHaveLength(1);
});

for (const ending of ["pointercancel", "lostpointercapture", "blur"]) {
test(`unexpected ${ending} preserves confirmed ink exactly once`, async ({ page }) => {
  await page.mouse.move(400, 560);
  await page.mouse.down();
  await page.mouse.move(490, 570);
  if (ending === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  else await page.locator(".canvas-viewport").dispatchEvent(ending, { pointerId: 1, pointerType: "mouse" });
  await page.mouse.up();
  expect((await snapshot(page)).history).toBe(1);
  expect((await snapshot(page)).objects).toHaveLength(1);
  await expect(page.locator(".canvas-viewport")).toHaveAttribute("data-drawing", "false");
});
}

test("Escape and explicit tool change discard drafts; reused pointer can start again", async ({ page }) => {
  for (const ending of ["Escape", "v"]) {
    await page.keyboard.press("p");
    await page.mouse.move(400, 560);
    await page.mouse.down();
    await page.mouse.move(490, 570);
    await page.keyboard.press(ending);
    await page.mouse.up();
    expect((await snapshot(page)).history).toBe(0);
  }
  await page.keyboard.press("p");
  await page.mouse.click(500, 600);
  expect((await snapshot(page)).history).toBe(1);
});

test("unexpected cancel preserves a confirmed dot without needing movement", async ({ page }) => {
  await page.mouse.move(400, 560);
  await page.mouse.down();
  await page.locator(".canvas-viewport").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" });
  await page.mouse.up();
  const saved = await snapshot(page);
  expect(saved.history).toBe(1);
  expect(saved.objects).toHaveLength(1);
  expect(saved.objects[0].points).toHaveLength(1);
});

test("keeps the final endpoint below the sample threshold and supports missing coalesced API", async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(PointerEvent.prototype, "getCoalescedEvents", { value: undefined, configurable: true }));
  await page.mouse.move(400, 560);
  await page.mouse.down();
  await page.mouse.move(490, 570);
  await page.locator(".canvas-viewport").dispatchEvent("pointerup", { pointerId: 1, pointerType: "mouse", clientX: 490.3, clientY: 570, pressure: 0 });
  await page.mouse.up();
  const points = (await snapshot(page)).objects[0].points;
  expect(points.at(-1).x - points[0].x).toBeCloseTo(90.3);
});

test("stationary pen force updates a dot; lifting does not collapse the tip", async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", pointerType: "pen", button: "left", buttons: 1, force: 0.1, x: 400, y: 560 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", pointerType: "pen", button: "left", buttons: 1, force: 0.9, x: 400, y: 560 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", pointerType: "pen", button: "left", buttons: 0, force: 0, x: 400, y: 560 });
  const stroke = (await snapshot(page)).objects[0];
  expect(stroke.points).toHaveLength(1);
  expect(stroke.points[0].pressure).toBeCloseTo(0.9);
  expect(stroke.points[0].inkPressure).toBeGreaterThan(0.8);
  expect(stroke).toMatchObject({ rendererVersion: 2, inputKind: "pen" });
});

test("recognized pen settles meaningful touch ink and takes ownership", async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  const touch = { id: 1, x: 400, y: 560 };
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...touch, x: 450 }] });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", pointerType: "pen", button: "left", buttons: 1, force: 0.5, x: 400, y: 650 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", pointerType: "pen", button: "left", buttons: 1, force: 0.5, x: 500, y: 650 });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", pointerType: "pen", button: "left", buttons: 0, force: 0, x: 500, y: 650 });
  const state = await snapshot(page);
  expect(state.history).toBe(2);
  expect(state.objects.map((object) => object.inputKind)).toEqual(["touch", "pen"]);
});

test("low zoom changes only presentation; draft/saved dark ink agree and detail returns", async ({ page }) => {
  await page.evaluate(async () => {
    const path = "/scribble/src/store/viewportStore.ts";
    const { useViewportStore } = await import(/* @vite-ignore */ path);
    useViewportStore.getState().setViewport({ x: 600, y: 400, zoom: 0.2 });
    document.documentElement.dataset.theme = "dark";
  });
  await page.mouse.move(400, 560);
  await page.mouse.down();
  await page.mouse.move(500, 570, { steps: 12 });
  const draft = page.locator(".stroke-draft-path");
  await expect(draft).toHaveAttribute("data-simple", "true");
  await expect(draft).toHaveCSS("stroke", "rgb(200, 203, 196)");
  await expect(draft).toHaveCSS("stroke-width", "4.25px");
  await page.mouse.up();
  const saved = page.locator(".stroke-shape");
  await expect(saved).toHaveAttribute("data-simple", "true");
  await expect(saved).toHaveCSS("stroke", "rgb(200, 203, 196)");
  await expect(saved).toHaveCSS("stroke-width", "4.25px");
  await expect(saved).toHaveCSS("filter", "none");
  const before = await snapshot(page);
  await page.evaluate(async () => {
    const path = "/scribble/src/store/viewportStore.ts";
    const { useViewportStore } = await import(/* @vite-ignore */ path);
    // Keep the same ink visible as zoom changes; a fixed camera origin would
    // put its low-zoom world coordinates outside the viewport at 100%.
    useViewportStore.getState().setViewport({ x: 1400, y: -300, zoom: 1 });
  });
  await expect(saved).toHaveAttribute("data-simple", "false");
  await expect(saved).toHaveCSS("fill", "rgb(200, 203, 196)");
  expect(await snapshot(page)).toEqual(before);
  await page.waitForTimeout(900);
  const path = await saved.getAttribute("d");
  await page.reload();
  await expect(page.getByLabel("Drawing title")).toBeEnabled();
  await expect(saved).toHaveAttribute("d", path!);
  expect((await snapshot(page)).objects).toEqual(before.objects);
});

test("high-zoom selection contains the ink; drag and thickness edits keep geometry and history aligned", async ({ page }) => {
  await page.evaluate(async () => {
    const paths = ["documentStore", "viewportStore", "uiStore"];
    const [{ useDocumentStore }, { useViewportStore }, { useUiStore }] = await Promise.all(paths.map((name) => import(/* @vite-ignore */ `/scribble/src/store/${name}.ts`)));
    const factoryPath = "/scribble/src/canvas/strokes/strokeFactories.ts";
    const { createStrokeObject } = await import(/* @vite-ignore */ factoryPath);
    const stroke = createStrokeObject([{ x: -60, y: 0, inkPressure: 0.5 }, { x: 60, y: 0, inkPressure: 0.5 }], 1,
      { mode: "solid", size: "xl", color: "#3f413d", opacity: 1 }, "pen");
    useDocumentStore.getState().loadDocument({ [stroke.id]: stroke });
    useViewportStore.getState().setViewport({ x: 680, y: 450, zoom: 4 });
    useUiStore.getState().setActiveTool("select");
  });
  await page.mouse.move(680, 485);
  await page.mouse.down();
  await page.mouse.move(720, 505);
  await page.mouse.up();
  await expect(page.locator(".stroke-object")).toHaveClass(/is-selected/);
  const afterMove = await snapshot(page);
  expect(afterMove.history).toBe(1);
  expect(afterMove.objects[0].points[0]).toMatchObject({ x: -50, y: 5, inkPressure: 0.5 });
  await page.getByRole("button", { name: "Edit appearance", exact: true }).click();
  await page.getByRole("button", { name: "Small", exact: true }).click();
  const small = (await snapshot(page)).objects[0];
  expect(small.strokeWidth).toBe(4);
  expect(small.height).toBe(4);
  expect(small.points).toEqual(afterMove.objects[0].points);
  await page.getByRole("button", { name: "Close appearance" }).click();
  await expect(page.getByRole("button", { name: "Edit appearance" })).toBeFocused();
  // Canvas shortcuts resume after leaving the focused toolbar control.
  await page.mouse.click(1100, 500);
  await page.keyboard.press("Control+z");
  expect((await snapshot(page)).objects).toEqual(afterMove.objects);
  await page.keyboard.press("Control+z");
  expect((await snapshot(page)).objects[0].points[0]).toMatchObject({ x: -60, y: 0, inkPressure: 0.5 });
});

test("culling keeps offscreen group movement nodes and document data; navigation and undo restore ink", async ({ page }) => {
  await page.evaluate(async () => {
    const paths = ["documentStore", "viewportStore", "uiStore"];
    const [{ useDocumentStore }, { useViewportStore }, { useUiStore }] = await Promise.all(paths.map((name) => import(/* @vite-ignore */ `/scribble/src/store/${name}.ts`)));
    const factoryPath = "/scribble/src/canvas/strokes/strokeFactories.ts";
    const { createStrokeObject } = await import(/* @vite-ignore */ factoryPath);
    const settings = { mode: "solid", size: "small", color: "#3f413d", opacity: 1 };
    const visible = { ...createStrokeObject([{ x: -100, y: 0, inkPressure: 0.5 }, { x: 100, y: 0, inkPressure: 0.5 }], 1, settings, "pen"), id: "visible", groupId: "group" };
    const distant = { ...createStrokeObject([{ x: 4000, y: 0, inkPressure: 0.5 }, { x: 4100, y: 0, inkPressure: 0.5 }], 2, settings, "pen"), id: "distant", groupId: "group" };
    useDocumentStore.getState().loadDocument({ visible, distant });
    useViewportStore.getState().setViewport({ x: 680, y: 450, zoom: 1 });
    useUiStore.getState().setActiveTool("select");
  });
  await expect(page.locator(".stroke-object")).toHaveCount(2);
  await expect(page.locator(".stroke-shape")).toHaveCount(1);
  const distant = page.locator('[data-stroke-object-id="distant"]');
  await page.mouse.move(680, 450);
  await page.mouse.down();
  await page.mouse.move(720, 470);
  await expect(distant.locator(".stroke-shape")).toHaveCount(1);
  await expect(distant).toHaveAttribute("transform", "translate(40 20)");
  await page.mouse.up();
  expect((await snapshot(page)).objects[1].points[0]).toMatchObject({ x: 4040, y: 20 });
  expect((await snapshot(page)).history).toBe(1);
  await page.keyboard.press("Control+z");
  expect((await snapshot(page)).objects[1].points[0]).toMatchObject({ x: 4000, y: 0 });
  await page.keyboard.press("Escape");
  await expect(distant.locator(".stroke-shape")).toHaveCount(0);
  await page.evaluate(async () => {
    const path = "/scribble/src/store/viewportStore.ts";
    const { useViewportStore } = await import(/* @vite-ignore */ path);
    useViewportStore.getState().setViewport({ x: -3500, y: 450, zoom: 1 });
  });
  await expect(distant.locator(".stroke-shape")).toHaveCount(1);
  expect((await snapshot(page)).objects).toHaveLength(2);
});
