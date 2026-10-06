import { defineProject } from 'vitest/config';

export default defineProject({
  root: import.meta.dirname,
  test: {
    name: 'adapter-x',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
