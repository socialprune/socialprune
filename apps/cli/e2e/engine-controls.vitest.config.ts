import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import '../playwright.ports.config.ts';
export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  test: {
    environment: 'node',
    include: ['apps/cli/e2e/engine-run-controls.test.ts'],
    fileParallelism: false,
    retry: 0,
    testTimeout: 90000,
    hookTimeout: 30000,
  },
});
