import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { SCALE_OUTPUT } from './scale-host.ts';

const port = 4781;
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: '.',
  testMatch: 'scale.measurement.ts',
  globalSetup: './build-identity-setup.ts',
  outputDir: join(SCALE_OUTPUT, 'playwright'),
  timeout: 900_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: origin,
    locale: 'en-US',
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  // Unit build probes can replace dist. Rebuild before each focused engine run.
  webServer: {
    command: `pnpm build && pnpm preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${origin}/socialprune/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
