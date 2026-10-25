import { readFile, readdir } from 'node:fs/promises';
import { expect, test, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { chooseFilterOption, chooseFilterDate } from './filter.ts';
import type { FilterChoice } from './filter.ts';
import { clickAllowed } from './selectors.ts';
import type { Click } from './selectors.ts';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

async function productionSources() {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => ({
        file: join(entry.parentPath, entry.name),
        path: relative(
          directory,
          join(entry.parentPath, entry.name),
        ).replaceAll('\\', '/'),
      }))
      .filter(
        ({ path }) =>
          !/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(
            path,
          ),
      )
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(async ({ file, path }) => ({
        path,
        source: await readFile(file, 'utf8'),
      })),
  );
}
function pageScriptFindings(
  sources: readonly { path: string; source: string }[],
) {
  return sources.flatMap(({ path, source }) =>
    Array.from(
      source.matchAll(
        /\.\s*(evaluate|evaluateAll|evaluateHandle|addInitScript|exposeFunction|exposeBinding|\$\$?eval)\s*(?:\?\.\s*)?\(/g,
      ),
      (match) => ({ path, method: match[1] }),
    ),
  );
}
test('C12 revision IG-2 B production Instagram files never execute page scripts', async () => {
  const sources = await productionSources();
  expect(sources.map(({ path }) => path)).toEqual(
    expect.arrayContaining([
      'filter.ts',
      'selectors.ts',
      'driver.ts',
      'run.ts',
    ]),
  );
  expect(pageScriptFindings(sources)).toEqual([]);
});
test('C23 retry wait cannot be shortened by a production environment or fake entrypoint', async () => {
  const policy = await readFile(new URL('./retry.ts', import.meta.url), 'utf8');
  const runner = await readFile(new URL('./run.ts', import.meta.url), 'utf8');
  const driver = await readFile(
    new URL('./driver.ts', import.meta.url),
    'utf8',
  );
  expect(policy).toContain('POST_REOPEN_WAIT_MS = 60000');
  expect(runner).toContain('boundaryWait(POST_REOPEN_WAIT_MS)');
  expect(driver).toContain('await sleep(ms, undefined, { signal })');
  for (const source of [policy, runner, driver])
    for (const forbidden of [
      'fake-instagram',
      'C23_TEST',
      'SP_RETRY',
      'retryWaitMs',
      'process.env',
    ])
      expect(source).not.toContain(forbidden);
});
test('C25 list and post retries share one fixed wait and one policy while initial-list timeouts cannot opt in', async () => {
  const policy = await readFile(new URL('./retry.ts', import.meta.url), 'utf8');
  const runner = await readFile(new URL('./run.ts', import.meta.url), 'utf8');
  const driver = await readFile(
    new URL('./driver.ts', import.meta.url),
    'utf8',
  );
  expect(policy).toContain('beginList(');
  expect(policy).toContain('instanceof FilteredListTimeout');
  expect(runner.match(/new PostOpenRetries\(/g)).toHaveLength(1);
  expect(runner).toContain('postRetries.beginList(');
  expect(runner.match(/boundaryWait\(POST_REOPEN_WAIT_MS\)/g)).toHaveLength(1);
  expect(runner).toContain('await waitToReopen(retry)');
  expect(driver).toMatch(/filtered\s*\?\s*new FilteredListTimeout\(\)/);
  expect(driver.match(/true,\s*\);/g)?.length).toBeGreaterThanOrEqual(2);
  for (const source of [policy, runner, driver])
    for (const forbidden of [
      'fake-instagram',
      'C25_TEST',
      'SP_RETRY',
      'listRetryWaitMs',
      'process.env',
    ])
      expect(source).not.toContain(forbidden);
});
test('C12 revision IG-2 B detector rejects each planted page-script API in every production file', async () => {
  const sources = await productionSources();
  expect(sources.length).toBeGreaterThan(0);
  for (const { path } of sources)
    for (const method of [
      'evaluate',
      'evaluateAll',
      'evaluateHandle',
      'addInitScript',
      'exposeFunction',
      'exposeBinding',
      '$eval',
      '$$eval',
    ])
      for (const source of [
        `await page.${method}(() => null);`,
        `await page .\n ${method} \n (() => null);`,
        `await page?.${method}?.(() => null);`,
      ])
        expect(pageScriptFindings([{ path, source }])).toEqual([
          { path, method },
        ]);
});

test.each([
  { side: 'foreign', unit: 'day', value: 1 },
  { side: 'start', unit: 'foreign', value: 1 },
  { side: 'end', unit: 'year', value: 2025.5 },
  { side: 'end', unit: 'month', value: NaN },
])(
  'C5 choice rejects malformed request %j before reading any page',
  async (choice) => {
    const locator = vi.fn();
    await expect(
      chooseFilterOption(
        { locator } as unknown as Page,
        choice as FilterChoice,
        () => {},
      ),
    ).rejects.toMatchObject({
      code: 'INSTAGRAM_SHAPE_CHANGED',
      token: 'filter-control',
    });
    expect(locator).not.toHaveBeenCalled();
  },
);
test.each([
  '2025-02-29',
  '2025-13-01',
  '2025-01-32',
  '2025-1-01',
  'not-a-date',
])('C5 date %s rejects before any page operation', async (date) => {
  await expect(
    chooseFilterDate({} as Page, 'start', date, () => {}),
  ).rejects.toMatchObject({
    code: 'INSTAGRAM_SHAPE_CHANGED',
    token: 'filter-control',
  });
});
test('C5 cancellation runs before selector or choice work', async () => {
  const failure = new Error('Generated cancellation');
  await expect(
    chooseFilterOption(
      {} as Page,
      { side: 'start', unit: 'year', value: 2025 },
      () => {
        throw failure;
      },
    ),
  ).rejects.toBe(failure);
});
test('C5 removed calendar controls never reach a click even when their names appear on a page', async () => {
  const click = vi.fn();
  const page = {
    isClosed: () => false,
    url: () => 'https://www.instagram.com/your_activity/interactions/comments',
    locator: () => ({
      getAttribute: () => Promise.resolve('en'),
      filter: () => ({
        getByText: () => ({ count: () => Promise.resolve(0) }),
      }),
    }),
    getByText: () => ({ count: () => Promise.resolve(0) }),
    getByRole: () => ({
      count: () => Promise.resolve(1),
      isVisible: () => Promise.resolve(true),
      click,
    }),
  } as unknown as Page;
  for (const choice of [
    { kind: 'named', name: 'Start date' },
    { kind: 'named', name: 'End date' },
    { kind: 'named', name: 'Choose year' },
    { kind: 'named', name: 'Choose month' },
    { kind: 'year', value: 2025 },
    { kind: 'month', value: 6 },
    { kind: 'day', value: '2025-07-30' },
  ])
    await expect(
      clickAllowed(page, choice as unknown as Click, () => {}),
    ).rejects.toMatchObject({ code: 'UNEXPECTED_ACTION' });
  expect(click).not.toHaveBeenCalled();
});
test('C5 native choice and red mutations stay outside page-script and production activation paths', async () => {
  const helper = await readFile(
    new URL('./filter.ts', import.meta.url),
    'utf8',
  );
  expect(helper).toContain('select.selectOption({ label }');
  expect(helper).toContain("select.locator('option:checked')");
  for (const forbidden of [
    '.evaluate(',
    '.addInitScript(',
    '.exposeFunction(',
    '.press(',
    '.fill(',
    '.click(',
    '.keyboard',
    'process.env',
    'fake-instagram',
    'RED_MODE',
  ])
    expect(helper).not.toContain(forbidden);
  const cli = await readFile(
    new URL('../../commands/context-instagram.ts', import.meta.url),
    'utf8',
  );
  expect(cli).not.toContain('fake-instagram');
  expect(cli).not.toContain('RED_MODE');
});
test('C5 generated browser ports retain their defaults, accept overrides and reject invalid numbers', () => {
  const module = new URL(
      '../../../e2e/fake-instagram/ports.ts',
      import.meta.url,
    ),
    names = [
      'SP_CONTEXT_TEST_PORT',
      'SP_CONTEXT_CONFIRMATION_TEST_PORT',
      'SP_CONTEXT_SERVER_TEST_PORT',
      'SP_CONTEXT_REVIEW_TEST_PORT',
      'SP_CONTEXT_FOREIGN_TEST_PORT',
    ],
    script = `import {CONTEXT_PORTS} from ${JSON.stringify(module.href)}; console.log(JSON.stringify(Object.values(CONTEXT_PORTS)));`,
    invoke = (settings: Record<string, string>) =>
      spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        encoding: 'utf8',
        cwd: fileURLToPath(new URL('../../../../..', import.meta.url)),
        env: settings,
      });
  expect(invoke({})).toMatchObject({
    status: 0,
    stdout: '[4401,4402,4403,4404,4419]\n',
  });
  const overrides = Object.fromEntries(
    names.map((name, index) => [name, String(4581 + index)]),
  );
  expect(invoke(overrides)).toMatchObject({
    status: 0,
    stdout: '[4581,4582,4583,4584,4585]\n',
  });
  for (const value of ['0', '65536', '1.5', 'invalid']) {
    const result = invoke({ ...overrides, SP_CONTEXT_TEST_PORT: value });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid generated browser test port.');
  }
  // Six child Node runs took 0.5 to 2.6 s alone on 2026-10-17 and passed the
  // 5 s default twice in full runs on a loaded machine (BL-009).
}, 60_000);
