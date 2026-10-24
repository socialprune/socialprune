import assert from 'node:assert/strict';
import { createWriteStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as wait } from 'node:timers/promises';
import {
  spawnPowerShell,
  runNativeQuery,
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { directory } from '../packaging/paths.ts';
import { writeAppxReadout } from './appx-readout.ts';

// Separate diagnostic PR experiment. It never changes comparison policy and a
// green diagnostic job is not release acceptance, including when a proof fails.
const arm = process.argv[2];
assert.ok(
  ['idle', 'restricted', 'installed'].includes(arm ?? ''),
  'APPX_DIAGNOSTIC_ARM',
);
/* eslint-disable no-restricted-properties -- Explicit CI diagnostic admission and output switch, never credentials. */
assert.equal(
  process.env.GITHUB_ACTIONS,
  'true',
  'APPX_DIAGNOSTIC_RUNNER_REQUIRED',
);
assert.equal(
  process.env.RUNNER_OS,
  'Windows',
  'APPX_DIAGNOSTIC_RUNNER_REQUIRED',
);
const output = resolve(process.env.SP_APPX_DIAGNOSTIC_ROOT ?? '');
assert.ok(
  process.env.SP_APPX_DIAGNOSTIC_ROOT,
  'APPX_DIAGNOSTIC_OUTPUT_REQUIRED',
);
/* eslint-enable no-restricted-properties */
await mkdir(output, { recursive: true });
const terms = { diagnosticOnly: true, acceptanceProof: false, arm };
const workDeadline = Date.now() + 1140_000;
await writeFile(join(output, 'terms.json'), JSON.stringify(terms));
const stream = createWriteStream(join(output, 'observations.jsonl'));
const observer = spawnPowerShell(
  [
    '-NoProfile',
    '-NonInteractive',
    '-File',
    join(directory, 'e2e/appx-observe.ps1'),
    '-Seconds',
    '1200',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 1260_000 },
);
let errors = '';
let pending = '';
let observerReady = false;
let observerBytes = 0;
observer.stdout.on('data', (bytes: Buffer) => {
  observerBytes += bytes.length;
  if (observerBytes > 128 * 1024 * 1024) {
    errors = 'APPX_OBSERVATION_BYTE_LIMIT';
    observer.kill();
  }
  pending += bytes.toString();
  for (
    let end = pending.indexOf('\n');
    end !== -1;
    end = pending.indexOf('\n')
  ) {
    const line = pending.slice(0, end);
    pending = pending.slice(end + 1);
    try {
      const record = JSON.parse(line) as { kind?: string; initial?: boolean };
      if (record.kind === 'firewall' && record.initial) observerReady = true;
    } catch {
      errors = 'APPX_OBSERVATION_INVALID_JSON';
      observer.kill();
    }
  }
});
observer.stdout.pipe(stream);
stream.on('error', () => observer.kill());
observer.stderr.on('data', (bytes: Buffer) => {
  errors = (errors + bytes.toString()).slice(-4096);
});
const observed = new Promise<number | null>((resolve, reject) => {
  observer.once('error', reject);
  observer.once('close', resolve);
});
const phase = async (name: string) => {
  const at = Date.now();
  await writeFile(
    join(output, `phase-${at}-${process.pid}-${name}.json`),
    JSON.stringify({ ...terms, at, phase: name }),
  );
};
const remaining = (maximum: number) => {
  const ms = workDeadline - Date.now();
  assert.ok(
    ms > 0 && observer.exitCode === null,
    'APPX_DIAGNOSTIC_WORK_DEADLINE',
  );
  return Math.min(maximum, ms);
};
try {
  const readyDeadline = Date.now() + WINDOWS_QUERY_TIMEOUT_MS;
  while (
    !observerReady &&
    observer.exitCode === null &&
    Date.now() < readyDeadline
  )
    await wait(50);
  assert.equal(observerReady, true, 'APPX_OBSERVER_NOT_READY');
  await phase('idle-start');
  // Equal initial no-product interval in every fresh-VM arm. This is observation,
  // not readiness or a retry that can turn a failed comparison into a pass.
  await wait(120_000);
  await phase('idle-end');
  if (arm === 'restricted') {
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-appx-token-'));
    try {
      await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'e2e/proof-acl.ps1'),
          '-Action',
          'grant',
          '-Root',
          scratch,
        ],
        { timeout: remaining(WINDOWS_QUERY_TIMEOUT_MS), windowsHide: true },
      );
      const args = join(scratch, 'arguments.json');
      await writeFile(
        args,
        JSON.stringify([
          '--input-type=module',
          '-e',
          'await new Promise(resolve => setTimeout(resolve, 120000));',
        ]),
      );
      await phase('restricted-launch');
      await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'e2e/limited-token.ps1'),
          '-Executable',
          process.execPath,
          '-ArgumentsFile',
          args,
          '-TokenReport',
          join(scratch, 'release-appx-token.json'),
          '-TimeoutSeconds',
          '240',
        ],
        { timeout: remaining(420_000), windowsHide: true },
      );
      await phase('restricted-return');
    } finally {
      for (const name of await readdir(scratch))
        if (/^release-appx-token[\w.-]*\.json$/.test(name))
          await copyFile(join(scratch, name), join(output, name));
      await rm(scratch, { recursive: true, force: true });
    }
  } else if (arm === 'installed') {
    await phase('desktop-build-start');
    await runNativeQuery(
      process.execPath,
      [join(directory, 'packaging/package.ts')],
      { timeout: remaining(300_000), windowsHide: true },
    );
    await phase('desktop-build-end');
    await phase('release-build-start');
    await runNativeQuery(
      process.execPath,
      [join(directory, 'packaging/release.ts')],
      { timeout: remaining(240_000), windowsHide: true },
    );
    await phase('release-build-end');
    for (const mode of ['red', 'faults', 'controls', 'smoke']) {
      await phase(`proof-${mode}-start`);
      try {
        const result = await runNativeQuery(
          process.execPath,
          [join(directory, 'e2e/installed-proof.ts'), mode],
          {
            timeout: remaining(600_000),
            maxBuffer: 8 * 1024 * 1024,
            windowsHide: true,
          },
        );
        await writeFile(
          join(output, `${mode}-result.json`),
          JSON.stringify({
            ...terms,
            returned: true,
            stdout: result.stdout,
            stderr: result.stderr,
          }),
        );
      } catch (error) {
        // Preserve the original failure and stop the sequence. Diagnostic status
        // never overrides it or relabels it as an acceptance pass.
        await writeFile(
          join(output, `${mode}-result.json`),
          JSON.stringify({
            ...terms,
            returned: false,
            code:
              error instanceof Error && 'code' in error
                ? error.code
                : 'unknown',
          }),
        );
        console.error('APPX_DIAGNOSTIC_PROOF_FAILED', mode, error);
        await phase(`proof-${mode}-failed`);
        break;
      }
      await phase(`proof-${mode}-end`);
    }
  }
  await phase('arm-settled');
} finally {
  const code = await observed;
  if (!stream.writableFinished)
    await new Promise<void>((resolve, reject) => {
      stream.once('finish', resolve);
      stream.once('error', reject);
    });
  await writeFile(
    join(output, 'observer-result.json'),
    JSON.stringify({
      ...terms,
      code,
      stderr: errors,
      bytes: observerBytes,
      observerReady,
      at: Date.now(),
    }),
  );
  await writeAppxReadout(output, join(directory, 'dist'), arm!);
  assert.equal(code, 0, 'APPX_OBSERVER_FAILED');
  assert.equal(errors, '', 'APPX_OBSERVER_DIAGNOSTIC_ERROR');
}
