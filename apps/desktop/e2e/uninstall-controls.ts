import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { directory } from '../packaging/paths.ts';
import { fetchNsis } from '../packaging/nsis-fetch.ts';
import { proofOutput, proofWorkspace } from './proof-context.ts';
import { releaseVersion, artifacts } from '../packaging/release.ts';
import { generatedWorkspace } from '../test/workspace.ts';
import { appProcesses } from '../test/windows.ts';
import {
  compareSystemSnapshots,
  systemSnapshot,
} from '../packaging/system-check.ts';
import {
  assertNoOwnedNetwork,
  watchNetwork,
} from '../packaging/network-check.ts';
import { assertNsisTemp } from '../packaging/release-temp.ts';
import { buildNsis } from '../packaging/nsis.ts';
import { systemTokenProof, systemTaskControl } from './system-proof.ts';
import { pathExists } from '../packaging/file-presence.ts';
import { failureRecord } from './proof-failure.ts';
import { root } from '../packaging/paths.ts';

// Only this test entrypoint plants files/links. The shipped builder and app
// never import it. All roots must be absent before this run claims ownership.
const run = promisify(execFile);
const ps = (script: string, args: string[] = []) =>
  run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'packaging', script),
      ...args,
    ],
    { timeout: 60_000, windowsHide: true },
  );
type Layout = {
  install: string;
  data: string;
  installExists: boolean;
  dataExists: boolean;
  registrationExists: boolean;
  uninstallCommand: string | null;
  quietUninstallCommand: string | null;
  existingShortcuts: string[];
  registrations: string[];
};
const layout = async () =>
  JSON.parse((await ps('install-layout.ps1')).stdout) as Layout;
