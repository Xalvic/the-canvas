import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "pen-production.spec.ts",
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1360, height: 900 },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
