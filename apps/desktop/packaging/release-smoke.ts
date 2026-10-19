import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { promisify } from 'node:util';
import { z } from 'zod';
import { directory, dist, executable } from './paths.ts';
import { artifacts, releaseVersion } from './release.ts';
import { assertFuses } from './fuses.ts';
import { assertBudgets, summarize, checkRelease } from './release-checks.ts';
import { releaseBudgets } from './release-budgets.ts';
import type { Measurement } from './release-checks.ts';
import { compareSystemSnapshots, systemSnapshot } from './system-check.ts';
import type { SystemComparison } from './system-check.ts';
import { generatedWorkspace } from '../test/workspace.ts';
import { appProcesses } from '../test/windows.ts';
import { assertNsisTemp } from './release-temp.ts';
import { assertNoOwnedNetwork, watchNetwork } from './network-check.ts';
import { systemTokenProof } from '../e2e/system-proof.ts';
import { proofOutput } from '../e2e/proof-context.ts';
import { proofWorkspace } from '../e2e/proof-context.ts';
import { failureRecord } from '../e2e/proof-failure.ts';
import { root } from './paths.ts';

const run = promisify(execFile);
const LayoutSchema = z.strictObject({
  install: z.string(),
  installExists: z.boolean(),
  updateExists: z.boolean(),
  data: z.string(),
  dataExists: z.boolean(),
  shortcuts: z.array(z.string()),
  existingShortcuts: z.array(z.string()),
  registrationExists: z.boolean(),
  uninstallCommand: z.string().nullable(),
  quietUninstallCommand: z.string().nullable(),
  registrations: z.array(z.string()),
  absent: z.array(z.string()),
});
async function powershell(
  script: string,
  args: string[] = [],
  timeout = 60_000,
) {
  return run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'packaging', script),
      ...args,
    ],
    { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
}
async function layout() {
  return LayoutSchema.parse(
    JSON.parse((await powershell('install-layout.ps1')).stdout),
  );
}
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

if (process.platform !== 'win32')
  throw new Error('WINDOWS_RELEASE_SMOKE_REQUIRED');
const calibration = releaseBudgets === null;
const requireCalibration = process.argv.includes('--require-budgets');
if (process.argv.includes('--measure'))
  throw new Error('EXPLICIT_MEASURE_REFUSED');
