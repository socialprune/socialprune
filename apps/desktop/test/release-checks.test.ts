import { expect, test } from 'vitest';
import { assertBudgets, summarize } from '../packaging/release-checks.ts';
import { assertSystemUnchanged } from '../packaging/system-check.ts';
import { releaseBudgets } from '../packaging/release-budgets.ts';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertNsisTemp } from '../packaging/release-temp.ts';
import * as releaseChecks from '../packaging/release-checks.ts';

test('the CI command measures only without budgets and enforces every calibrated budget', () => {
  const check = (
    releaseChecks as unknown as {
      checkRelease: (
        summary: ReturnType<typeof summarize>,
        budgets: (typeof measurements)[0] | null,
        enforce?: boolean,
      ) => string;
    }
  ).checkRelease;
  const summary = summarize(measurements);
  expect(check(summary, null)).toBe('measure');
  expect(() => check(summary, null, true)).toThrow(
    'RUNNER_BUDGETS_NOT_CALIBRATED',
  );
  expect(
    check(summary, {
      startupMs: 5040,
      workingSetBytes: 609600000,
      installerBytes: 192000000,
    }),
  ).toBe('enforce');
  expect(() => check(summary, measurements[0]!)).toThrow(
    'BUDGET_EXCEEDED:startupMs',
  );
});

const measurements = [
  { startupMs: 4000, workingSetBytes: 500000000, installerBytes: 160000000 },
  { startupMs: 4300, workingSetBytes: 510000000, installerBytes: 160000000 },
  { startupMs: 4100, workingSetBytes: 505000000, installerBytes: 160000000 },
  { startupMs: 4500, workingSetBytes: 515000000, installerBytes: 160000000 },
  { startupMs: 4200, workingSetBytes: 508000000, installerBytes: 160000000 },
];

test('five independent input samples determine median and maximum', () => {
  expect(summarize(measurements)).toEqual({
    runs: 5,
    startupMs: { median: 4200, maximum: 4500 },
    workingSetBytes: { median: 508000000, maximum: 515000000 },
    installerBytes: { median: 160000000, maximum: 160000000 },
  });
  expect(() => summarize(measurements.slice(1))).toThrow('FIVE_RUNS_REQUIRED');
});

test('workstation measurements are not silently enforced on the runner', () => {
  expect(releaseBudgets).toBeNull();
});

test('each planted budget below its measured input is rejected', () => {
  const summary = summarize(measurements);
  const limits = {
    startupMs: 5040,
    workingSetBytes: 609600000,
    installerBytes: 192000000,
  };
  expect(() => assertBudgets(summary, limits)).not.toThrow();
  for (const key of ['startupMs', 'workingSetBytes', 'installerBytes'] as const)
    expect(() =>
      assertBudgets(summary, { ...limits, [key]: summary[key].median - 1 }),
    ).toThrow(`BUDGET_EXCEEDED:${key}`);
});

test('system inventory rejects additions, removals and changed values in every class', () => {
  const baseline = {
    version: 2 as const,
    services: [],
    tasks: [],
    runKeys: [],
    firewall: [],
    listeners: ['tcp|127.0.0.1|4669|100'],
    startup: [],
  };
  expect(() => assertSystemUnchanged(baseline, baseline)).not.toThrow();
  for (const key of [
    'services',
    'tasks',
    'runKeys',
    'firewall',
    'startup',
  ] as const) {
    const planted = {
      name: 'planted',
      count: 1,
      strict: true,
      appReference: false,
      fields: { Value: '0'.repeat(64) },
    };
    for (const [before, after] of [
      [baseline, { ...baseline, [key]: [planted] }],
      [{ ...baseline, [key]: [planted] }, baseline],
    ])
      expect(() => assertSystemUnchanged(before!, after!)).toThrow(
        `SYSTEM_CHANGED:${key}`,
      );
  }
  expect(() =>
    assertSystemUnchanged(baseline, { ...baseline, listeners: [] }),
  ).not.toThrow();
});

test('only bounded NSIS temp folders with byte-identical Un.exe copies pass', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-temp-proof-'));
  const bytes = Buffer.from('generated uninstaller');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  try {
    await mkdir(join(scratch, '~nsu1.tmp'));
    await writeFile(join(scratch, '~nsu1.tmp/Un.exe'), bytes);
    expect(await assertNsisTemp(scratch, 1, sha256)).toMatchObject([
      { folder: '~nsu1.tmp', name: 'Un.exe', bytes: bytes.length, sha256 },
    ]);
    await writeFile(
      join(scratch, 'planted-extra.txt'),
      'generated unexpected file',
    );
    await expect(assertNsisTemp(scratch, 1, sha256)).rejects.toThrow(
      'NSIS_TEMP_EXTRA_ENTRY',
    );
    await rm(join(scratch, 'planted-extra.txt'));
    await expect(assertNsisTemp(scratch, 1, '0'.repeat(64))).rejects.toThrow(
      'NSIS_TEMP_COPY_MISMATCH',
    );
    await writeFile(
      join(scratch, '~nsu1.tmp/extra.txt'),
      'generated unexpected file',
    );
    await expect(assertNsisTemp(scratch, 1, sha256)).rejects.toThrow(
      'NSIS_TEMP_FILES',
    );
    await rm(join(scratch, '~nsu1.tmp/extra.txt'));
    await mkdir(join(scratch, '~nsu2.tmp'));
    await writeFile(join(scratch, '~nsu2.tmp/Un.exe'), bytes);
    expect(await assertNsisTemp(scratch, 2, sha256)).toHaveLength(2);
    await expect(assertNsisTemp(scratch, 1, sha256)).rejects.toThrow(
      'NSIS_TEMP_COUNT',
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
