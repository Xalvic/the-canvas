import { expect, test, type Page } from "@playwright/test";
import { createStrokeObject } from "../src/canvas/strokes/strokeFactories";
import { createInkDynamics, sampleInkDynamics } from "../src/canvas/strokes/strokeDynamics";
import { DEFAULT_PEN_SETTINGS } from "../src/tools/toolSettings";
import type { StrokeCanvasObject } from "../src/canvas/objects/types";
import sharp from "sharp";

function trace(x: number, y: number, width = "small" as "small" | "large" | "xl", mode = "draw" as "draw" | "solid", color = "#3f413d", opacity = 1) {
  const dynamics = createInkDynamics();
  const points = Array.from({ length: 50 }, (_, i) => {
    const point = { x: x + i * 0.8, y: y + Math.sin(i / 3) * 9 };
    return { ...point, ...sampleInkDynamics(dynamics, point, i * 8, i / 49, "pen") };
  });
  return createStrokeObject(points, 1, { ...DEFAULT_PEN_SETTINGS, size: width, mode, color, opacity }, "pen");
}

test("low-zoom minimum ink width survives the outer CSS camera transform in rendered pixels", async ({ page }) => {
  const stroke = createStrokeObject([{ x: 0, y: 0, inkPressure: 0.2 }, { x: 100, y: 0, inkPressure: 0.2 }], 1,
    { ...DEFAULT_PEN_SETTINGS, color: "#252622" }, "pen");
  await seed(page, [stroke], 0.2);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
    document.querySelector<HTMLElement>(".grid-layer")!.style.display = "none";
    document.querySelector<HTMLElement>(".canvas-viewport")!.style.background = "white";
  });
  const png = await page.screenshot({ clip: { x: 690, y: 447, width: 1, height: 6 } });
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let coverage = 0;
  for (let row = 0; row < info.height; row++) {
    let rowCoverage = 0;
    for (let col = 0; col < info.width; col++) rowCoverage += (255 - data[(row * info.width + col) * 4]) / (255 - 37);
    coverage += rowCoverage / info.width;
  }
  const dpr = await page.evaluate(() => devicePixelRatio);
  expect(coverage / dpr).toBeGreaterThan(0.7);
  expect(coverage / dpr).toBeLessThan(1.1);
});

async function seed(page: Page, strokes: StrokeCanvasObject[], zoom = 1) {
  await page.route("**/api/auth/me", (route) => route.fulfill({ status: 401, contentType: "application/json", body: '{"error":{"code":"UNAUTHENTICATED","message":"Sign in required"}}' }));
  await page.goto("/scribble/");
  await expect(page.getByLabel("Board title")).toBeEnabled();
  await page.waitForTimeout(800);
  const board = { schemaVersion: 1, id: "current-board", title: "Pen fixture", createdAt: 1, updatedAt: 1,
    viewport: { x: 680, y: 450, zoom }, objects: Object.fromEntries(strokes.map((stroke) => [stroke.id, stroke])) };
  await page.evaluate((fixture) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("the-canvas", 3);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("boards", "readwrite");
      transaction.objectStore("boards").put(fixture);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => { database.close(); reject(transaction.error); };
    };
  }), board);
  const start = Date.now();
  await page.reload();
  await expect(page.locator(".stroke-object")).toHaveCount(strokes.length);
  return Date.now() - start;
}

for (const zoom of [0.2, 0.35, 0.5, 1, 4]) {
  test(`production visual matrix at ${zoom * 100}%`, async ({ page }, info) => {
    const strokes = ["small", "large", "xl"].flatMap((size, row) => ["draw", "solid"].flatMap((mode, col) =>
      ["#252622", "#3f413d", "#ffffff", "#3878d5"].map((color, index) =>
        trace(-340 + col * 400 + index * 85, -80 + row * 90, size as any, mode as any, color, index === 3 ? 0.35 : 1))));
    const zero = trace(0, 100, "small", "draw", "#252622", 0);
    strokes.push(zero);
    await seed(page, strokes, zoom);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      const black = page.locator('.stroke-shape[fill="#252622"], .stroke-shape[stroke="#252622"]').first();
      await expect(black).toHaveCSS("filter", "none");
      const property = await black.getAttribute("fill") === "none" ? "stroke" : "fill";
      await expect(black).toHaveCSS(property, theme === "dark" ? "rgb(236, 238, 232)" : "rgb(37, 38, 34)");
      await expect(page.locator(`[data-stroke-object-id="${zero.id}"] .stroke-shape`)).toHaveAttribute("opacity", "0");
      const path = info.outputPath(`pen-${theme}-${zoom}.png`);
      await page.screenshot({ path });
      await info.attach(`${theme} ${zoom}`, { path, contentType: "image/png" });
    }
    // Source imports/diagnostics must not ship in the production build.
    expect(await page.evaluate(() => "scribblePenDiagnostics" in window)).toBe(false);
    await page.keyboard.press("p");
    await page.mouse.move(400, 700);
    await page.mouse.down();
    await page.mouse.move(450, 710);
    await page.mouse.up();
    await expect(page.locator(".stroke-object")).toHaveCount(strokes.length + 1);
    await page.keyboard.press("Control+z");
    await expect(page.locator(".stroke-object")).toHaveCount(strokes.length);
  });
}

