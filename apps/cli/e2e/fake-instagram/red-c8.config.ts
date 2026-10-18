import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Explicit test config only. No production entry selects these mutations.
// eslint-disable-next-line no-restricted-properties -- Node-only fault selection.
const mode = process.env.SP_CONTEXT_RED_MODE;
const cases: Record<
  string,
  {
    file: string;
    before: string;
    after: string;
    tests: string;
    matches?: number;
    include?: string[];
  }
> = {
  limit: {
    file: '/instagram/driver.ts',
    before: 'expandClicks < 10',
    after: 'expandClicks < 11',
    tests: 'C8 scroll-late expands',
  },
  empty: {
    file: '/instagram/driver.ts',
    before: 'emptyScrolls >= 2',
    after: 'emptyScrolls >= 3',
    tests: 'C8 scroll-never expands',
  },
  spacing: {
    file: '/instagram/driver.ts',
    before: 'await deps.sleep(deps.pace.expandMs);',
    after: 'await deps.sleep(0);',
    tests: 'C8 scroll-first expands',
    matches: 2,
  },
  pointer: {
    file: '/instagram/selectors.ts',
    before:
      'await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);',
    after: 'await page.mouse.move(700, 30);',
    tests: 'C8 scroll-first expands',
  },
  recorder: {
    file: '/fake-instagram/recorder.ts',
    before: "expect(['list', 'post-comments']).toContain(wheel.area);",
    after: "expect(['list', 'post-comments', 'other']).toContain(wheel.area);",
    tests: 'C8 recorder rejects',
  },
  cleanup: {
    file: '/e2e/context-instagram.test.ts',
    before: 'onTestFinished(() => (closeSettled ? undefined : close()));',
    after: 'onTestFinished(() => {});',
    tests: 'C8 cleanup [12]',
    matches: 2,
  },
  timeout: {
    file: '/e2e/context-instagram.test.ts',
    before: '  await cleanupLease.local();',
    after:
      '  await cleanupLease.local();\n  await new Promise<void>(() => {});',
    tests: 'C8 cleanup [12]',
  },
  'writer-skip': {
    file: '/workspace/instagram-context-writer.ts',
    before:
      "result.state !== 'unconfirmed' &&\n            result.state !== 'not-listed'",
    after: "!(result.state === 'unconfirmed' && result.code === 'not-shown')",
    tests: 'C9 writer accepts five checked records after skipped',
    include: ['packages/core/src/workspace/instagram-context.test.ts'],
  },
  'writer-limit': {
    file: '/workspace/instagram-context-writer.ts',
    before: 'sends.length > 15',
    after: 'sends.length > 16',
    tests: 'C8 writer refuses sixteen sends',
    include: ['packages/core/src/workspace/instagram-context.test.ts'],
  },
  'journal-limit': {
    file: '/workspace/browser-journal.ts',
    before: 'sends.length > 15',
    after: 'sends.length > 16',
    tests: 'C8 journal refuses sixteen sends',
    include: ['apps/cli/src/workspace/browser-journal.test.ts'],
  },
  'journal-skip': {
    file: '/workspace/browser-journal.ts',
    before:
      "settles[0]!.state !== 'unconfirmed' &&\n              settles[0]!.state !== 'not-listed'",
    after:
      "!(settles[0]!.state === 'unconfirmed' && settles[0]!.code === 'not-shown')",
    tests: 'C9 journal accepts five checked records after skipped',
    include: ['apps/cli/src/workspace/browser-journal.test.ts'],
  },
  'runner-skip': {
    file: '/instagram/run.ts',
    before: "if (options.plan.canary && code === 'owner')",
    after:
      "if (options.plan.canary && code !== 'not-shown') throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');\n          if (options.plan.canary && code === 'owner')",
    tests: 'C9 IG-7 second comment (owner|time|edited|several)',
  },
  'runner-not-listed': {
    file: '/instagram/run.ts',
    before: "stepReport.result = list.full ? 'window-full' : 'no-row';",
    after:
      "stepReport.result = list.full ? 'window-full' : 'no-row';\n          if (options.plan.canary) throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');",
    tests: 'C9 IG-7 second comment (no-row|window-full)',
  },
  'runner-acceptance': {
    file: '/instagram/run.ts',
    before:
      "settlements[0]!.state !== 'unconfirmed' &&\n            settlements[0]!.state !== 'not-listed'",
    after:
      "!(settlements[0]!.state === 'unconfirmed' && settlements[0]!.code === 'not-shown')",
    tests: 'C9 IG-7 second comment owner',
  },
  'owner-report-schema': {
    file: '/instagram/report.ts',
    before: '  ownerEqualsExport: z.boolean().optional(),',
    after: '',
    tests: 'C9 owner report schema',
    include: ['apps/cli/src/browser/instagram/canary.test.ts'],
  },
  'canary-selection': {
    file: '/instagram/plan.ts',
    before: '.slice(0, 15)',
    after: '.slice(0, 16)',
    tests: 'C8 canary takes at most fifteen',
    include: ['apps/cli/src/browser/instagram/plan.test.ts'],
  },
};
const mutation = mode ? cases[mode] : undefined;
if (!mutation) throw new Error('Choose an explicit C8 red control.');
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [
    {
      name: 'instagram-c8-red-only',
      enforce: 'pre',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith(mutation.file)) return null;
        if (
          source.split(mutation.before).length !==
          1 + (mutation.matches ?? 1)
        )
          throw new Error('Stale C8 red control: ' + mode);
        return {
          code: source.replaceAll(mutation.before, mutation.after),
          map: null,
        };
      },
    },
  ],
  test: {
    environment: 'node',
    include: mutation.include ?? ['apps/cli/e2e/context-instagram.test.ts'],
    testNamePattern: mutation.tests,
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: mode === 'timeout' ? 10000 : 60000,
    hookTimeout: 30000,
  },
});
