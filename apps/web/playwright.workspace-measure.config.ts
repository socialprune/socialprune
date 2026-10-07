import config from './playwright.config.ts';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  ...config,
  testMatch: 'measurement.workspace.ts',
  projects: config.projects,
});
