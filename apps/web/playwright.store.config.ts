import { defineConfig } from '@playwright/test';

/** Real IndexedDB tests, generated inputs, headless Chromium and an owned probe server. */
export default defineConfig({
  testDir: './test/probes',
  testMatch: 'store-contract.spec.ts',
  timeout: 30000,
  workers: 1,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:4608', headless: true },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'node tooling/store-contract-server.ts',
    url: 'http://127.0.0.1:4608/socialprune/icon.svg',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
