import { expect, test } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directory } from '../packaging/paths.ts';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
  WINDOWS_POWERSHELL_EXECUTABLE,
} from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';
import { windowsTestBudget } from './windows-test-budgets.ts';

test.skipIf(process.platform !== 'win32')(
  'an owned desktop denied to the LUA token reproduces DLL init failure; the same token/environment/heap succeeds after an owned-only access grant',
  async () => {
    const scratch = await mkdtemp(
      join(tmpdir(), 'socialprune-desktop-access-'),
    );
    try {
      const { stdout } = await runPowerShell(
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'test/desktop-access-fixture.ps1'),
          '-Scratch',
          scratch,
          '-Shell',
          WINDOWS_POWERSHELL_EXECUTABLE,
          '-QueryTimeoutMs',
          String(WINDOWS_QUERY_TIMEOUT_MS),
        ],
        {
          timeout: windowsTestBudget(6),
          env: testEnvironment(),
          windowsHide: true,
        },
      );
      const result = JSON.parse(stdout) as {
        denied: number;
        granted: number;
        desktopObjectsClosed: boolean;
        environmentInherited: boolean;
        restricted: boolean;
        medium: boolean;
        adminMember: boolean;
        jobKillOnClose: boolean;
        heapRecreated: boolean;
      };
      expect(result).toMatchObject({
        denied: 3221225794,
        granted: 0,
        desktopObjectsClosed: true,
        environmentInherited: true,
        restricted: true,
        medium: true,
        adminMember: false,
        jobKillOnClose: true,
        heapRecreated: false,
      });
      expect(result).toMatchObject({
        nestedDenied: { code: 3221225794, environmentUnchanged: true },
        nestedGranted: { code: 0, environmentUnchanged: true },
      });
      console.log('DESKTOP_ACCESS_RED_GREEN', JSON.stringify(result));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  windowsTestBudget(6) + 100,
);

test('the launcher uses only owned desktop security and inherited environment, never hardcodes the interactive desktop or loads a profile', async () => {
  const source = await readFile(
    join(directory, 'e2e/limited-token.ps1'),
    'utf8',
  );
  expect(source).not.toContain('desktop="winsta0\\default"');
  expect(source).toContain('LimitedDesktop');
  expect(source).not.toMatch(/LoadUserProfile\s*\(/);
});

test('both runner samples set all PowerShell query floors and enclosing test budgets, including native compilation and proof isolation', async () => {
  expect(WINDOWS_QUERY_TIMEOUT_MS).toBeGreaterThanOrEqual(33_055 * 3 + 100);
  const { RESTRICTED_SEQUENCE_TEST_TIMEOUT_MS, WINDOWS_QUERY_TEST_TIMEOUT_MS } =
    await import('./windows-test-budgets.ts');
  expect(WINDOWS_QUERY_TEST_TIMEOUT_MS).toBeGreaterThanOrEqual(
    WINDOWS_QUERY_TIMEOUT_MS + 100,
  );
  expect(RESTRICTED_SEQUENCE_TEST_TIMEOUT_MS).toBeGreaterThanOrEqual(
    6 * WINDOWS_QUERY_TIMEOUT_MS + 100,
  );
  const source = await readFile(
    join(directory, 'test/proof-isolation.test.ts'),
    'utf8',
  );
  expect(source).toContain('RESTRICTED_SEQUENCE_TEST_TIMEOUT_MS');
});
