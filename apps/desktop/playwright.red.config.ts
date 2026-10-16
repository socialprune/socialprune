import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/red',
  testMatch: '**/*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
});
