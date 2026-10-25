import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import existing from './playwright.config.ts';

const port = Number(process.env['SP_E2E_PORT'] ?? '4180');

export default defineConfig({
  ...existing,
  testDir: './scripts',
  testMatch: 'prototype-screens.spec.ts',
  outputDir: join(tmpdir(), 'socialprune-feed-w3', 'prototype-results'),
  timeout: 120_000,
  use: {
    ...existing.use,
    locale: 'de-DE',
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  // This screenshot consumer includes the generated confirmed-post image.
  // Keep its media route in the existing test-only fixture server.
  webServer: {
    ...existing.webServer,
    command: `pnpm build && node e2e/feed-fixture.ts --preview ${port}`,
    url: `http://127.0.0.1:${port}/socialprune/`,
  },
});
