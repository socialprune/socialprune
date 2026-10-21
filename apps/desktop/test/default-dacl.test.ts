import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import {
  runPowerShell,
  RESTRICTED_LAUNCH_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';
import {
  WINDOWS_QUERY_TEST_TIMEOUT_MS,
  RESTRICTED_SEQUENCE_TEST_TIMEOUT_MS,
} from './windows-test-budgets.ts';

test.skipIf(process.platform !== 'win32')(
  'the actual launcher merge adds the missing synthetic user ACE, preserves every prior ACE and is idempotent',
  async () => {
    const { stdout } = await runPowerShell(
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        join(directory, 'test/default-dacl-fixture.ps1'),
        '-Launcher',
        join(directory, 'e2e/limited-token.ps1'),
        '-DesktopSource',
        join(directory, 'e2e/limited-desktop.cs'),
      ],
      {
        timeout: WINDOWS_QUERY_TEST_TIMEOUT_MS - 100,
        windowsHide: true,
        env: testEnvironment(),
      },
    );
    expect(JSON.parse(stdout)).toEqual({
      inputUserAcePresent: false,
      userAcePresent: true,
      existingAcesPreserved: true,
      addedAceCount: 1,
      idempotent: true,
      trusteeClass: 'user',
      access: 'GENERIC_ALL',
    });
  },
  WINDOWS_QUERY_TEST_TIMEOUT_MS,
);

test.skipIf(process.platform !== 'win32')(
  'the real restricted launcher reads back a closed user grant before a generated Node child, retaining medium integrity and deny-only Administrators',
  async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'socialprune-default-dacl-'));
    try {
      const args = join(scratch, 'args.json');
      const receipt = join(scratch, 'token.json');
      await writeFile(args, JSON.stringify(['-e', 'process.exitCode=0']));
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
          receipt,
        ],
        {
          timeout: RESTRICTED_LAUNCH_TIMEOUT_MS,
          windowsHide: true,
          env: testEnvironment(),
        },
      );
      const result = JSON.parse(
        (await readFile(receipt, 'utf8')).replace(/^\uFEFF/, ''),
      ) as { defaultDacl: unknown };
      expect(result).toMatchObject({
        adminMember: false,
        childExit: 0,
        integrity: 'medium',
        lifecycle: 'owned-job-kill-on-close',
        profile: { sameUserSid: true, parentHkcuMarkerRead: true },
        desktop: { mediumIntegrityVerified: true },
      });
      expect(result.defaultDacl).toEqual({
        state: 'verified',
        trusteeClass: 'user',
        access: 'GENERIC_ALL',
        userAcePresent: true,
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  RESTRICTED_SEQUENCE_TEST_TIMEOUT_MS,
);

test('the restricted release-proof path merges and reads back only its own user default-DACL grant before either child starts', async () => {
  const source = await readFile(
    join(directory, 'e2e/limited-token.ps1'),
    'utf8',
  );
  expect(source).toMatch(
    /CreateRestrictedToken\(token,1\|4[^\n]+\n\s+EnsureUserDefaultDacl\(limited\);/,
  );
  expect(source.indexOf('EnsureUserDefaultDacl(limited);')).toBeLessThan(
    source.indexOf('proof=StartOwned('),
  );
  expect(source).toContain('SetEntriesInAclW(1,ref entry,original,out merged)');
  expect(source).toContain('permissions=0x10000000,mode=1');
  expect(source).toContain('form=0,type=1,name=user');
  expect(source).toContain('ReadTokenData(token,6)');
  expect(source).toContain('LIMITED_DEFAULT_DACL_USER_ACE_MISSING');
  expect(source).toContain(
    'defaultDacl=([LimitedProof]::DefaultDaclEvidence|ConvertFrom-Json)',
  );
  expect(source).not.toMatch(/SetSecurityInfo\s*\(/);
  expect(source).toContain('SetMediumIntegrity');
  expect(source).toContain('if(member) throw');
  expect(source).toContain('SetKillOwnedChildrenOnClose');
});

test('sandbox and readiness predicates stay byte-identical and release packaging cannot consume the test-only token repair', async () => {
  const hashes = {
    'src/main/app.ts':
      '4d46b3f4144e29aea1b2734391f71125084615f408954ad6e46e57b27cb47887',
    'packaging/release-window.ps1':
      '643805d332ed255215219b672bdc18daa7a9d0f31bded580afb9faa9d05800b7',
    'packaging/window-readiness.cs':
      '177e81204e8e449fe05b3406ab783ae99d3e5498c10eb87cb35bb7732f537655',
    'packaging/window-readiness.ps1':
      '18bf3d5fc70b2c10a677c1886b863577fcdf6452d59f5a601073b35fec012687',
    'packaging/window-readiness.ts':
      '62bdeeaa26ed9845ed4c64e7af277e262239f7d157a3aefcfe6a2cda8a5b0329',
  };
  for (const [file, expected] of Object.entries(hashes)) {
    const source = (await readFile(join(directory, file), 'utf8')).replaceAll(
      '\r\n',
      '\n',
    );
    expect(createHash('sha256').update(source).digest('hex'), file).toBe(
      expected,
    );
  }
  expect(await readFile(join(directory, 'src/main/app.ts'), 'utf8')).toContain(
    'app.enableSandbox();',
  );
  for (const file of ['packaging/package.ts', 'packaging/release.ts'])
    expect(await readFile(join(directory, file), 'utf8')).not.toMatch(
      /limited-token|EnsureUserDefaultDacl|MergeUserDefaultDacl/,
    );
  if (process.platform === 'win32') {
    // R30's pre-edit release build, also observed on runner 39629847889.
    const asar = await readFile(
      join(directory, 'dist/release/resources/app.asar'),
    );
    expect(createHash('sha256').update(asar).digest('hex')).toBe(
      '6fc889e69d999ff42cdfff6752bd2f2a4ce470745f61450de98bae4a4a3d4994',
    );
  }
});
