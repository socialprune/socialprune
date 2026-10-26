import { defineConfig } from '@playwright/test';
import probe from './playwright.probe.config.ts';

/** Generated IndexedDB contracts need no WebKit/native-window preparation. */
export default defineConfig(probe, {
  globalSetup: ['./e2e/build-identity-setup.ts'],
  testMatch: 'store-contract.spec.ts',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', headless: true } },
  ],
});
