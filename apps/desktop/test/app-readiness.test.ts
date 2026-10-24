import { expect, test } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directory } from '../packaging/paths.ts';
import { runPowerShell } from '../packaging/windows-powershell.ts';
import {
  APP_READINESS_DEADLINE_MS,
  waitForAppReadiness,
} from '../packaging/app-readiness.ts';
import { windowsTestBudget } from './windows-test-budgets.ts';

const ready = {
  version: 1,
  state: 'completed',
  userHash: 'a'.repeat(64),
  eventId: 211,
  recordId: 164,
  eventAt: '2026-10-24T09:18:43.140Z',
} as const;
const pending = { ...ready, state: 'pending', eventId: 216 } as const;

async function exercise(values: unknown[], fail = false) {
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-readiness-'));
  const output = join(scratch, 'receipt.json');
  let time = 0;
  let reads = 0;
  const promise = waitForAppReadiness(output, {
    now: () => time,
    wait: (ms) => {
      time += ms;
      return Promise.resolve();
    },
    read: () => {
      reads++;
      if (fail) return Promise.reject(new Error('invented access denial'));
      return Promise.resolve(values[Math.min(reads - 1, values.length - 1)]);
    },
  });
  return {
    promise,
    output,
    counts: () => ({ time, reads }),
    close: () => rm(scratch, { recursive: true, force: true }),
  };
}

test('completion already retained from long ago permits the first snapshot without waiting', async () => {
  const old = { ...ready, eventAt: '2020-01-01T00:00:00.000Z' };
  const run = await exercise([old]);
  try {
    await expect(run.promise).resolves.toMatchObject({
      state: 'ready',
      checks: 1,
      waitedMs: 0,
      observation: old,
    });
    expect(run.counts()).toEqual({ time: 0, reads: 1 });
    expect(JSON.parse(await readFile(run.output, 'utf8'))).toMatchObject({
      state: 'ready',
    });
  } finally {
    await run.close();
  }
});

test('late completion waits for the positive event, not silence or a stable snapshot', async () => {
  const run = await exercise([pending, pending, ready]);
  try {
    await expect(run.promise).resolves.toMatchObject({
      state: 'ready',
      checks: 3,
      waitedMs: 4000,
    });
    expect(run.counts()).toEqual({ time: 4000, reads: 3 });
  } finally {
    await run.close();
  }
});

test('absent completion reaches the fixed deadline and fails with a retained receipt', async () => {
  const run = await exercise([
    { ...pending, eventId: null, recordId: null, eventAt: null },
  ]);
  try {
    await expect(run.promise).rejects.toThrow('APP_READINESS_TIMEOUT');
    expect(run.counts().time).toBe(APP_READINESS_DEADLINE_MS);
    expect(JSON.parse(await readFile(run.output, 'utf8'))).toMatchObject({
      state: 'timeout',
      deadlineMs: APP_READINESS_DEADLINE_MS,
    });
  } finally {
    await run.close();
  }
});

test('unreadable or malformed evidence fails closed without waiting and never logs its body', async () => {
  for (const values of [
    [ready],
    [{ ...ready, eventId: 241 }],
    [{ ...ready, extra: 'private invented value' }],
    [{ ...pending, userHash: null }],
  ]) {
    const run = await exercise(values, values[0] === ready);
    try {
      await expect(run.promise).rejects.toThrow('APP_READINESS_UNREADABLE');
      const text = await readFile(run.output, 'utf8');
      expect(JSON.parse(text)).toMatchObject({
        state: 'unreadable',
        waitedMs: 0,
      });
      expect(text).not.toContain('invented');
    } finally {
      await run.close();
    }
  }
});

test('a completion arriving after the deadline remains a failure', async () => {
  const scratch = await mkdtemp(
    join(tmpdir(), 'socialprune-readiness-deadline-'),
  );
  let time = 0;
  try {
    await expect(
      waitForAppReadiness(join(scratch, 'receipt.json'), {
        now: () => time,
        wait: () => Promise.resolve(),
        read: () => {
          time = APP_READINESS_DEADLINE_MS + 1;
          return Promise.resolve(ready);
        },
      }),
    ).rejects.toThrow('APP_READINESS_TIMEOUT');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'the real PowerShell reader rejects stale, foreign, disabled and unreadable event evidence using generated providers only',
  async () => {
    for (const [scenario, state, id] of [
      ['present', 'completed', 211],
      ['late', 'pending', 216],
      ['absent', 'pending', null],
      ['stale', 'pending', 240],
      ['foreign', 'unreadable', null],
      ['unreadable', 'unreadable', null],
      ['disabled', 'unreadable', null],
      ['bad-provider', 'unreadable', null],
    ] as const) {
      const { stdout } = await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'test/app-readiness-fixture.ps1'),
          '-Scenario',
          scenario,
        ],
        { timeout: windowsTestBudget(1), windowsHide: true },
      );
      expect(JSON.parse(stdout), scenario).toMatchObject({
        version: 1,
        state,
        eventId: id,
      });
    }
  },
  windowsTestBudget(8),
);

test('readiness precedes installed side effects, token-control snapshots and the release smoke baseline; no production entry imports it', async () => {
  const parent = await readFile(
    join(directory, 'e2e/installed-proof.ts'),
    'utf8',
  );
  expect(parent.indexOf('await waitForAppReadiness(')).toBeGreaterThan(0);
  expect(parent.indexOf('await waitForAppReadiness(')).toBeLessThan(
    parent.indexOf("await ps('packaging/install-layout.ps1')"),
  );
  for (const [file, first] of [
    ['e2e/uninstall-controls.ts', "await systemTokenProof('controls')"],
    ['packaging/release-smoke.ts', "await systemTokenProof('smoke')"],
  ]) {
    const text = await readFile(join(directory, file!), 'utf8');
    expect(text.indexOf('await waitForAppReadiness(')).toBeGreaterThan(0);
    expect(text.indexOf('await waitForAppReadiness(')).toBeLessThan(
      text.indexOf(first!),
    );
  }
  for (const file of [
    'src/main/index.ts',
    'packaging/package.ts',
    'packaging/release.ts',
  ])
    expect(await readFile(join(directory, file), 'utf8')).not.toContain(
      'app-readiness',
    );
  expect(APP_READINESS_DEADLINE_MS).toBe(1_200_000);
});
