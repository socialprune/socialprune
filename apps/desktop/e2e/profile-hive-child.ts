import { runPowerShell } from '../packaging/windows-powershell.ts';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { directory, root } from '../packaging/paths.ts';
import { join } from 'node:path';
import { failureRecord } from './proof-failure.ts';

// The native restricted-token launcher starts Node here. Even the first profile
// proof uses the same WinPS environment boundary as every later harness call.
try {
  await runPowerShell(
    ['-NoProfile', '-NonInteractive', '-File', ...process.argv.slice(2)],
    { timeout: 25_000, windowsHide: true },
  );
} catch (error) {
  const index = process.argv.indexOf('-Report');
  const report = index >= 0 ? process.argv[index + 1] : undefined;
  if (!report) throw error;
  await writeFile(
    report,
    JSON.stringify(
      {
        state: 'failed',
        phase: 'profile-hive',
        failure: failureRecord(
          error,
          root,
          dirname(report),
          join(directory, 'e2e/profile-hive-child.ts'),
        ),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
