import config from './playwright.probe.config.ts';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  ...config,
  testMatch: ['storage-measure.spec.ts'],
  projects: config.projects?.filter(
    ({ name }) => name === 'chromium' || name === 'firefox',
  ),
});
