import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [
    {
      name: 'instagram-added-extension-red',
      enforce: 'pre',
      transform(source, id) {
        const path = id.replaceAll('\\', '/');
        let target: string | undefined;
        if (path.endsWith('/instagram/run.ts'))
          target =
            'extensionsChanged(before, await profileSnapshot(options.profile))';
        if (target) {
          if (!source.includes(target))
            throw new Error('Stale C3 added-extension control');
          source = source
            .replace(target, 'false')
            .replace('const added =', 'const added = 0;\nconst ignoredAdded =');
          return { code: source, map: null };
        }
        if (path.endsWith('/instagram/canary.ts'))
          return {
            code: source.replace(/\n\s+added \|\|/, '\n    false ||'),
            map: null,
          };
        return null;
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['apps/cli/e2e/context-instagram.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});
