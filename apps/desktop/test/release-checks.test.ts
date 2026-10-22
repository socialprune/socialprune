import { expect, test } from 'vitest';
import { assertBudgets, summarize } from '../packaging/release-checks.ts';
import { assertSystemUnchanged } from '../packaging/system-check.ts';
import {
  releaseBudgets,
  releaseBudgetCalibration,
} from '../packaging/release-budgets.ts';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertNsisTemp } from '../packaging/release-temp.ts';
import * as releaseChecks from '../packaging/release-checks.ts';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { directory } from '../packaging/paths.ts';
import { runNativeQuery } from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';

test('only the explicit require-budgets flag enforces calibrated budgets', () => {
  const check = releaseChecks.checkRelease;
  const summary = summarize(measurements);
  expect(check(summary, null)).toBe('report');
  expect(() => check(summary, null, true)).toThrow(
    'RUNNER_BUDGETS_NOT_CALIBRATED',
  );
  expect(
    check(
      summary,
      {
        startupMs: 5040,
        workingSetBytes: 609600000,
        installerBytes: 192000000,
      },
      true,
    ),
  ).toBe('enforce');
  expect(check(summary, measurements[0]!)).toBe('report');
  expect(() => check(summary, measurements[0]!, true)).toThrow(
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

test('the same planted excess exits zero in report mode and fails with its closed code only with require-budgets', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-budget-mode-'));
  try {
    const entry = join(scratch, 'budget-mode.ts');
    await writeFile(
      entry,
      `import { checkRelease, releaseBudgetReport, budgetCodes } from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/release-checks.ts')).href)};
const budgets={startupMs:2678,workingSetBytes:556307252,installerBytes:194314092};
const summary={runs:5,startupMs:{median:6675,maximum:7591},workingSetBytes:{median:498393088,maximum:500776960},installerBytes:{median:161928414,maximum:161928414}};
const budgetReport=releaseBudgetReport(summary,budgets);
const mode=process.argv.includes('--require-budgets')?'enforce':'report';
const receipt={mode,budgetReport,budgetFailures:budgetReport.filter(row=>!row.within).map(row=>budgetCodes[row.metric])};
for(const row of budgetReport)console.log('RELEASE_BUDGET_REPORT '+JSON.stringify(row));
console.log('MODE_RECEIPT '+JSON.stringify(receipt));
try{checkRelease(summary,budgets,process.argv.includes('--require-budgets'));}catch(error){console.error(error.code);process.exitCode=1;}
`,
    );
    // Even CI metadata cannot silently turn report into enforce or vice versa.
    const options = {
      timeout: 10_000,
      windowsHide: true,
      env: testEnvironment({ GITHUB_ACTIONS: 'true' }),
    };
    const reporting = await runNativeQuery(process.execPath, [entry], options);
    expect(reporting.stdout.match(/^RELEASE_BUDGET_REPORT /gm)).toHaveLength(3);
    expect(reporting.stdout).toContain(
      '"metric":"startupMs","median":6675,"budget":2678,"within":false',
    );
    expect(reporting.stdout).toContain('"mode":"report"');
    expect(reporting.stdout).toContain(
      '"budgetFailures":["RELEASE_STARTUP_BUDGET_EXCEEDED"]',
    );
    await expect(
      runNativeQuery(process.execPath, [entry, '--require-budgets'], options),
    ).rejects.toMatchObject({
      code: 1,
      stderr: 'RELEASE_STARTUP_BUDGET_EXCEEDED\n',
    });
    const smoke = await readFile(
      join(directory, 'packaging/release-smoke.ts'),
      'utf8',
    );
    expect(smoke).toContain(
      "const requireBudgets = process.argv.includes('--require-budgets')",
    );
    expect(smoke).toContain(
      'checkRelease(summary, releaseBudgets, requireBudgets)',
    );
    expect(smoke).toContain(
      'if (differences.length) throw new Error(differences.join',
    );
    expect(smoke).toContain('assertNoOwnedNetwork(networkObservation)');
    expect(smoke).not.toMatch(
      /requireBudgets\s*=.*(?:process\.env|runnerEnvironment)/,
    );
    console.log(
      'RELEASE_MODE_PROOF',
      JSON.stringify({
        reportExit: 0,
        enforceExit: 1,
        report: reporting.stdout.trim().split('\n'),
      }),
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('five independent input samples determine median and maximum', () => {
  expect(summarize(measurements)).toEqual({
    runs: 5,
    startupMs: { median: 4200, maximum: 4500 },
    workingSetBytes: { median: 508000000, maximum: 515000000 },
    installerBytes: { median: 160000000, maximum: 160000000 },
  });
  expect(() => summarize(measurements.slice(1))).toThrow('FIVE_RUNS_REQUIRED');
});

test('green runner medians pass calibrated limits and each planted excess has a closed metric code', () => {
  expect(releaseBudgets).toEqual({
    startupMs: 2678,
    workingSetBytes: 556307252,
    installerBytes: 194314092,
  });
  const green = summarize(
    Array.from({ length: 5 }, () => ({
      startupMs: 2231,
      workingSetBytes: 455528448,
      installerBytes: 161928410,
    })),
  );
  expect(releaseChecks.checkRelease(green, releaseBudgets, true)).toBe(
    'enforce',
  );
  for (const key of [
    'startupMs',
    'workingSetBytes',
    'installerBytes',
  ] as const) {
    const planted = {
      ...green,
      [key]: {
        median: releaseBudgets[key] + 1,
        maximum: releaseBudgets[key] + 1,
      },
    };
    expect(() =>
      releaseChecks.checkRelease(planted, releaseBudgets, true),
    ).toThrow(`BUDGET_EXCEEDED:${key}`);
    try {
      releaseChecks.checkRelease(planted, releaseBudgets, true);
      throw new Error('BUDGET_WAS_NOT_ENFORCED');
    } catch (error) {
      expect(error).toHaveProperty('code', releaseChecks.budgetCodes[key]);
    }
    expect(releaseBudgets[key]).toBe(
      Math.ceil(
        Math.max(
          ...releaseBudgetCalibration.sources.map((row) => row.medians[key]),
        ) * 1.2,
      ),
    );
  }
  expect(releaseBudgetCalibration.metrics.startupMs.samples).toBe(15);
  expect(releaseBudgetCalibration.metrics.workingSetBytes.samples).toBe(15);
  expect(releaseBudgetCalibration.metrics.installerBytes.samples).toBe(3);
  expect(releaseBudgetCalibration.provisional).toBe(false);
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
