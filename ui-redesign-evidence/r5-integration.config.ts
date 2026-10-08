import { defineConfig } from "@playwright/test";
import base from "../playwright.integration.config";
import { fileURLToPath } from "node:url";

export default defineConfig({ ...base, testDir: "../e2e-integration", testMatch: "share-links.spec.ts",
  outputDir: "./r5-test-results", timeout: 60_000,
  use: { ...base.use, screenshot: "off", trace: "off", reducedMotion: "reduce" },
  reporter: [["list"], ["json", { outputFile: "r5-browser-results.json" }]],
  globalTeardown: "../e2e-integration/teardown.ts",
  webServer: (base.webServer as { env?: Record<string, string> }[]).map((server, index) => ({ ...server,
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    ...(index === 0 ? { env: { ...server.env, SCRIBBLE_E2E_SHARE_LINKS: "1" } } : {}),
  })),
});
