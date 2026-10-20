import {
  runPowerShell,
  setQueryMeasurementDirectory,
  WINDOWS_QUERY_TIMEOUT_MS,
} from '../packaging/windows-powershell.ts';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { directory, root } from '../packaging/paths.ts';
import { join } from 'node:path';
import { failureRecord } from './proof-failure.ts';
import { homedir } from 'node:os';
import { controlOutputExcerpt } from '../packaging/diagnostic-output.ts';

// The native restricted-token launcher starts Node here. Even the first profile
// proof uses the same WinPS environment boundary as every later harness call.
const reportIndex = process.argv.indexOf('-Report');
if (reportIndex >= 0 && process.argv[reportIndex + 1])
  setQueryMeasurementDirectory(dirname(process.argv[reportIndex + 1]!));
try {
  await runPowerShell(
    ['-NoProfile', '-NonInteractive', '-File', ...process.argv.slice(2)],
    { timeout: WINDOWS_QUERY_TIMEOUT_MS, windowsHide: true },
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
        diagnostic: controlOutputExcerpt(
          error instanceof Error ? error.message : 'PROFILE_UNKNOWN_FAILURE',
          { repo: root, temp: dirname(report), home: homedir() },
        ),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
