import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/probes',
  testMatch: 'development.spec.ts',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4183', locale: 'en-US' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 4183 --strictPort',
    url: 'http://127.0.0.1:4183/socialprune/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
