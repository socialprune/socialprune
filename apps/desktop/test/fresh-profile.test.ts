import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPowerShell } from '../packaging/windows-powershell.ts';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import { pathExists } from '../packaging/file-presence.ts';

test('TS presence readers admit only ENOENT as absence, not denied or wrong-type reads', async () => {
  expect(
    await pathExists('generated', () =>
      Promise.reject(Object.assign(new Error('absent'), { code: 'ENOENT' })),
    ),
  ).toBe(false);
  for (const code of ['EACCES', 'EPERM', 'ENOTDIR', 'EIO'])
    await expect(
      pathExists('generated', () =>
        Promise.reject(Object.assign(new Error(code), { code })),
      ),
    ).rejects.toThrow(code);
  expect(await pathExists('generated', () => Promise.resolve({}))).toBe(true);
});

test.skipIf(process.platform !== 'win32')(
  'fresh-profile reader absence is explicit and denied reads remain fatal',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-fresh-readers-'));
    try {
      const { stdout } = await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'e2e/fresh-profile-controls.ps1'),
          '-Scratch',
          scratch,
        ],
        { timeout: 45_000, windowsHide: true },
      );
      expect(JSON.parse(stdout)).toMatchObject({
        missingRegistryViews: 2,
        registrationAndValuesNull: true,
        deniedAndWrongTypeReadsFailed: true,
        missingTaskFolderAndTaskNull: true,
        absentComRecorded: true,
        absentSdkRecorded: true,
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  60_000,
);

test.skipIf(process.platform !== 'win32')(
  'restricted same-user child reads its parent HKCU marker without loading a profile',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-profile-hive-'));
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
        { timeout: 30_000, windowsHide: true },
      );
      const args = join(scratch, 'args.json'),
        report = join(scratch, 'token.json');
      const child = join(scratch, 'child.mjs');
      await writeFile(
        child,
        `import {runPowerShell} from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/windows-powershell.ts')).href)}; console.log((await runPowerShell(${JSON.stringify(['-NoProfile', '-NonInteractive', '-File', join(directory, 'e2e/fresh-profile-controls.ps1'), '-Scratch', scratch])})).stdout);`,
      );
      await writeFile(args, JSON.stringify([child]));
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
          report,
        ],
        {
          timeout: 45_000,
          windowsHide: true,
          env: {
            // eslint-disable-next-line no-restricted-properties -- Test-only subprocess inherits the CLI environment, with OS temp confined to the granted fixture.
            ...process.env,
            TEMP: scratch,
            TMP: scratch,
          },
        },
      );
      expect(
        JSON.parse((await readFile(report, 'utf8')).replace(/^\uFEFF/, '')),
      ).toMatchObject({
        adminMember: false,
        childExit: 0,
        profile: {
          sameUserSid: true,
          parentHkcuMarkerRead: true,
          loadUserProfileCalled: false,
        },
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  60_000,
);

test('production wrappers keep fixed paths and use the tested readers without a test flag', async () => {
  for (const [file, call] of [
    ['install-layout.ps1', 'Get-InstallLayout'],
    ['installer-proof.ps1', 'Get-InstallRegistration'],
    ['msix-tools.ps1', 'Find-WindowsMakeAppx'],
  ] as const) {
    const source = await readFile(join(directory, 'packaging', file), 'utf8');
    expect(source).toContain(call);
    expect(source).not.toMatch(/SilentlyContinue|TestRoot|TestPath/);
  }
});
