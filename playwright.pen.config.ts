import { defineConfig } from "@playwright/test";

// Production rendering/performance evidence, separate from Vite-source fixtures.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "pen-production.spec.ts",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://127.0.0.1:4174", viewport: { width: 1360, height: 900 }, screenshot: "only-on-failure" },
  projects: [
    { name: "chromium-dpr1", use: { browserName: "chromium", deviceScaleFactor: 1 } },
    { name: "chromium-dpr2", use: { browserName: "chromium", deviceScaleFactor: 2 } },
    { name: "webkit-dpr1", use: { browserName: "webkit", deviceScaleFactor: 1 } },
  ],
  webServer: {
    command: "npm exec vite preview -- --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174/scribble/",
    reuseExistingServer: !process.env.CI,
  },
});
