import { defineProject } from 'vitest/config';

export default defineProject({
  root: import.meta.dirname,
  test: {
    name: 'licenses-check',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 15_000,
  },
});
