import { defineConfig } from '@playwright/test';

const port = Number(process.env.SP_E2E_DESKTOP_PORT ?? 4614);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid desktop test port.');
export default defineConfig({
  testDir: './e2e/desktop',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, locale: 'en-US' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `node e2e/desktop/server.ts ${port}`,
    url: `http://127.0.0.1:${port}/desktop.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
