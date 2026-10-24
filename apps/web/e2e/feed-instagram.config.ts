import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../playwright.config.ts';

// eslint-disable-next-line no-restricted-properties -- Test-only port, never an endpoint key.
const port = Number(process.env['SP_E2E_INSTAGRAM_PORT'] ?? '4831');
if (!Number.isInteger(port) || port < 1024 || port >= 65535)
  throw new Error('Invalid SP_E2E_INSTAGRAM_PORT.');
const origin = `http://127.0.0.1:${port}`;

/** Generated context media is served only for this spec, never policy tests. */
export default defineConfig({
  ...base,
  globalSetup: './build-identity-setup.ts',
  testDir: '.',
  testMatch: 'feed-instagram.spec.ts',
  testIgnore: [],
  use: { ...base.use, baseURL: origin },
  webServer: {
    command: `pnpm build && node e2e/feed-fixture.ts --preview ${port}`,
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: `${origin}/socialprune/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
