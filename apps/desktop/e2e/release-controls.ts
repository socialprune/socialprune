import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { directory } from '../packaging/paths.ts';
import { pathExists } from '../packaging/file-presence.ts';
import {
  WATCH_READY_TIMEOUT_MS,
  POWERSHELL_READY_TIMEOUT_MS,
} from '../packaging/query-poll.ts';
import { proofWorkspace } from './proof-context.ts';
import {
  runPowerShell,
  runNativeQuery,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { assertBudgets, summarize } from '../packaging/release-checks.ts';
import {
  assertNoOwnedNetwork,
  watchNetwork,
} from '../packaging/network-check.ts';

// Test-only entrypoint. Nothing under src/ or the release builder imports it.
for (const [variant, expected] of [
  ['--budget', 'BUDGET_EXCEEDED:startupMs'],
  ['--listener', 'OWNED_NETWORK:listener'],
  ['--temp', 'NSIS_TEMP_EXTRA_ENTRY'],
  ['--nsis-hash', 'NSIS_CHECKSUM_MISMATCH'],
  ['--nsis-compressor', 'NSIS_COMPRESSOR_REFUSED'],
] as const) {
  await assert.rejects(
    runNativeQuery(
      process.execPath,
      [
        join(directory, 'e2e/release-red.ts'),
        variant,
        `--proof-workspace=${proofWorkspace()}`,
      ],
      // Listener control owns watcher readiness + final sample; let those
      // runner-derived waits settle before this enclosing command can expire.
      {
        timeout:
          POWERSHELL_READY_TIMEOUT_MS +
          WATCH_READY_TIMEOUT_MS +
          WINDOWS_QUERY_TIMEOUT_MS,
        windowsHide: true,
      },
    ),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 1 &&
      'stderr' in error &&
      String(error.stderr).includes(expected),
  );
  console.log(`RED_CONTROL: ${variant} exited 1 with ${expected}`);
}
// Real positive control of image-path attribution. The fixed program root
// must be absent before this run creates it, and no app entry is modified.
const layout = JSON.parse(
  (
    await runPowerShell(
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        join(directory, 'packaging/install-layout.ps1'),
      ],
      { timeout: WINDOWS_QUERY_TIMEOUT_MS, windowsHide: true },
    )
  ).stdout,
) as {
  install: string;
  installExists: boolean;
  dataExists: boolean;
  registrationExists: boolean;
};
assert.equal(layout.installExists, false, 'EXISTING_INSTALL_REFUSED');
assert.equal(layout.dataExists, false, 'EXISTING_DATA_REFUSED');
assert.equal(layout.registrationExists, false, 'EXISTING_REGISTRATION_REFUSED');
const controlScratch = await mkdtemp(
  join(tmpdir(), 'socialprune-network-control-'),
);
await mkdir(layout.install, { recursive: true });
const copiedNode = join(layout.install, 'network-probe.exe');
await copyFile(process.execPath, copiedNode);
const network = await watchNetwork(
  layout.install,
  join(controlScratch, 'image-network.json'),
  [],
);
const planted = spawn(
  copiedNode,
  [join(directory, 'e2e/network-control-child.ts')],
  { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false },
);
const childExit = once(planted, 'exit');
try {
  let stdout = '';
  planted.stderr.resume();
  const ready = new Promise<void>((resolve, reject) => {
    planted.once('error', reject);
    planted.stdout.on('data', (bytes: Buffer) => {
      stdout += bytes.toString();
      if (stdout.includes('CONTROL_LISTENING')) resolve();
    });
    planted.once('exit', () =>
      reject(new Error('NETWORK_CONTROL_EXITED_EARLY')),
    );
  });
  await Promise.race([
    ready,
    wait(15_000, undefined, { ref: false }).then(() => {
      throw new Error('NETWORK_CONTROL_NOT_READY');
    }),
  ]);
  await wait(500);
  const observed = await network.stop();
  assert.ok(observed.observed.some((row) => row.includes(copiedNode)));
  assert.throws(() => assertNoOwnedNetwork(observed), /OWNED_NETWORK:listener/);
  console.log(
    'POSITIVE_CONTROL: listener from program-folder image caught without a root PID',
  );
} finally {
  planted.stdin.end('stop');
  await childExit;
  await network.stop();
  await unlink(copiedNode);
  await rmdir(layout.install);
  assert.equal(await pathExists(layout.install), false);
  await rm(controlScratch, { recursive: true, force: true });
}
// A real grandchild outside the install root must be attributed through its
// parent's observed PID and creation time, with no image-root fallback.
const descendantScratch = await mkdtemp(
  join(tmpdir(), 'socialprune-descendant-control-'),
);
const descendant = await watchNetwork(
  layout.install,
  join(descendantScratch, 'network.json'),
);
const unattributed = await watchNetwork(
  layout.install,
  join(descendantScratch, 'no-roots.json'),
  [],
);
const parent = spawn(
  process.execPath,
  [join(directory, 'e2e/network-control-parent.ts')],
  { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false },
);
const parentExited = once(parent, 'exit');
try {
  let readyText = '';
  parent.stderr.resume();
  await Promise.race([
    new Promise<void>((resolve, reject) => {
      parent.once('error', reject);
      parent.stdout.on('data', (bytes: Buffer) => {
        readyText += bytes.toString();
        if (readyText.includes('CONTROL_LISTENING')) resolve();
      });
    }),
    wait(15_000, undefined, { ref: false }).then(() => {
      throw new Error('DESCENDANT_CONTROL_NOT_READY');
    }),
  ]);
  await wait(500);
  const noRoots = await unattributed.stop();
  assert.doesNotThrow(() => assertNoOwnedNetwork(noRoots));
  console.log(
    'RED_RUN: same outside-root grandchild is missed when ancestry roots are removed',
  );
  const observed = await descendant.stop();
  assert.throws(() => assertNoOwnedNetwork(observed), /OWNED_NETWORK:listener/);
  assert.ok(
    observed.observed.some(
      (row) =>
        row.split('|')[1] === String(parent.pid) &&
        !row.toLowerCase().includes(layout.install.toLowerCase()),
    ),
  );
  console.log(
    'POSITIVE_CONTROL: real outside-root grandchild listener caught through PID/creation-time ancestry',
  );
} finally {
  parent.stdin.end('stop');
  await parentExited;
  await descendant.stop();
  await unattributed.stop();
  await rm(descendantScratch, { recursive: true, force: true });
}
const measured = {
  startupMs: 4321,
  workingSetBytes: 512000000,
  installerBytes: 161000000,
};
const summary = summarize(Array.from({ length: 5 }, () => ({ ...measured })));
for (const key of ['startupMs', 'workingSetBytes', 'installerBytes'] as const) {
  assert.throws(
    () => assertBudgets(summary, { ...measured, [key]: measured[key] - 1 }),
    new RegExp(`BUDGET_EXCEEDED:${key}`),
  );
}
console.log(
  'POSITIVE_CONTROL: all three planted budgets rejected; listener removed',
);
