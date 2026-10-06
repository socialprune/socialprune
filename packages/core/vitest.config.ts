import { defineProject } from 'vitest/config';

export default defineProject({
  root: import.meta.dirname,
  test: {
    name: 'core',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
