import { defineConfig } from '@playwright/test';

const port = Number(process.env['SP_E2E_PORT'] ?? '4180');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid SP_E2E_PORT.');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  globalSetup: './e2e/build-identity-setup.ts',
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: origin, locale: 'en-US' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: `pnpm build && pnpm preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${origin}/socialprune/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
