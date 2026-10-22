import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  runNativeQuery,
  setQueryMeasurementDirectory,
} from '../packaging/windows-powershell.ts';

test('a generated query outlasting the old poll budget fails there and passes with a measured three-query budget', async () => {
  const module = await import('../packaging/query-poll.ts');
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-query-poll-'));
  setQueryMeasurementDirectory(scratch);
  try {
    const query = async () =>
      (
        await runNativeQuery(
          process.execPath,
          ['-e', 'setTimeout(()=>process.stdout.write("ready"),200)'],
          { timeout: 60_000, queryClass: 'generated-poll-slow' },
        )
      ).stdout;
    await expect(
      module.pollQuery(query, (value) => value === 'ready', {
        timeoutMs: 50,
        intervalMs: 10,
        message: 'GENERATED_OLD_BUDGET',
      }),
    ).rejects.toThrow(/GENERATED_OLD_BUDGET.*QUERY_POLL_TIMEOUT/);
    console.log(
      'GENERATED_OLD_BUDGET_RED: 200 ms query rejected by 50 ms poll',
    );
    const started = performance.now();
    await query();
    const measured = Math.ceil(performance.now() - started);
    await expect(
      module.pollQuery(query, (value) => value === 'ready', {
        timeoutMs: module.queryPollBudget(measured, 10, 0),
        intervalMs: 10,
        message: 'GENERATED_DERIVED_BUDGET',
      }),
    ).resolves.toBe('ready');
    console.log(
      'GENERATED_DERIVED_BUDGET_GREEN',
      JSON.stringify({
        measuredMs: measured,
        budgetMs: module.queryPollBudget(measured, 10, 0),
      }),
    );
  } finally {
    setQueryMeasurementDirectory(undefined);
    await rm(scratch, { recursive: true, force: true });
  }
});

test('query failure exits a poll with its exact causal receipt rather than a predicate timeout', async () => {
  const module = await import('../packaging/query-poll.ts');
  let calls = 0;
  const failure = await module
    .pollQuery(
      async () => {
        calls++;
        return runNativeQuery(process.execPath, ['-e', 'process.exitCode=7'], {
          timeout: 60_000,
          queryClass: 'generated-poll-failure',
        });
      },
      () => false,
      { timeoutMs: 50, intervalMs: 10, message: 'PREDICATE_TIMEOUT' },
    )
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toMatch(
    /QUERY_FAILURE queryClass=generated-poll-failure.*timeoutMs=60000.*durationMs=/,
  );
  expect(failure).toHaveProperty('query.queryClass', 'generated-poll-failure');
  console.log(
    'GENERATED_POLL_FAILURE',
    (failure as Error).message.split('\n')[0],
  );
  expect(calls).toBe(1);
});

test('runner-derived budgets include three complete query observations and the poll interval', async () => {
  const module = await import('../packaging/query-poll.ts');
  expect(module.queryPollBudget(22_375, 100)).toBe(67_225);
  expect(module.queryPollBudget(46_441, 100)).toBe(139_423);
  expect(module.queryPollBudget(23_570, 100)).toBe(70_810);
  expect(module.queryPollBudget(1, 100)).toBe(60_100);
  expect(module.PROCESS_POLL_TIMEOUT_MS).toBe(6355);
  expect(module.LAYOUT_POLL_TIMEOUT_MS).toBe(4994);
  expect(module.WATCH_READY_TIMEOUT_MS).toBe(297239);
  expect(module.POWERSHELL_READY_TIMEOUT_MS).toBe(297239);
});

test('a query poll never overlaps its own queries or aborts a query to meet a predicate deadline', async () => {
  const { pollQuery } = await import('../packaging/query-poll.ts');
  let active = 0,
    maximum = 0,
    calls = 0;
  await expect(
    pollQuery(
      async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
        return ++calls;
      },
      (value) => value === 3,
      { timeoutMs: 500, intervalMs: 1, message: 'SERIAL' },
    ),
  ).resolves.toBe(3);
  expect(maximum).toBe(1);
});

test('query calibration cannot shorten the browser or Electron cleanup grace', async () => {
  const { PROCESS_POLL_TIMEOUT_MS } =
    await import('../packaging/query-poll.ts');
  const { BROWSER_CLEANUP_TIMEOUT_MS, ELECTRON_CLEANUP_TIMEOUT_MS } =
    await import('./windows.ts');
  expect(PROCESS_POLL_TIMEOUT_MS).toBe(6355);
  expect(BROWSER_CLEANUP_TIMEOUT_MS).toBe(60_100);
  expect(ELECTRON_CLEANUP_TIMEOUT_MS).toBe(60_100);
  expect(BROWSER_CLEANUP_TIMEOUT_MS).toBeGreaterThanOrEqual(
    PROCESS_POLL_TIMEOUT_MS,
  );
  expect(ELECTRON_CLEANUP_TIMEOUT_MS).toBeGreaterThanOrEqual(
    PROCESS_POLL_TIMEOUT_MS,
  );
});
