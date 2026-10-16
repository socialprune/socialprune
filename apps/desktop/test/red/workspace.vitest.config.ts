import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'desktop-test-only-erased-open-error',
      enforce: 'pre',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/src/engine-host/workspace.ts'))
          return;
        const changed = source.replace(
          /type:\s*["']rejected["'],\s*code:\s*["']WORKSPACE_OPEN_FAILED["'],/g,
          "type: 'foundationSummary', items: 0, sqliteVersion: '0.0.0',",
        );
        if (changed === source) throw new Error('RED_MUTATION_NOT_APPLIED');
        return changed;
      },
    },
  ],
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['test/workspace.test.ts'],
    environment: 'node',
    maxWorkers: 2,
  },
});