const initial = await layout();
assert.equal(initial.installExists, false, 'EXISTING_INSTALL_REFUSED');
assert.equal(initial.dataExists, false, 'EXISTING_DATA_REFUSED');
assert.equal(
  initial.registrationExists,
  false,
  'EXISTING_REGISTRATION_REFUSED',
);
assert.deepEqual(initial.existingShortcuts, [], 'EXISTING_SHORTCUT_REFUSED');
const scratch = await mkdtemp(join(tmpdir(), 'socialprune-installer-proof-'));
const referenceProof = JSON.parse(
  (
    await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        join(directory, 'e2e/system-reference-control.ps1'),
        '-RunRoot',
        scratch,
      ],
      { timeout: 30_000, windowsHide: true },
    )
  ).stdout,
) as unknown;
// Each installer and its children inherit one empty, run-owned OS temp folder.
// No foreign temp tree is traversed or deleted. Any NSIS residue is visible in
// full here, without racing unrelated processes on the maintainer's machine.
const installerTemp = join(scratch, 'installer-temp');
await mkdir(installerTemp);
const installerEnv = {
  // No environment copy or key access. Only Windows' executable/DLL lookup is
  // inherited explicitly; the installers need no PATH or credentials.
  // eslint-disable-next-line no-restricted-properties -- Windows directory, not a key.
  SystemRoot: process.env.SystemRoot,
  // eslint-disable-next-line no-restricted-properties -- Windows directory, not a key.
  windir: process.env.windir,
  TEMP: installerTemp,
  TMP: installerTemp,
};
const outside = join(scratch, 'outside');
const program = initial.install;
const exe = join(program, 'SocialPrune.exe');
const uninstall = join(program, 'Uninstall.exe');
const setup = join(
  artifacts,
  `SocialPrune-Setup-${await releaseVersion()}.exe`,
);
const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const exists = pathExists;
const proof: string[] = [];
const tempSnapshot = async () => (await readdir(installerTemp)).sort();
const [tokenProof, taskControl, initialSystem] = await (async () => {
  const tokenProof = await systemTokenProof('controls');
  const taskControl = await systemTaskControl();
  return [tokenProof, taskControl, await systemSnapshot()] as const;
})().catch(async (error: unknown) => {
  // No install has started; only the exact scratch root belongs to this run.
  await rm(scratch, { recursive: true, force: true });
  throw error;
});
const network = await watchNetwork(program, join(scratch, 'network.json'));
const systemComparisons: {
  phase: string;
  failures: import('../packaging/system-check.ts').SystemChange[];
  diagnostics: import('../packaging/system-check.ts').SystemChange[];
}[] = [];
async function compareSystem(
  phase: string,
  before: Awaited<ReturnType<typeof systemSnapshot>>,
  after: Awaited<ReturnType<typeof systemSnapshot>>,
) {
  const comparison = compareSystemSnapshots(before, after);
  systemComparisons.push({ phase, ...comparison });
  await writeFile(
    proofOutput('release-uninstaller-system.json'),
    JSON.stringify({ comparisons: systemComparisons, tokenProof }, null, 2),
  );
  if (comparison.failures.length)
    throw new Error(
      `SYSTEM_CHANGED:${comparison.failures[0]!.inventory}:${JSON.stringify(comparison.failures)}`,
    );
}
let uninstallCount = 0;
let uninstallerHash = '';
let tempCopies: Awaited<ReturnType<typeof assertNsisTemp>> = [];
const refusalExits: Record<string, number | number[]> = {};
async function refusal(
  file: string,
  args: string[],
  expected: number,
  key: string,
) {
  let code = 0;
  try {
    await run(file, args, {
      timeout: 60_000,
      windowsHide: true,
      env: installerEnv,
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      typeof error.code !== 'number'
    )
      throw error;
    code = error.code;
  }
  refusalExits[key] = code;
  assert.equal(code, expected, `REFUSAL_EXIT:${key}`);
}
async function installedSnapshot() {
  const rows = JSON.parse(
    await readFile(join(program, 'installed-files.json'), 'utf8'),
  ) as { path: string }[];
  return {
    layout: await layout(),
    registration: JSON.parse(
      (await ps('installer-proof.ps1', ['-Action', 'registration'])).stdout,
    ) as unknown,
    files: await Promise.all(
      [
        ...rows.map((row) => row.path),
        'installed-files.json',
        'Uninstall.exe',
      ].map(async (path) => [
        path,
        digest(await readFile(join(program, path))),
      ]),
    ),
  };
}
async function install() {
  await run(setup, ['/S'], {
    timeout: 120_000,
    windowsHide: true,
    env: installerEnv,
  });
  await access(exe);
}
async function remove() {
  uninstallerHash = digest(await readFile(uninstall));
  // NSIS's outer uninstaller returns before its temp child. Poll the owned
  // registration and files, not a guessed sleep or a successful launch code.
  await run(uninstall, ['/S'], {
    timeout: 60_000,
    windowsHide: true,
    env: installerEnv,
  });
  const deadline = Date.now() + 30_000;
  while ((await layout()).registrationExists && Date.now() < deadline)
    await wait(100);
  assert.equal(
    (await layout()).registrationExists,
    false,
    'UNINSTALL_REGISTRATION_REMAINS',
  );
  while ((await exists(uninstall)) && Date.now() < deadline) await wait(100);
  assert.equal(await exists(uninstall), false, 'UNINSTALLER_REMAINS');
  await wait(1000);
  uninstallCount++;
  tempCopies = await assertNsisTemp(
    installerTemp,
    uninstallCount,
    uninstallerHash,
  );
}
let app: ReturnType<typeof spawn> | undefined;
let dataOwned = false;
let programOwned = false;
try {
  await mkdir(outside);
  await writeFile(join(outside, 'target.txt'), 'generated external target');
  const redirect = join(scratch, 'SocialPrune');
  await refusal(setup, ['/S', `/D=${redirect}`], 10, 'setup-redirect');
  assert.equal(await exists(redirect), false, 'SETUP_REDIRECT_TOUCHED');
  proof.push('Setup /D= scratch refused with exit 10; scratch target absent');
  programOwned = true;
  await install();
  const before = await installedSnapshot();
  const elevatedProof = process.argv
    .find((arg) => arg.startsWith('--elevated-proof='))
    ?.slice('--elevated-proof='.length);
  if (elevatedProof) {
    await writeFile(join(elevatedProof, 'installed.ready'), 'installed');
    const deadline = Date.now() + 90_000;
    while (
      !(await exists(join(elevatedProof, 'refused.ready'))) &&
      Date.now() < deadline
    )
      await wait(50);
    assert.equal(
      await exists(join(elevatedProof, 'refused.ready')),
      true,
      'ELEVATED_UNINSTALL_PROOF_MISSING',
    );
    assert.deepEqual(
      await installedSnapshot(),
      before,
      'ELEVATED_UNINSTALL_CHANGED_FILES',
    );
    refusalExits['uninstall-elevated-direct'] = 10;
  }
  await install();
  const over = await installedSnapshot();
  assert.deepEqual(over, before, 'INSTALL_OVER_INSTALL_CHANGED');
  assert.deepEqual(over.layout.registrations, [`SocialPrune|"${uninstall}"`]);
  proof.push(
    'install-over-install: one registration names current uninstaller; listed hashes unchanged',
  );
  // Build-only injected input lists. The shipped installer has no test flags.
  const variants = join(scratch, 'variants');
  await mkdir(variants);
  const inputA = join(variants, 'a');
  const inputB = join(variants, 'b');
  await mkdir(inputA);
  await mkdir(inputB);
  await writeFile(join(inputA, 'old.txt'), 'generated old file');
  await writeFile(join(inputA, 'common.txt'), 'generated common file');
  await writeFile(join(inputB, 'new.txt'), 'generated new file');
  await writeFile(join(inputB, 'common.txt'), 'generated common file');
  const installerA = join(variants, 'A.exe');
  const installerB = join(variants, 'B.exe');
  const history = ['common.txt', 'old.txt', 'new.txt'];
  await buildNsis(inputA, installerA, '0.0.1', {
    fetch: () => fetchNsis(undefined, { workspace: proofWorkspace() }),
    history,
    previous: history,
    generated: join(variants, 'gen-a'),
  });
  await buildNsis(inputB, installerB, '0.0.2', {
    fetch: () => fetchNsis(undefined, { workspace: proofWorkspace() }),
    history,
    previous: history,
    generated: join(variants, 'gen-b'),
  });
  await remove();
  assert.equal(await exists(program), false);
  await rm(installerTemp, { recursive: true });
  await mkdir(installerTemp);
  uninstallCount = 0;
  await run(installerA, ['/S'], { timeout: 120_000, env: installerEnv });
  await writeFile(join(program, 'planted-upgrade.txt'), 'generated keep');
  await run(installerB, ['/S'], { timeout: 120_000, env: installerEnv });
  assert.equal(
    await exists(join(program, 'old.txt')),
    false,
    'UPGRADE_OLD_FILE_REMAINS',
  );
  assert.equal(
    await readFile(join(program, 'new.txt'), 'utf8'),
    'generated new file',
  );
  assert.equal((await layout()).registrations.length, 1);
  // Remove the synthetic variant before resuming the real installer proof.
  await remove();
  assert.equal(
    await readFile(join(program, 'planted-upgrade.txt'), 'utf8'),
    'generated keep',
  );
  await unlink(join(program, 'planted-upgrade.txt'));
  await rmdir(program);
  assert.equal(await exists(program), false, 'UPGRADE_PROGRAM_REMAINS');
  proof.push(
    'A old/common, B new/common: old removed before B writes, one registration, planted file kept, final program folder absent',
  );
  await rm(installerTemp, { recursive: true });
  await mkdir(installerTemp);
  uninstallCount = 0;
  await install();
  const restoredBefore = await installedSnapshot();
  // A lock that permits reads but not deletion is not an app-running check.
  // Exercise the partial list branch and retain the Apps repair/removal route.
  const lockReady = join(scratch, 'lock.ready');
  const lockStop = join(scratch, 'lock.stop');
  const locked = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'e2e/locked-file.ps1'),
      '-Path',
      join(program, 'LICENSE'),
      '-Ready',
      lockReady,
      '-Stop',
      lockStop,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  const lockExited = new Promise<number | null>((resolve, reject) => {
    locked.once('error', reject);
    locked.once('exit', resolve);
  });
  locked.stdout.resume();
  locked.stderr.pipe(process.stderr);
  try {
    const deadline = Date.now() + 15_000;
    while (
      !(await exists(lockReady)) &&
      Date.now() < deadline &&
      locked.exitCode === null
    )
      await wait(50);
    assert.equal(await exists(lockReady), true, 'LOCK_NOT_READY');
    const registered = await layout();
    await refusal(
      uninstall,
      ['/S', `_?=${program}`],
      12,
      'locked-listed-file-direct',
    );
    assert.equal(
      (await layout()).registrationExists,
      true,
      'PARTIAL_REGISTRATION_REMOVED',
    );
    assert.deepEqual(
      (await layout()).existingShortcuts,
      registered.existingShortcuts,
      'PARTIAL_SHORTCUT_REMOVED',
    );
    assert.equal(
      await exists(join(program, 'LICENSE')),
      true,
      'LOCKED_FILE_REMOVED',
    );
    assert.equal(await exists(uninstall), true, 'PARTIAL_UNINSTALLER_REMOVED');
    proof.push(
      'locked LICENSE without delete sharing: direct uninstaller exits 12, listed file, registration, shortcut and uninstaller remain',
    );
  } finally {
    await writeFile(lockStop, 'stop');
    assert.equal(await lockExited, 0);
  }
  await install();
  assert.deepEqual(await installedSnapshot(), restoredBefore);
  // Junction at the root, not merely below it. Run the uninstaller through a
  // moved copy with its fixed _?= root so init reaches the same root guard.
  const ownedProgram = join(scratch, 'owned-program');
  const rootUninstaller = join(scratch, 'root-uninstall.exe');
  await copyFile(uninstall, rootUninstaller);
  await rename(program, ownedProgram);
  await symlink(outside, program, 'junction');
  try {
    await refusal(setup, ['/S'], 10, 'setup-root-junction');
    await refusal(
      rootUninstaller,
      ['/S', `_?=${program}`],
      10,
      'uninstall-root-junction',
    );
    assert.deepEqual(await readdir(outside), ['target.txt']);
    assert.equal(
      await readFile(join(outside, 'target.txt'), 'utf8'),
      'generated external target',
    );
  } finally {
    await unlink(program);
    await rename(ownedProgram, program);
  }
  assert.deepEqual(await installedSnapshot(), restoredBefore);
  proof.push(
    'root junction: Setup and direct uninstaller exit 10, target and restored install unchanged',
  );
  const moved = join(scratch, 'Uninstall.exe');
  await copyFile(uninstall, moved);
  await assert.rejects(
    run(moved, ['/S', `_?=${outside}`], {
      timeout: 60_000,
      windowsHide: true,
      env: installerEnv,
    }),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 10,
  );
  assert.equal(
    await readFile(join(outside, 'target.txt'), 'utf8'),
    'generated external target',
  );
  assert.deepEqual(await installedSnapshot(), restoredBefore);
  proof.push(
    'moved uninstaller and _?= decoy root refuse with exit 10; decoy and install unchanged',
  );
  const generated = join(scratch, 'generated');
  await generatedWorkspace(generated);
  app = spawn(
    exe,
    [`--data-dir=${generated}`, '--force-renderer-accessibility'],
    { stdio: 'ignore', env: installerEnv },
  );
  if (!app.pid) throw new Error('APP_PID_MISSING');
  await ps('release-window.ps1', [
    '-AppProcessId',
    String(app.pid),
    '-Executable',
    exe,
  ]);
  const runningBefore = await installedSnapshot();
  const runningSystem = await systemSnapshot();
  const runningTemp = await tempSnapshot();
  const pids = (await appProcesses(exe)).map((row) => row.ProcessId).sort();
  await assert.rejects(
    run(setup, ['/S'], {
      timeout: 60_000,
      windowsHide: true,
      env: installerEnv,
    }),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 10,
  );
  refusalExits['setup-running'] = 10;
  // _?= suppresses NSIS's temp child for this refusal-only invocation, so the
  // real uninstaller's exit code is observed. Its fixed-root guard still runs.
  await assert.rejects(
    run(uninstall, ['/S', `_?=${program}`], {
      timeout: 60_000,
      windowsHide: true,
      env: installerEnv,
    }),
    (error: unknown) =>
      error instanceof Error && 'code' in error && error.code === 10,
  );
  refusalExits['uninstall-running-direct'] = 10;
  await wait(1500);
  assert.deepEqual(
    await installedSnapshot(),
    runningBefore,
    'RUNNING_REFUSAL_CHANGED_FILES_OR_REGISTRATION',
  );
  assert.deepEqual(
    (await appProcesses(exe)).map((row) => row.ProcessId).sort(),
    pids,
    'RUNNING_APP_ENDED',
  );
  await compareSystem('running-refusal', runningSystem, await systemSnapshot());
  assert.deepEqual(
    await tempSnapshot(),
    runningTemp,
    'RUNNING_REFUSAL_TEMP_CHANGED',
  );
  proof.push(
    'running app: setup and uninstaller exit 10; hashes, registration, PIDs, temp and system inventory unchanged',
  );
  // Exercise exactly the registered quiet command, including its temp child.
  const quiet = (await layout()).quietUninstallCommand;
  assert.equal(quiet, `"${uninstall}" /S`);
  const quietHash = digest(await readFile(uninstall));
  const quietBefore = await tempSnapshot();
  const childReady = join(scratch, 'child-watch.ready');
  const childWatcher = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'packaging/uninstaller-children.ps1'),
      '-TempRoot',
      installerTemp,
      '-Ready',
      childReady,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let childOutput = '',
    childErrors = '';
  childWatcher.stdout.on('data', (bytes: Buffer) => {
    childOutput += bytes.toString();
  });
  childWatcher.stderr.on('data', (bytes: Buffer) => {
    childErrors += bytes.toString();
  });
  const watcherExited = new Promise<number | null>((resolve, reject) => {
    childWatcher.once('error', reject);
    childWatcher.once('exit', resolve);
  });
  const watchDeadline = Date.now() + 15_000;
  while (
    !(await exists(childReady)) &&
    Date.now() < watchDeadline &&
    childWatcher.exitCode === null
  )
    await wait(20);
  assert.equal(await exists(childReady), true, 'NSIS_COPY_WATCH_NOT_READY');
  await refusal(uninstall, ['/S'], 0, 'uninstall-running-registered-outer');
  // Wait for the actual ~nsu executable, not the already-exited outer launch.
  assert.equal(await watcherExited, 0, childErrors);
  const childProof = JSON.parse(childOutput) as {
    exitCodes: number[];
    remaining: number;
  };
  assert.equal(childProof.remaining, 0);
  assert.deepEqual(childProof.exitCodes, [10]);
  refusalExits['uninstall-running-registered-copy'] = childProof.exitCodes;
  assert.deepEqual(await installedSnapshot(), runningBefore);
  const quietAfter = await tempSnapshot();
  assert.equal(
    quietAfter.length,
    quietBefore.length + 1,
    'REGISTERED_COPY_NOT_ADDED',
  );
  await assertNsisTemp(installerTemp, 1, quietHash);
  proof.push(
    'registered QuietUninstallString: outer exits 0, watched temp copy settles, install/registration unchanged, exactly one bounded copy added',
  );
  await rm(installerTemp, { recursive: true });
  await mkdir(installerTemp);
  uninstallCount = 0;
  await ps('release-window.ps1', [
    '-AppProcessId',
    String(app.pid),
    '-Executable',
    exe,
    '-CloseOnly',
  ]);
  await new Promise<void>((resolve) => app!.once('exit', () => resolve()));
  app = undefined;
  await mkdir(initial.data);
  dataOwned = true;
  await writeFile(
    join(initial.data, 'planted-data.txt'),
    'generated data kept',
  );
  await writeFile(
    join(program, 'planted-program.txt'),
    'generated program kept',
  );
  const link = join(program, 'planted-link');
  await symlink(outside, link, 'junction');
  const tempBefore = await tempSnapshot();
  const fileRows = JSON.parse(
    await readFile(join(program, 'installed-files.json'), 'utf8'),
  ) as { path: string }[];
  await remove();
  for (const row of fileRows)
    assert.equal(
      await exists(join(program, row.path)),
      false,
      `LISTED_FILE_REMAINS:${row.path}`,
    );
  assert.equal(await exists(join(program, 'installed-files.json')), false);
  assert.equal(
    await readFile(join(program, 'planted-program.txt'), 'utf8'),
    'generated program kept',
  );
  assert.equal(
    await readFile(join(initial.data, 'planted-data.txt'), 'utf8'),
    'generated data kept',
  );
  assert.equal(
    await readFile(join(link, 'target.txt'), 'utf8'),
    'generated external target',
  );
  assert.equal(
    await readFile(join(outside, 'target.txt'), 'utf8'),
    'generated external target',
  );
  tempCopies = await assertNsisTemp(installerTemp, 1, uninstallerHash);
  assert.deepEqual((await layout()).existingShortcuts, []);
  assert.equal(tempBefore.length, 0, 'UNEXPECTED_PRE_UNINSTALL_TEMP');
  assert.equal(tempCopies.length, 1, 'ONE_NSIS_COPY_REQUIRED');
  const plantedTemp = join(installerTemp, 'planted-extra.txt');
  await writeFile(plantedTemp, 'generated unexpected file');
  await assert.rejects(
    assertNsisTemp(installerTemp, 1, uninstallerHash),
    /NSIS_TEMP_EXTRA_ENTRY/,
  );
  await unlink(plantedTemp);
  console.log(
    'RED_CONTROL: planted extra temp file rejected by real uninstall temp proof',
  );
  proof.push(
    'planted program file, data file, junction and external target kept; every listed file removed; one hash-identical NSIS temp copy only',
  );
  await unlink(link);
  await unlink(join(program, 'planted-program.txt'));
  await rmdir(program);
  await install();
  // Exercise the actual ancestor guard with a junction in a listed path.
  await rename(join(program, 'locales'), join(scratch, 'owned-locales'));
  await writeFile(join(outside, 'en-US.pak'), 'external listed-name decoy');
  await symlink(outside, join(program, 'locales'), 'junction');
  await refusal(setup, ['/S'], 11, 'setup-listed-ancestor-junction');
  assert.equal(
    await readFile(join(outside, 'en-US.pak'), 'utf8'),
    'external listed-name decoy',
  );
  await remove();
  assert.equal(
    await readFile(join(outside, 'en-US.pak'), 'utf8'),
    'external listed-name decoy',
  );
  assert.equal(
    await readFile(join(program, 'locales/en-US.pak'), 'utf8'),
    'external listed-name decoy',
  );
  await unlink(join(program, 'locales'));
  await rmdir(program);
  proof.push(
    'junction replacing listed locales directory: external listed-name decoy unchanged',
  );
  assert.ok(tempCopies.length <= 2);
  const networkResult = await network.stop();
  assertNoOwnedNetwork(networkResult);
  const afterSystem = await systemSnapshot();
  const finalComparison = compareSystemSnapshots(initialSystem, afterSystem);
  systemComparisons.push({ phase: 'after-uninstall', ...finalComparison });
  await writeFile(
    proofOutput('release-uninstaller-system.json'),
    JSON.stringify(
      {
        before: initialSystem,
        after: afterSystem,
        network: networkResult,
        tempCopies,
        comparisons: systemComparisons,
        tokenProof,
        taskControl,
        referenceProof,
      },
      null,
      2,
    ),
  );
  await writeFile(
    proofOutput('release-uninstaller.json'),
    JSON.stringify(
      {
        proof,
        refusalExits,
        tempCopies,
        uninstalls: uninstallCount,
        uninstallerSha256: uninstallerHash,
        dataKept: true,
        ownedNetwork: 'none',
        systemComparisons,
        tokenProof,
        taskControl,
        referenceProof,
      },
      null,
      2,
    ),
  );
  if (finalComparison.failures.length)
    throw new Error(
      `SYSTEM_CHANGED:${finalComparison.failures[0]!.inventory}:${JSON.stringify(finalComparison.failures)}`,
    );
  console.log(JSON.stringify({ proof: 'nsis-uninstaller', cases: proof }));
} catch (error) {
  await writeFile(
    proofOutput('release-controls-failure.json'),
    JSON.stringify(
      {
        phase: 'execute',
        failure: failureRecord(
          error,
          root,
          proofWorkspace(),
          join(directory, 'e2e/uninstall-controls.ts'),
        ),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  try {
    if (app?.pid) {
      await ps('release-window.ps1', [
        '-AppProcessId',
        String(app.pid),
        '-Executable',
        exe,
        '-CloseOnly',
      ]).catch(() => undefined);
    }
    if (programOwned && (await exists(uninstall))) await remove();
    // Exact run-created remnants only. Never recursively remove the program or
    // data root, even on a failed assertion.
    for (const path of [
      join(program, 'planted-link'),
      join(program, 'locales'),
    ]) {
      if (await exists(path)) {
        if ((await lstat(path)).isSymbolicLink()) await unlink(path);
      }
    }
    if (programOwned) {
      await unlink(join(program, 'planted-program.txt')).catch(() => undefined);
      await rmdir(program).catch(() => undefined);
    }
    if (dataOwned) {
      await unlink(join(initial.data, 'planted-data.txt'));
      await rmdir(initial.data);
    }
  } catch (error) {
    await writeFile(
      proofOutput('release-controls-cleanup-failure.json'),
      JSON.stringify(
        {
          phase: 'cleanup',
          failure: failureRecord(
            error,
            root,
            proofWorkspace(),
            join(directory, 'e2e/uninstall-controls.ts'),
          ),
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    try {
      await network.stop();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
