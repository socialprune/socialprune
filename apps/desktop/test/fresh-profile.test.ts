import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import { pathExists } from '../packaging/file-presence.ts';
import { testEnvironment } from './process-environment.ts';

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
        {
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          windowsHide: true,
          env: testEnvironment(),
        },
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
  90_000,
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
        {
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          windowsHide: true,
          env: testEnvironment(),
        },
      );
      const args = join(scratch, 'args.json'),
        report = join(scratch, 'token.json');
      const child = join(scratch, 'child.mjs');
      await writeFile(
        child,
        `import {runPowerShell} from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/windows-powershell.ts')).href)}; import {testEnvironment} from ${JSON.stringify(pathToFileURL(join(directory, 'test/process-environment.ts')).href)}; console.log((await runPowerShell(${JSON.stringify(['-NoProfile', '-NonInteractive', '-File', join(directory, 'e2e/fresh-profile-controls.ps1'), '-Scratch', scratch])},{timeout:60000,env:testEnvironment()})).stdout);`,
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
          '-TimeoutSeconds',
          '75',
        ],
        {
          timeout: 180_000,
          windowsHide: true,
          env: testEnvironment({
            TEMP: scratch,
            TMP: scratch,
          }),
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
  240_000,
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

test.skipIf(process.platform !== 'win32')(
  'a restricted-child timeout closes its descendants before returning, not after an inherited pipe keeps the parent open',
  async () => {
    const scratch = await mkdtemp(
      join(tmpdir(), 'socialprune-profile-timeout-'),
    );
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
        { timeout: WINDOWS_QUERY_TIMEOUT_MS, env: testEnvironment() },
      );
      const marker = join(scratch, 'descendant-completed.txt'),
        ready = join(scratch, 'descendant-started.txt'),
        script = join(scratch, 'waiting.ps1'),
        entry = join(scratch, 'child.mjs'),
        args = join(scratch, 'args.json'),
        report = join(scratch, 'token.json');
      await writeFile(
        script,
        `[IO.File]::WriteAllText('${ready.replaceAll("'", "''")}',[string]$PID); [Threading.Thread]::Sleep(8000); [IO.File]::WriteAllText('${marker.replaceAll("'", "''")}','generated late descendant')`,
      );
      await writeFile(
        entry,
        `import {runPowerShell} from ${JSON.stringify(pathToFileURL(join(directory, 'packaging/windows-powershell.ts')).href)}; await runPowerShell(['-NoProfile','-NonInteractive','-File',${JSON.stringify(script)}],{timeout:10000});`,
      );
      await writeFile(args, JSON.stringify([entry]));
      await expect(
        runPowerShell(
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
            '-TimeoutSeconds',
            '5',
          ],
          {
            timeout: 120_000,
            env: testEnvironment({ TEMP: scratch, TMP: scratch }),
          },
        ),
      ).rejects.toThrow('LIMITED_PROOF_WAIT');
      const descendantPid = Number(await readFile(ready, 'utf8'));
      expect(descendantPid).toBeGreaterThan(0);
      let gone = false;
      try {
        process.kill(descendantPid, 0);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
          gone = true;
        else throw error;
      }
      expect(gone).toBe(true);
      expect(await pathExists(marker)).toBe(false);
      expect(
        JSON.parse((await readFile(report, 'utf8')).replace(/^\uFEFF/, '')),
      ).toMatchObject({
        state: 'failed',
        phase: 'child',
        failure: { code: 'LIMITED_PROOF_WAIT' },
        lifecycle: 'owned-job-kill-on-close',
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  150_000,
);
