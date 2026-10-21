import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { directory } from '../packaging/paths.ts';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { testEnvironment } from './process-environment.ts';

test.skipIf(process.platform !== 'win32')(
  'owned-desktop selection distinguishes an empty desktop, a wrong probe desktop and a real native error',
  async () => {
    const scratch = await mkdtemp(
      join(tmpdir(), 'socialprune-desktop-enumeration-'),
    );
    try {
      const script = join(scratch, 'native.ps1');
      await writeFile(
        script,
        `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition ([IO.File]::ReadAllText('${join(directory, 'packaging/window-readiness.cs').replaceAll("'", "''")}')+[IO.File]::ReadAllText('${join(directory, 'test/window-desktop-fixture.cs').replaceAll("'", "''")}'))
[WindowDesktopFixture]::Run()\n`,
      );
      const { stdout } = await runPowerShell(
        ['-NoProfile', '-NonInteractive', '-File', script],
        {
          timeout: WINDOWS_QUERY_TIMEOUT_MS,
          windowsHide: true,
          env: testEnvironment(),
        },
      );
      const observed: unknown = JSON.parse(stdout);
      expect(observed).toMatchObject({
        legacyEmptyReturned: false,
        legacyError: 0,
        emptyReturned: true,
        emptyError: 0,
        enumerationCall: 'EnumDesktopWindows',
        enumerationError: 6,
        wrongThreadFoundOwnedWindow: true,
        probeDesktopMatches: false,
        invalidCall: 'OpenDesktopW',
        invalidError: 2,
      });
      process.stdout.write(`OWNED_DESKTOP_ENUMERATION ${stdout.trim()}\n`);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  },
  WINDOWS_QUERY_TIMEOUT_MS + 5_000,
);

test('installed and fixture launchers pass the exact owned desktop without changing existing desktop ACLs', async () => {
  for (const file of [
    'e2e/limited-desktop.cs',
    'test/window-station-fixture.ps1',
  ]) {
    expect(await readFile(join(directory, file), 'utf8')).toContain(
      'SP_PROOF_DESKTOP',
    );
  }
  const caller = await readFile(
    join(directory, 'packaging/window-readiness.ts'),
    'utf8',
  );
  expect(caller).toContain("'-DesktopPath'");
  const native = await readFile(
    join(directory, 'packaging/window-readiness.cs'),
    'utf8',
  );
  expect(native).toContain('0x41');
  expect(native).not.toMatch(
    /OpenInputDesktop|SetUserObjectSecurity|SetThreadDesktop/,
  );
});
