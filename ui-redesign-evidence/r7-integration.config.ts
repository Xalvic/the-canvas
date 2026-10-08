import { defineConfig } from '@playwright/test';
import base from '../playwright.integration.config';
import { fileURLToPath } from 'node:url';

export default defineConfig({ ...base, testDir: '../e2e-integration', testMatch: 'r7-disposable-*.spec.ts',
  outputDir: '../test-results/r7-integration', timeout: 60_000,
  use: { ...base.use, screenshot: 'off', trace: 'off' },
  globalTeardown: '../e2e-integration/teardown.ts',
  webServer: (base.webServer as { command: string; url: string; env?: Record<string, string> }[]).map((server, index) => ({ ...server,
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    ...(index === 0 ? { env: { ...server.env, SCRIBBLE_E2E_SHARE_LINKS: '1' } } : {}),
  })),
  reporter: [['list'], ['json', { outputFile: process.env.SCRIBBLE_R7_REPORT_FILE ?? 'r7-integration-results.json' }]],
});
