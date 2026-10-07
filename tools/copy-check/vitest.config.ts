import { defineProject } from 'vitest/config';

export default defineProject({
  root: import.meta.dirname,
  test: {
    name: 'copy-check',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15_000,
  },
});
