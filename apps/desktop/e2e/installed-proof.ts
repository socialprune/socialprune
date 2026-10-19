import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { directory, dist } from '../packaging/paths.ts';
import { artifacts, releaseVersion } from '../packaging/release.ts';
import { setTimeout as wait } from 'node:timers/promises';
import { createHash } from 'node:crypto';

// Test-only launcher. The installer receives no test flag and has no exemption
// from its elevated-token guard. A restricted same-user process inherits the
// current interactive desktop and profile; no account or machine setting changes.
const mode = process.argv[2];
assert.ok(
  mode === 'smoke' ||
    mode === 'controls' ||
    mode === 'foundation' ||
    mode === 'faults',
  'INSTALLED_PROOF_MODE',
);
const run = promisify(execFile);
const ps = (script: string, args: string[] = []) =>
  run(
    'powershell.exe',
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
const { stdout } = await run(
  'powershell.exe',
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
try {
  if (elevated) {
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
  const entry =
    mode === 'smoke'
      ? 'packaging/release-smoke.ts'
      : mode === 'faults'
        ? 'e2e/installer-fault-controls.ts'
        : mode === 'foundation'
          ? 'e2e/installer-foundation.ts'
          : 'e2e/uninstall-controls.ts';
  const args = [join(directory, entry), ...process.argv.slice(3)];
  if (elevated && mode === 'controls') args.push(`--elevated-proof=${scratch}`);
  const argumentFile = join(scratch, 'arguments.json');
  await writeFile(argumentFile, JSON.stringify(args));
  const child = spawn(
    'powershell.exe',
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
      join(dist, `release-token-${mode}.json`),
    ],
    { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true },
  );
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (elevated && mode === 'controls') {
    const deadline = Date.now() + 180_000;
    while (
      !(await access(join(scratch, 'installed.ready')).then(
        () => true,
        () => false,
      )) &&
      Date.now() < deadline &&
      child.exitCode === null
    )
      await wait(50);
    assert.equal(
      await access(join(scratch, 'installed.ready')).then(
        () => true,
        () => false,
      ),
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
    (await readFile(join(dist, `release-token-${mode}.json`), 'utf8')).replace(
      /^\uFEFF/,
      '',
    ),
  ) as { adminMember: boolean; childExit: number };
  assert.equal(report.adminMember, false);
  assert.equal(code, report.childExit);
  if (code !== 0) process.exitCode = code ?? 1;
} finally {
  await rm(scratch, { recursive: true, force: true });
}
