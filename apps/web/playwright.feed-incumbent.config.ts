import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory =
  process.env['SP_FEED_DESIGN_DIR'] ??
  join(tmpdir(), 'socialprune-feed-design');
const port = Number(process.env['SP_E2E_DEV_PORT'] ?? '4183');
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid SP_E2E_DEV_PORT.');
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './scripts',
  testMatch: 'feed-incumbent.spec.ts',
  outputDir: join(directory, 'incumbent-results'),
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: origin,
    locale: 'de-DE',
    viewport: { width: 1280, height: 960 },
    colorScheme: 'light',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `pnpm build && pnpm preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${origin}/socialprune/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
