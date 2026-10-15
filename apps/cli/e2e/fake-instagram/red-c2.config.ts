import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// In-memory test mutations only; no normal runtime imports this entrypoint.
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [
    {
      name: 'instagram-c2-red',
      enforce: 'pre',
      transform(source, id) {
        const path = id.replaceAll('\\', '/');
        const edits: [string, string][] = path.endsWith('/instagram/order.ts')
          ? [
              ['min(10).max(30)', 'min(1).max(30)'],
              [
                'stepsPerDay: z.number().int().min(1).max(600)',
                'stepsPerDay: z.number().int().min(1).max(999)',
              ],
            ]
          : path.endsWith('/instagram/pace.ts')
            ? [
                [
                  '? CONTEXT_PACE.intervalMs',
                  '? (order?.value.secondsPerStep ?? 30) * 1000',
                ],
                [
                  'perDay: order?.value.stepsPerDay ?? CONTEXT_PACE.perDay',
                  'perDay: CONTEXT_PACE.perDay',
                ],
                ['intervalMs: 30_000', 'intervalMs: 29_000'],
              ]
            : path.endsWith('/instagram/network.ts')
              ? [['if (response.status() === 429)', 'if (false)']]
              : path.endsWith('/instagram/signals.ts')
                ? [
                    ['return walk(body, 0);', 'return false;'],
                    [
                      'for (const raw of Object.keys(headers))',
                      'for (const raw of Object.values(headers))',
                    ],
                  ]
                : [];
        if (!edits.length) return null;
        for (const [before, after] of edits) {
          if (!source.includes(before)) throw new Error('Stale C2 red control');
          source = source.replace(before, after);
        }
        return { code: source, map: null };
      },
    },
  ],
  test: {
    environment: 'node',
    include: [
      'apps/cli/src/browser/instagram/{order,pace,signals}.test.ts',
      'apps/cli/e2e/context-instagram.test.ts',
    ],
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});
