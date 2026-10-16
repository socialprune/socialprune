import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Deliberate wrong implementations, reachable only from this test command. */
export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  plugins: [
    {
      name: 'generated-engine-negative-controls',
      enforce: 'pre',
      transform(source, id) {
        if (id.endsWith('/browser/confirmation-state.ts'))
          return source
            .replace(
              /\(action !== 'stop' && view\.version !== version\)/,
              'false',
            )
            .replace(
              'const view = this.runView;',
              "const view = this.runView;\n    if (action === 'start' && view.phase === 'awaiting-warning') { this.legacyAction('start', this.view.version); this.updateRun({phase:'running', warning:{...view.warning,acknowledged:true}}); return; }",
            )
            .replace(
              'if (this.stopped) return Promise.resolve(false);',
              "if (action === 'continue' && this.desktop) return Promise.resolve(true);\n    if (this.stopped) return Promise.resolve(false);",
            )
            .replace(
              /!value\.profileObserved \|\| !value\.accountBefore \|\| !value\.accountAfter\s*\? 'not-completed'/,
              "!value.profileObserved || !value.accountBefore || !value.accountAfter ? 'unchanged'",
            );
        if (id.endsWith('/browser/run-controls.ts'))
          return source.replace(
            'this.notify(null, true);',
            "this.notify({phase:'paused',pausedAt:this.now().toISOString()}, false);",
          );
        if (id.endsWith('/engine/boundaries.test.ts'))
          return source
            .replace(
              'const real = await closure(engine);',
              "const real = await closure(engine, [engine, '../../e2e/engine-test-entry.ts']);",
            )
            .replace(
              /for \(const root of roots\)\s*assertCommands\(await closure\(root\)\);/,
              "for (const root of roots) assertCommands(await closure(root, [root, '../engine/index.ts']));",
            );
      },
    },
  ],
  test: {
    include: [
      'apps/cli/src/browser/confirmation-state.test.ts',
      'apps/cli/src/browser/run-controls.test.ts',
      'apps/cli/src/engine/boundaries.test.ts',
    ],
    environment: 'node',
    fileParallelism: false,
    retry: 0,
    testTimeout: 60000,
  },
});
