import { defineConfig } from '@playwright/test';
import base from '../playwright.config.ts';

/** FIT-1 uses generated media only; it never enters a production entrypoint. */
export default defineConfig({
  ...base,
  globalSetup: './build-identity-setup.ts',
  testDir: '.',
  testMatch: 'fit-feed.spec.ts',
  testIgnore: [],
});
