import { randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";

process.env.SCRIBBLE_FIXTURE_TOKEN ??= randomUUID();

export default defineConfig({
  testDir: "./e2e-integration",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  globalTeardown: "./e2e-integration/teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:4174",
    viewport: { width: 1360, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node --env-file=.env.docker --import tsx scripts/e2e-api-fixture.ts",
      url: "http://127.0.0.1:4301/health",
      env: { API_PORT: "4301", SCRIBBLE_E2E_FIXTURE: "1", SCRIBBLE_FIXTURE_TOKEN: process.env.SCRIBBLE_FIXTURE_TOKEN },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 4174 --strictPort --mode test",
      url: "http://127.0.0.1:4174/scribble/",
      env: { API_PORT: "4301" },
      reuseExistingServer: false,
    },
  ],
});
