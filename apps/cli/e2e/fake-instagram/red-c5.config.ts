import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Explicit test entry only. Production has no environment-driven mutation path.
// eslint-disable-next-line no-restricted-properties -- Node red-control selection only.
const mode = process.env.SP_CONTEXT_RED_MODE;
const cases: Record<
  string,
  { file: string; before: string; after: string; tests: string }
> = {
  calendar: {
    file: '/instagram/driver.ts',
    before: 'const dates = utcWindow(at);',
    after:
      "await page.getByRole('button', { name: 'Start date', exact: true }).click({ timeout: 200 }); const dates = utcWindow(at);",
    tests: 'C5 foundation',
  },
  keyboard: {
    file: '/instagram/filter.ts',
    before: 'await select.selectOption({ label }, { timeout: 5000 });',
    after:
      "await select.press('ArrowDown'); await select.selectOption({ label }, { timeout: 5000 });",
    tests: 'C5 foundation',
  },
  readback: {
    file: '/instagram/filter.ts',
    before: 'if (checked.length !== 1 || checked[0] !== label) refuse();',
    after: 'void checked;',
    tests: 'C5 filter-readback',
  },
  shape: {
    file: '/instagram/filter.ts',
    before: 'select = (await controls(page, choice.side))[choice.unit];',
    after:
      "select = page.locator('select').nth((choice.side === 'start' ? 0 : 3) + ({ month: 0, day: 1, year: 2 })[choice.unit]);",
    tests: 'C5 filter-(five|seven|no-start|no-end)',
  },
  offered: {
    file: '/instagram/filter.ts',
    before:
      "if (index < 0 || !(await select.locator('option').nth(index).isEnabled()))\n      refuse();",
    after:
      "if (index < 0) { await select.selectOption({ label: 'Unlisted generated option' }, { timeout: 100 }); return; }",
    tests: 'C5 (missing current-day|a year list)',
  },
  recorder: {
    file: '/fake-instagram/recorder.ts',
    before: 'for (const event of events) {',
    after: 'for (const event of events.slice(0, 0)) {',
    tests: 'C5 recorder rejects',
  },
  window: {
    file: '/instagram/driver.ts',
    before:
      "await chooseFilterDate(page, 'start', dates[0], guard);\n  await chooseFilterDate(page, 'end', dates[1], guard);",
    after: 'void dates;',
    tests: 'applies both offered dates',
  },
};
const mutation = mode ? cases[mode] : undefined;
if (!mutation) throw new Error('Choose an explicit C5 red control.');
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [
    {
      name: 'instagram-c5-red-only',
      enforce: 'pre',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith(mutation.file)) return null;
        if (!source.includes(mutation.before))
          throw new Error('Stale C5 red control: ' + mode);
        return {
          code: source.replace(mutation.before, mutation.after),
          map: null,
        };
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['apps/cli/e2e/context-instagram.test.ts'],
    testNamePattern: mutation.tests,
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});
