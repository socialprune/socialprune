import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');

test('the guard uses each consumer’s directly declared pinned Playwright CLI', async () => {
  for (const path of ['apps/web/package.json', 'apps/cli/package.json']) {
    const require = createRequire(resolve(root, path));
    const cli = resolve(
      dirname(require.resolve('@playwright/test/package.json')),
      'cli.js',
    );
    const result = await promisify(execFile)(process.execPath, [
      cli,
      '--version',
    ]);
    expect(result.stdout).toContain('1.63.0');
  }
});

test('all Linux browser dependency steps use the same bounded root lock guard', async () => {
  const workflow = await readFile(
    resolve(root, '.github/workflows/ci.yml'),
    'utf8',
  );
  expect(
    workflow.match(/sudo python3 -B \.github\/scripts\/playwright-deps\.py/g),
  ).toHaveLength(4);
  expect(workflow).not.toContain('sudo dpkg --configure -a');
  expect(workflow).not.toContain('for duration in 16m 10m');
  expect(workflow).toContain(
    'python3 -B .github/scripts/playwright-deps-test.py',
  );
  expect(
    workflow.match(
      /name: Install browser system dependencies\s+timeout-minutes: 30/g,
    ),
  ).toHaveLength(4);
});

test('dependency guard policy and Linux lock/process probes run through its test-only entrypoint', async () => {
  const result = await promisify(execFile)(
    process.platform === 'win32' ? 'python' : 'python3',
    ['-B', '.github/scripts/playwright-deps-test.py'],
    { cwd: root, timeout: 20_000, windowsHide: true },
  );
  expect(result.stderr).toContain('OK');
  expect(result.stdout).toContain('APT_LOCK_TIMEOUT');
});
