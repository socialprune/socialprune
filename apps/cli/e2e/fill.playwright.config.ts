import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: [
    'originals-fill.spec.ts',
    'review-media.spec.ts',
    'rendered-page.spec.ts',
  ],
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: 'list',
  use: { browserName: 'chromium' },
});
