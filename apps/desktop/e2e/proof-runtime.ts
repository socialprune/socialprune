import { mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { root } from '../packaging/paths.ts';
import { setProofWorkspace } from './proof-context.ts';
import { failureRecord } from './proof-failure.ts';
import { setQueryMeasurementDirectory } from '../packaging/windows-powershell.ts';

export async function runProof(
  mode: string,
  workspace: string,
  entry: string,
  execute: () => Promise<void>,
) {
  const receipt = join(workspace, `release-child-${mode}.json`);
  let phase = 'initialize';
  const failed = (error: unknown) => ({
    runId: basename(workspace),
    mode,
    state: 'failed',
    phase,
    failure: failureRecord(error, root, workspace, entry),
  });
  // Monitor does not swallow Node's exception or alter its nonzero exit. The
  // synchronous record survives an unhandled callback/rejection before exit.
  const monitor = (error: Error) =>
    writeFileSync(receipt, JSON.stringify(failed(error), null, 2));
  process.once('uncaughtExceptionMonitor', monitor);
  try {
    await writeFile(
      receipt,
      JSON.stringify({
        runId: basename(workspace),
        mode,
        state: 'running',
        phase,
      }),
    );
    await mkdir(join(workspace, 'evidence'));
    await mkdir(join(workspace, 'temp'));
    setProofWorkspace(workspace);
    setQueryMeasurementDirectory(join(workspace, 'evidence'));
    /* eslint-disable no-restricted-properties -- Test-only child redirects OS temp and CI summary to its explicit run-owned workspace. */
    process.env.TEMP = join(workspace, 'temp');
    process.env.TMP = join(workspace, 'temp');
    process.env.GITHUB_STEP_SUMMARY = join(workspace, 'evidence/summary.md');
    /* eslint-enable no-restricted-properties */
    phase = 'execute';
    await execute();
    await writeFile(
      receipt,
      JSON.stringify({
        runId: basename(workspace),
        mode,
        state: 'passed',
        phase,
      }),
    );
    return 0;
  } catch (error) {
    const result = failed(error);
    await writeFile(receipt, JSON.stringify(result, null, 2));
    console.error('RESTRICTED_PROOF_FAILED', JSON.stringify(result));
    return 1;
  } finally {
    process.removeListener('uncaughtExceptionMonitor', monitor);
  }
}