test("production scene and 30-second stroke measurements", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium-dpr1", "One host benchmark; DPR/browser rendering is covered separately");
  test.setTimeout(90_000);
  const report: Record<string, unknown> = { kind: "desktop synthetic production replay; physical Redmi pending" };
  for (const total of [100, 500, 2000]) {
    const strokes = Array.from({ length: total }, (_, i) => trace(
      i < 100 ? -450 + i % 10 * 50 : 3000 + i % 50 * 50,
      -20 + Math.floor(i / 10) * 25,
    ));
    const loadMs = await seed(page, strokes);
    const measurement = await page.evaluate(async () => {
      const frames: number[] = [];
      let previous = performance.now();
      for (let i = 0; i < 60; i++) {
        const time = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        frames.push(time - previous); previous = time;
      }
      const sorted = frames.slice(1).sort((a, b) => a - b);
      const visible = [...document.querySelectorAll<SVGGraphicsElement>(".stroke-shape")].filter((path) => {
        const rect = path.getBoundingClientRect();
        return rect.right >= 0 && rect.left <= innerWidth && rect.bottom >= 0 && rect.top <= innerHeight;
      }).length;
      return { visible, rendered: document.querySelectorAll(".stroke-shape").length, total: document.querySelectorAll(".stroke-object").length,
        medianFrameMs: sorted[Math.floor(sorted.length / 2)], p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
        delayedFrames: sorted.filter((time) => time > 25).length };
    });
    const client = await page.context().newCDPSession(page);
    await client.send("HeapProfiler.collectGarbage");
    await client.send("Performance.enable");
    const { metrics } = await client.send("Performance.getMetrics");
    report[`scene${total}`] = { loadMs, ...measurement, heapBytes: metrics.find((m) => m.name === "JSHeapUsedSize")?.value };
    await client.detach();
  }
  await page.getByRole("button", { name: "Pen tool", exact: true }).click();
  await page.mouse.move(400, 700);
  await page.mouse.down();
  report.longStroke = await page.evaluate(async () => {
    const surface = document.querySelector(".canvas-viewport")!;
    const draft = document.querySelector(".stroke-draft-path")!;
    const nativeRaf = window.requestAnimationFrame.bind(window);
    const paintTimes: number[] = [], frames: number[] = [], eventTimes: number[] = [];
    window.requestAnimationFrame = (callback) => nativeRaf((time) => {
      const before = draft.getAttribute("d"), start = performance.now();
      callback(time);
      const elapsed = performance.now() - start;
      if (draft.getAttribute("d") !== before) paintTimes.push(elapsed);
    });
    let x = 400, y = 700, samples = 0;
    const start = performance.now();
    let previous = start;
    try {
      while (performance.now() - start < 30_000) {
        const time = await new Promise<number>((resolve) => nativeRaf(resolve));
        frames.push(time - previous); previous = time;
        for (let i = 0; i < 2; i++) {
          x = 400 + Math.sin(samples / 70) * 100;
          y = 650 + Math.cos(samples / 90) * 80;
          const tick = performance.now();
          surface.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, pointerType: "mouse", buttons: 1, clientX: x, clientY: y, pressure: 0.5 }));
          eventTimes.push(performance.now() - tick); samples++;
        }
      }
      surface.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y, pressure: 0 }));
    } finally { window.requestAnimationFrame = nativeRaf; }
    const summary = (values: number[]) => {
      values.sort((a, b) => a - b);
      return { count: values.length, p50: values[Math.floor(values.length * 0.5)], p95: values[Math.floor(values.length * 0.95)], max: values.at(-1) };
    };
    return { samples, durationMs: performance.now() - start, shortLetterPaints: summary(paintTimes.slice(0, 20)), paints: summary(paintTimes), events: summary(eventTimes),
      frames: summary(frames), delayedFrames: frames.filter((time) => time > 25).length, dpr: devicePixelRatio };
  });
  await page.mouse.up();
  await expect(page.locator(".stroke-object")).toHaveCount(2001);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".stroke-object")).toHaveCount(2000);
  await info.attach("desktop pen benchmark", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  console.log(JSON.stringify(report));
});
