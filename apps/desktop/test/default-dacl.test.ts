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
import {
  assertProductSandbox,
  assertReadinessPredicate,
  readinessHashes,
} from './proof-invariants.ts';

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

test('product sandbox semantics and readiness predicates remain enforced without pinning unrelated app behavior or prebuilt bytes', async () => {
  const app = await readFile(join(directory, 'src/main/app.ts'), 'utf8');
  expect(() => assertProductSandbox(app)).not.toThrow();
  for (const file of Object.keys(
    readinessHashes,
  ) as (keyof typeof readinessHashes)[]) {
    const source = await readFile(join(directory, file), 'utf8');
    expect(() => assertReadinessPredicate(file, source), file).not.toThrow();
  }
  for (const file of ['packaging/package.ts', 'packaging/release.ts'])
    expect(await readFile(join(directory, file), 'utf8')).not.toMatch(
      /limited-token|EnsureUserDefaultDacl|MergeUserDefaultDacl/,
    );
});
