import { defineProject } from 'vitest/config';

export default defineProject({
  root: import.meta.dirname,
  test: {
    name: 'data-guard',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15_000,
  },
});
