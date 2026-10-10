import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import existing from './playwright.config.ts';

export default defineConfig({
  ...existing,
  testDir: './scripts',
  testMatch: 'prototype-screens.spec.ts',
  outputDir: join(tmpdir(), 'socialprune-screens-results'),
  timeout: 120_000,
  use: {
    ...existing.use,
    locale: 'de-DE',
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
