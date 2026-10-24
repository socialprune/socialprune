import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { proofOutput } from './proof-context.ts';

// Opt-in observation for the separate runner experiment, never an exemption or
// input to a proof's comparison, readiness predicate or result.
export async function appxPhase(
  phase: string,
  restricted = false,
): Promise<void> {
  /* eslint-disable no-restricted-properties -- Closed diagnostic switch and CI metadata, not credentials. */
  const output = process.env.SP_APPX_DIAGNOSTIC_ROOT;
  if (!output) return;
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_OS !== 'Windows'
  )
    throw new Error('APPX_DIAGNOSTIC_RUNNER_REQUIRED');
  /* eslint-enable no-restricted-properties */
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(phase))
    throw new Error('APPX_DIAGNOSTIC_PHASE_REFUSED');
  const at = Date.now();
  await writeFile(
    restricted
      ? proofOutput(`release-appx-phase-${at}-${process.pid}-${phase}.json`)
      : join(output, `phase-${at}-${process.pid}-${phase}.json`),
    JSON.stringify({
      diagnosticOnly: true,
      acceptanceProof: false,
      phase,
      at,
      pid: process.pid,
    }),
    { flag: 'wx' },
  );
}
