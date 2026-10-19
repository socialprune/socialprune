import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  runPowerShell,
  spawnPowerShell,
} from '../packaging/windows-powershell.ts';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { directory, dist } from '../packaging/paths.ts';
import { artifacts, releaseVersion } from '../packaging/release.ts';
import { setTimeout as wait } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { pathExists } from '../packaging/file-presence.ts';
import { failureRecord } from './proof-failure.ts';
import { root } from '../packaging/paths.ts';
import { collectProof } from './proof-collection.ts';

// Test-only launcher. The installer receives no test flag and has no exemption
// from its elevated-token guard. A restricted same-user process inherits the
// current interactive desktop and profile; no account or machine setting changes.
const mode = process.argv[2];
assert.ok(
  mode === 'smoke' ||
    mode === 'red' ||
    mode === 'controls' ||
    mode === 'foundation' ||
    mode === 'faults',
  'INSTALLED_PROOF_MODE',
);
const run = promisify(execFile);
const ps = (script: string, args: string[] = []) =>
  runPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, script),
      ...args,
    ],
    { timeout: 60_000, windowsHide: true },
  );
const before = JSON.parse(
  (await ps('packaging/install-layout.ps1')).stdout,
) as {
  installExists: boolean;
  dataExists: boolean;
  registrationExists: boolean;
  existingShortcuts: string[];
};
assert.equal(before.installExists, false, 'EXISTING_INSTALL_REFUSED');
assert.equal(before.dataExists, false, 'EXISTING_DATA_REFUSED');
assert.equal(before.registrationExists, false, 'EXISTING_REGISTRATION_REFUSED');
assert.deepEqual(before.existingShortcuts, [], 'EXISTING_SHORTCUT_REFUSED');
const { stdout } = await runPowerShell(
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
  ],
  { timeout: 15_000, windowsHide: true },
);
const elevated = stdout.trim() === 'True';
const scratch = await mkdtemp(join(tmpdir(), 'socialprune-token-proof-'));
await mkdir(dist, { recursive: true });
const tokenReport = join(scratch, `release-token-${mode}.json`);
let childExited: Promise<number | null> | undefined;
let acl: unknown;
try {
  // Only this random root receives an explicit inheritable same-user grant.
  // No ACL in the checkout, AppData, installed app or system is changed.
  acl = JSON.parse(
    (await ps('e2e/proof-acl.ps1', ['-Action', 'grant', '-Root', scratch]))
      .stdout,
  ) as unknown;
  const aclPaths = join(scratch, 'acl-paths.json');
  await writeFile(
    aclPaths,
    JSON.stringify([
      { label: 'repo-dist', path: dist },
      { label: 'nsis-tools', path: join(dist, 'nsis-tools') },
      { label: 'nsis-generated', path: join(dist, 'nsis-generated') },
      { label: 'artifacts', path: artifacts },
    ]),
  );
  await writeFile(
    join(dist, `release-access-${mode}.json`),
    JSON.stringify(
      {
        grant: acl,
        inputs: JSON.parse(
          (
            await ps('e2e/proof-acl.ps1', [
              '-Action',
              'inspect',
              '-Root',
              scratch,
              '-PathsFile',
              aclPaths,
            ])
          ).stdout,
        ) as unknown,
      },
      null,
      2,
    ),
  );
  if (elevated && mode !== 'red') {
    const setup = join(
      artifacts,
      `SocialPrune-Setup-${await releaseVersion()}.exe`,
    );
    await assert.rejects(
      run(setup, ['/S'], {
        timeout: 60_000,
        windowsHide: true,
        env: {
          // eslint-disable-next-line no-restricted-properties -- Windows directory only.
          SystemRoot: process.env.SystemRoot,
          TEMP: scratch,
          TMP: scratch,
        },
      }),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 10,
    );
    assert.deepEqual(
      JSON.parse((await ps('packaging/install-layout.ps1')).stdout),
      before,
      'ELEVATED_REFUSAL_CHANGED_LAYOUT',
    );
    await writeFile(
      join(dist, `release-elevated-${mode}.json`),
      JSON.stringify({ elevated: true, setupExit: 10, layoutUnchanged: true }),
    );
    console.log(
      'ELEVATED_PROOF: unchanged shipped Setup refused, exit 10, layout unchanged',
    );
  }
  const args = [
    join(directory, 'e2e/installed-child.ts'),
    mode,
    scratch,
    ...process.argv.slice(3),
  ];
  if (elevated && mode === 'controls') args.push(`--elevated-proof=${scratch}`);
  const argumentFile = join(scratch, 'arguments.json');
  await writeFile(argumentFile, JSON.stringify(args));
  const parentTemp = join(scratch, 'parent-temp');
  await mkdir(parentTemp);
  const childEnv = {
    // eslint-disable-next-line no-restricted-properties -- Test-only launcher preserves the CLI environment; no environment value is read as a credential.
    ...process.env,
    TEMP: parentTemp,
    TMP: parentTemp,
  };
  const child = spawnPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'e2e/limited-token.ps1'),
      '-Executable',
      process.execPath,
      '-ArgumentsFile',
      argumentFile,
      '-TokenReport',
      tokenReport,
    ],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
      env: childEnv,
    },
  );
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  childExited = exited;
  if (elevated && mode === 'controls') {
    const deadline = Date.now() + 180_000;
    while (
      !(await pathExists(join(scratch, 'installed.ready'))) &&
      Date.now() < deadline &&
      child.exitCode === null
    )
      await wait(50);
    assert.equal(
      await pathExists(join(scratch, 'installed.ready')),
      true,
      'ELEVATED_PROOF_INSTALL_NOT_READY',
    );
    const layoutBefore = (await ps('packaging/install-layout.ps1')).stdout;
    const installed = JSON.parse(layoutBefore) as { install: string };
    const manifest = JSON.parse(
      await readFile(join(installed.install, 'installed-files.json'), 'utf8'),
    ) as { path: string }[];
    const hashes = () =>
      Promise.all(
        [
          ...manifest.map((row) => row.path),
          'Uninstall.exe',
          'installed-files.json',
        ].map(async (path) =>
          createHash('sha256')
            .update(await readFile(join(installed.install, path)))
            .digest('hex'),
        ),
      );
    const beforeHashes = await hashes();
    await assert.rejects(
      run(
        join(installed.install, 'Uninstall.exe'),
        ['/S', `_?=${installed.install}`],
        { timeout: 60_000, windowsHide: true },
      ),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 10,
    );
    assert.equal(
      (await ps('packaging/install-layout.ps1')).stdout,
      layoutBefore,
    );
    assert.deepEqual(await hashes(), beforeHashes);
    await writeFile(
      join(dist, 'release-elevated-uninstall.json'),
      JSON.stringify({
        elevated: true,
        directExit: 10,
        layoutUnchanged: true,
        fileHashesUnchanged: true,
      }),
    );
    await writeFile(join(scratch, 'refused.ready'), 'refused');
  }
  const code = await exited;
  const report = JSON.parse(
    (await readFile(tokenReport, 'utf8')).replace(/^\uFEFF/, ''),
  ) as { adminMember: boolean; childExit: number };
  assert.equal(report.adminMember, false);
  assert.equal(code, report.childExit);
  const childReceipt = join(scratch, `release-child-${mode}.json`);
  if (!(await pathExists(childReceipt)))
    await writeFile(
      childReceipt,
      JSON.stringify(
        {
          mode,
          state: 'failed',
          phase: 'launch',
          failure: {
            file: 'apps/desktop/e2e/installed-child.ts',
            code: 'CHILD_RECEIPT_MISSING',
            childExit: code,
            syscall: null,
            pathClass: 'unknown',
            path: null,
          },
        },
        null,
        2,
      ),
    );
  if (code !== 0) process.exitCode = code ?? 1;
} catch (error) {
  await writeFile(
    join(dist, `release-parent-failure-${mode}.json`),
    JSON.stringify(
      { mode, failure: failureRecord(error, root, scratch) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  // The elevated parent is the only writer of dist receipts and the Actions
  // summary. Preserve partial child evidence on both success and failure.
  try {
    if (childExited) await childExited;
    const { collected, summary } = await collectProof(scratch, dist);
    await writeFile(
      join(dist, `release-collection-${mode}.json`),
      JSON.stringify({ mode, collected, parentOnlyDistWriter: true }, null, 2),
    );
    // eslint-disable-next-line no-restricted-properties -- Parent-owned Actions summary path, not a key.
    const destination = process.env.GITHUB_STEP_SUMMARY;
    if (destination && summary) await appendFile(destination, summary);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
