import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { TEST_PORTS } from '../playwright.ports.config.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const rateControl = process.argv.some((value) =>
  value.includes('fill HTTP 429'),
);
const browserControl =
  rateControl ||
  process.argv.some((value) => value.includes('Instagram engine pauses'));
const fallbackControl = process.argv.some(
  (value) =>
    value.includes('unprojectable runner failure') ||
    value.includes('finalization throw after observing an extension'),
);
if (
  browserControl &&
  (TEST_PORTS.x !== 4521 || TEST_PORTS.engineInstagram !== 4541)
)
  throw new Error(
    'Revision browser negative controls require E2 assigned ports.',
  );
const oldPaths = [
  'browser/confirmation-state.ts',
  'browser/run-controls.ts',
  'browser/runner.ts',
  'browser/x/driver.ts',
  'browser/x/fill/run.ts',
  'browser/instagram/run.ts',
  'engine/facade.ts',
];
function replace(source: string, pattern: string | RegExp, planted: string) {
  const result = source.replace(pattern, planted);
  if (result === source)
    throw new Error('Revision negative-control anchor changed.');
  return result;
}
function unprotectProjection(source: string): string {
  const start = source.search(
    /try \{\s*confirmation\.update\(\{\s*phase: 'ended'/,
  );
  if (start < 0) throw new Error('Final projection anchor changed.');
  const finalization = replace(source.slice(start), 'try {', '{');
  return (
    source.slice(0, start) +
    replace(
      finalization,
      /\} catch \(projectionError\) \{[\s\S]*?\} finally \{/,
      '}\n{',
    )
  );
}
/** Reviewed old behaviour is planted only by this explicit test configuration. */
export default defineConfig({
  root,
  plugins: [
    {
      name: 'engine-revision-old-behaviour',
      enforce: 'pre',
      transform(input, id) {
        const path = oldPaths.find((path) =>
          id.replaceAll('\\', '/').endsWith('/apps/cli/src/' + path),
        );
        if (!path) return;
        if (
          browserControl &&
          path !==
            (rateControl ? 'browser/x/fill/run.ts' : 'browser/instagram/run.ts')
        )
          return;
        let source = input;
        if (path === 'browser/confirmation-state.ts') {
          source = replace(
            source,
            "(action !== 'stop' && view.version !== version)",
            'view.version !== version',
          );
          source = replace(
            source,
            "action === 'does-not-match' && view.phase === 'canary-review'",
            "action === 'does-not-match' && ['canary-review', 'awaiting-continue'].includes(view.phase)",
          );
          source = replace(
            source,
            /view\.phase === 'awaiting-continue'\s*\? 'continue'/,
            "view.phase === 'awaiting-continue' ? view.mode === 'delete' ? 'matches' : 'continue'",
          );
          source = replace(
            source,
            'pending.action !== action',
            "pending.action !== (action === 'matches' && view.mode === 'delete' ? 'continue' : action)",
          );
        }
        if (path === 'browser/x/driver.ts') {
          source = replace(
            source,
            /if \(options\.desktop\)\s*platform = local = await freshPlatformPage\(context\);/,
            'if (options.desktop) platform = local = context.pages()[0] ?? await context.newPage();',
          );
          source = replace(
            source,
            'async close() {\n      // Keep',
            'async close() {\n      if (options.desktop) { await context.close(); return; }\n      // Keep',
          );
        }
        if (
          path === 'browser/runner.ts' ||
          path === 'browser/x/fill/run.ts' ||
          path === 'browser/instagram/run.ts'
        )
          source = unprotectProjection(source);
        if (path === 'browser/x/fill/run.ts') {
          source = replace(
            source,
            'if (response.status() === 429) {',
            `if (options.session) {
            const headers = response.headers();
            const limit = Number(headers['x-rate-limit-limit']), remaining = Number(headers['x-rate-limit-remaining']), reset = Number(headers['x-rate-limit-reset']);
            if ([limit, remaining, reset].every(Number.isSafeInteger) && limit > 0 && remaining >= 0 && reset >= 0) rateWindow('TweetDetail', limit, remaining, reset * 1000);
          }
          if (response.status() === 429) {`,
          );
          source = replace(
            source,
            'Boolean(options.order)',
            'Boolean(options.order || options.session)',
          );
        }
        if (path === 'browser/instagram/run.ts') {
          source = replace(
            source,
            'confirmOnPost,',
            'confirmOnPost, waitPage,',
          );
          source = replace(
            source,
            'import { CLICK_NAMES }',
            'import { CLICK_NAMES, checkPage, readRows }',
          );
          source = replace(
            source,
            /const resumeChecks = async \(\) => \{[\s\S]*?\n\s*\};/,
            `const resumeChecks = async () => {
            await checkpoint();
            await page.goto(deps.origin + '/your_activity/interactions/comments', { waitUntil: 'domcontentloaded', timeout: deps.responseMs });
            await waitPage(page, async () => (await readRows(page)).length > 0, deps.responseMs, 'list-timeout', guard);
            await checkPage(page);
            const rows = await readRows(page);
            if (!rows.length || rows.some(row => row.username.toLowerCase() !== options.plan.handle.toLowerCase())) throw new ContextStop('ACCOUNT_MISMATCH', 'account-changed');
            await checkpoint();
          };`,
          );
          source = replace(
            source,
            'Boolean(options.order)',
            'Boolean(options.order || options.session)',
          );
        }
        if (path === 'engine/facade.ts')
          source = replace(
            source,
            /\} catch \{\s*recoverFailedProjection\(error\);\s*\}/,
            '} catch (caught) { throw caught; }',
          );
        return source;
      },
    },
  ],
  test: {
    include: browserControl
      ? ['apps/cli/e2e/engine-run-controls.test.ts']
      : fallbackControl
        ? ['apps/cli/src/engine/engine.test.ts']
        : [
            'apps/cli/src/browser/confirmation-state.test.ts',
            'apps/cli/src/browser/launch.test.ts',
            'apps/cli/src/browser/session-cleanup.test.ts',
          ],
    environment: 'node',
    fileParallelism: false,
    retry: 0,
    testTimeout: 30000,
    hookTimeout: 15000,
  },
});