// Closed CI metadata keys only. Never read or enumerate credentials.
/* eslint-disable no-restricted-properties -- CI source identity and summary destination, not keys. */
const runnerEnvironment = {
  github: process.env.GITHUB_ACTIONS === 'true',
  os: process.env.RUNNER_OS,
  image: process.env.ImageOS,
  imageVersion: process.env.ImageVersion,
  sha: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID,
  summary: process.env.GITHUB_STEP_SUMMARY,
};
/* eslint-enable no-restricted-properties */
const version = await releaseVersion();
const setup = join(artifacts, `SocialPrune-Setup-${version}.exe`);
const beforeLayout = await layout();
assert.equal(beforeLayout.installExists, false, 'EXISTING_INSTALL_REFUSED');
assert.equal(beforeLayout.dataExists, false, 'EXISTING_DATA_REFUSED');
assert.equal(beforeLayout.updateExists, false, 'EXISTING_UPDATER_REFUSED');
assert.deepEqual(
  beforeLayout.existingShortcuts,
  [],
  'EXISTING_SHORTCUT_REFUSED',
);
assert.equal(
  beforeLayout.registrationExists,
  false,
  'EXISTING_REGISTRATION_REFUSED',
);
const tokenProof = await systemTokenProof('smoke');
const initial = await systemSnapshot();
const data = await mkdtemp(join(tmpdir(), 'socialprune-release-generated-'));
const installerTemp = join(data, 'installer-temp');
await mkdir(installerTemp);
const installerEnv = {
  // eslint-disable-next-line no-restricted-properties -- Explicit Windows directory only; no key access or environment enumeration.
  SystemRoot: process.env.SystemRoot,
  TEMP: installerTemp,
  TMP: installerTemp,
};
const count = await generatedWorkspace(data);
const installedExe = join(beforeLayout.install, 'SocialPrune.exe');
const updater = join(beforeLayout.install, 'Uninstall.exe');
const network = await watchNetwork(
  beforeLayout.install,
  proofOutput('release-network.json'),
);
let networkObservation: Awaited<ReturnType<typeof network.stop>> | undefined;
let tempCopies: Awaited<ReturnType<typeof assertNsisTemp>> = [];
let attemptedInstall = false;
const samples: Measurement[] = [];
const snapshots: unknown[] = [{ phase: 'before-install', snapshot: initial }];
const differences: string[] = [];
const systemComparisons: ({ phase: string } & SystemComparison)[] = [];
const compareSystem = async (
  phase: string,
  snapshot: Awaited<ReturnType<typeof systemSnapshot>>,
) => {
  const comparison = compareSystemSnapshots(initial, snapshot);
  systemComparisons.push({ phase, ...comparison });
  for (const failure of comparison.failures)
    differences.push(
      `SYSTEM_CHANGED:${failure.inventory}:${JSON.stringify(failure)}`,
    );
  // Preserve diagnostics immediately, including when a later launch fails.
  await writeFile(
    proofOutput('release-system.json'),
    JSON.stringify(
      { snapshots, comparisons: systemComparisons, tokenProof },
      null,
      2,
    ),
  );
};
let primaryFailure: Error | undefined;
try {
  attemptedInstall = true;
  await run(setup, ['/S'], {
    timeout: 180_000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    env: installerEnv,
  });
  await access(installedExe);
  await assertFuses(installedExe, false);
  assert.equal(
    hash(await readFile(installedExe)),
    hash(await readFile(executable('release'))),
    'INSTALLED_EXE_DIFFERS',
  );
  assert.equal(
    hash(await readFile(join(beforeLayout.install, 'resources/app.asar'))),
    hash(await readFile(join(dist, 'release/resources/app.asar'))),
    'INSTALLED_ASAR_DIFFERS',
  );
  const installed = await layout();
  assert.equal(installed.updateExists, false, 'UNEXPECTED_UPDATER');
  assert.equal(
    installed.registrationExists,
    true,
    'UNINSTALL_REGISTRATION_MISSING',
  );
  assert.equal(
    installed.existingShortcuts.length,
    1,
    'START_MENU_SHORTCUT_MISSING',
  );
  const registrationDeadline = Date.now() + 30_000;
  let registered = installed;
  while (
    registered.uninstallCommand !== `"${updater}"` &&
    Date.now() < registrationDeadline
  ) {
    await wait(250);
    registered = await layout();
  }
  assert.equal(
    registered.uninstallCommand,
    `"${updater}"`,
    'WINDOWS_SETTINGS_UNINSTALL_WIRING',
  );
  for (let index = 0; index < 5; index++) {
    const started = Date.now();
    const child = spawn(
      installedExe,
      [`--data-dir=${data}`, '--force-renderer-accessibility'],
      { stdio: 'pipe', windowsHide: false },
    );
    let errors = '';
    child.stdout.resume();
    child.stderr.on('data', (bytes: Buffer) => {
      errors += bytes.toString();
    });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    try {
      if (!child.pid) throw new Error('RELEASE_PID_MISSING');
      const { stdout } = await powershell('release-window.ps1', [
        '-AppProcessId',
        String(child.pid),
        '-Executable',
        installedExe,
      ]);
      const sample = z
        .strictObject({
          interactiveAt: z.number(),
          workingSetBytes: z.number().positive(),
          processCount: z.number().positive(),
          title: z.literal('SocialPrune'),
          enabledReviewActionFocused: z.literal(true),
        })
        .parse(JSON.parse(stdout));
      const running = await systemSnapshot();
      snapshots.push({ phase: `running-${index + 1}`, snapshot: running });
      await compareSystem(`running-${index + 1}`, running);
      samples.push({
        startupMs: sample.interactiveAt - started,
        workingSetBytes: sample.workingSetBytes,
        installerBytes: (await stat(setup)).size,
      });
      await writeFile(
        proofOutput('release-samples.json'),
        JSON.stringify(samples, null, 2),
      );
      await powershell('release-window.ps1', [
        '-AppProcessId',
        String(child.pid),
        '-Executable',
        installedExe,
        '-CloseOnly',
      ]);
      assert.equal(
        await Promise.race([
          exited,
          wait(30_000, undefined, { ref: false }).then(() => 'timeout'),
        ]),
        0,
        'RELEASE_CLOSE_FAILED',
      );
      assert.deepEqual(
        await appProcesses(installedExe),
        [],
        'RELEASE_CHILD_REMAINS',
      );
      assert.doesNotMatch(
        errors,
        /DESKTOP_START_FAILED|DESKTOP_LOG_WRITE_FAILED|Debugger listening|INSTALL_LIFECYCLE_FAILED/,
      );
    } finally {
      if (child.exitCode === null) {
        await powershell('release-window.ps1', [
          '-AppProcessId',
          String(child.pid),
          '-Executable',
          installedExe,
          '-CloseOnly',
        ]).catch(() => child.kill());
        await exited;
      }
    }
  }
} catch (error) {
  primaryFailure = error instanceof Error ? error : new Error(String(error));
  console.error(error);
  await writeFile(
    proofOutput('release-failure.json'),
    JSON.stringify(
      failureRecord(
        error,
        root,
        proofWorkspace(),
        join(directory, 'packaging/release-smoke.ts'),
      ),
      null,
      2,
    ),
  );
} finally {
  try {
    // Attempt cleanup even when installation or the boundary assertion fails.
    // Ownership was established by absence before this exact generated install.
    if (attemptedInstall) {
      try {
        await access(updater);
        const uninstallerHash = hash(await readFile(updater));
        await run(updater, ['/S'], {
          timeout: 120_000,
          windowsHide: true,
          env: installerEnv,
        });
        const deadline = Date.now() + 30_000;
        while ((await layout()).registrationExists && Date.now() < deadline)
          await wait(100);
        await wait(500);
        tempCopies = await assertNsisTemp(installerTemp, 1, uninstallerHash);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'ENOENT' ||
          (await layout()).installExists
        )
          throw error;
      }
      const deadline = Date.now() + 150_000;
      let remaining = await layout();
      while (
        (remaining.installExists ||
          remaining.updateExists ||
          remaining.existingShortcuts.length ||
          remaining.registrationExists) &&
        Date.now() < deadline
      ) {
        await wait(500);
        remaining = await layout();
      }
      await writeFile(
        proofOutput('release-cleanup.json'),
        JSON.stringify(remaining, null, 2),
      );
      assert.equal(remaining.installExists, false, 'PROGRAM_FOLDER_REMAINS');
      assert.equal(remaining.updateExists, false, 'UPDATE_EXE_REMAINS');
      assert.deepEqual(
        remaining.existingShortcuts,
        [],
        'START_MENU_ENTRY_REMAINS',
      );
      assert.equal(
        remaining.registrationExists,
        false,
        'UNINSTALL_REGISTRATION_REMAINS',
      );
      assert.deepEqual(await appProcesses(installedExe), []);
    }
    const after = await systemSnapshot();
    snapshots.push({ phase: 'after-uninstall', snapshot: after });
    await compareSystem('after-uninstall', after);
  } finally {
    networkObservation = await network.stop();
    await rm(data, { recursive: true, force: true });
  }
}
if (primaryFailure) throw primaryFailure;
if (!networkObservation) throw new Error('NETWORK_OBSERVATION_MISSING');
assertNoOwnedNetwork(networkObservation);
const summary = summarize(samples);
// These controls use this run's actual measurements, never an earlier file.
for (const key of ['startupMs', 'workingSetBytes', 'installerBytes'] as const) {
  const budgets = {
    startupMs: summary.startupMs.maximum + 1,
    workingSetBytes: summary.workingSetBytes.maximum + 1,
    installerBytes: summary.installerBytes.maximum + 1,
  };
  assert.throws(
    () =>
      assertBudgets(summary, { ...budgets, [key]: summary[key].median - 1 }),
    new RegExp(`BUDGET_EXCEEDED:${key}`),
  );
}
const report = {
  proof: calibration ? 'release-budget-measurement' : 'installed-release-smoke',
  measuredAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  environment: runnerEnvironment.github ? 'github-actions' : 'workstation',
  runner: runnerEnvironment.github
    ? {
        os: runnerEnvironment.os,
        image: runnerEnvironment.image,
        imageVersion: runnerEnvironment.imageVersion,
        sha: runnerEnvironment.sha,
        runId: runnerEnvironment.runId,
      }
    : null,
  version,
  items: count,
  installerSha256: hash(await readFile(setup)),
  asarSha256: hash(await readFile(join(dist, 'release/resources/app.asar'))),
  samples,
  network: networkObservation,
  tempCopies,
  summary,
  systemInvariantPassed: differences.length === 0,
  programFolderRemoved: true,
  startMenuEntryRemoved: true,
  noUpdater: true,
  remainingOwnedProcesses: 0,
  systemDifferences: differences,
  systemComparisons,
  tokenProof,
};
await writeFile(
  proofOutput('release-smoke.json'),
  JSON.stringify(report, null, 2),
);
await writeFile(
  proofOutput('release-medians.json'),
  JSON.stringify(
    {
      measuredAt: report.measuredAt,
      runner: report.runner,
      summary,
      budgets: releaseBudgets,
      mode: calibration ? 'measure' : 'enforce',
    },
    null,
    2,
  ),
);
if (runnerEnvironment.summary) {
  const lines = [
    '## Installed desktop measurements',
    '',
    `Mode: ${calibration ? 'measure only; no budget enforcement' : 'runner budget enforcement'}. Five installed launches on ${report.environment}.`,
    '',
    '| Metric | Median | Maximum | Median + 20% |',
    '|---|---:|---:|---:|',
  ];
  for (const key of ['startupMs', 'workingSetBytes', 'installerBytes'] as const)
    lines.push(
      `| ${key} | ${summary[key].median} | ${summary[key].maximum} | ${Math.ceil(summary[key].median * 1.2)} |`,
    );
  await appendFile(runnerEnvironment.summary, lines.join('\n') + '\n');
}
checkRelease(summary, releaseBudgets, requireCalibration);
if (differences.length) throw new Error(differences.join('\n'));
console.log(JSON.stringify(report));
