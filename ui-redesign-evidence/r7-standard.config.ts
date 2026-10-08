import { defineConfig } from '@playwright/test';
import base from '../playwright.config';
import { fileURLToPath } from 'node:url';

export default defineConfig({ ...base, testDir: '../e2e', testMatch: 'r7-disposable-*.spec.ts',
  outputDir: '../test-results/r7-standard',
  use: { ...base.use, screenshot: 'off', trace: 'off' },
  webServer: { ...(base.webServer as { command: string; url: string; reuseExistingServer?: boolean }), cwd: fileURLToPath(new URL('..', import.meta.url)) },
  reporter: [['list'], ['json', { outputFile: 'r7-standard-results.json' }]],
});
