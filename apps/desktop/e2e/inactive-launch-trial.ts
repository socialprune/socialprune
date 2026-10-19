import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as wait } from 'node:timers/promises';
import { runPowerShell } from '../packaging/windows-powershell.ts';
import { generatedWorkspace } from '../test/workspace.ts';
import { directory } from '../packaging/paths.ts';
import { proofOutput } from './proof-context.ts';
import { launchInactive } from './inactive-launch.ts';

export async function trialInactiveRelease(executable: string) {
  const data = await mkdtemp(join(tmpdir(), 'socialprune-launch-trial-'));
  await generatedWorkspace(data);
  const samples: unknown[] = [];
  try {
    for (const showCommand of [4, 7] as const) {
      const started = Date.now();
      const child = await launchInactive(
        executable,
        [`--data-dir=${data}`, '--force-renderer-accessibility'],
        showCommand,
      );
      const probe = (script: string, args: string[] = []) =>
        runPowerShell(
          [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            join(directory, script),
            '-AppProcessId',
            String(child.pid),
            ...args,
          ],
          { windowsHide: true, timeout: 60_000 },
        );
      try {
        const beforeFocus = JSON.parse(
          (await probe('e2e/inactive-window-probe.ps1')).stdout,
        ) as { readyAt: number };
        // Preserve the existing smoke's exact interactivity and memory check.
        // Record it separately: SetFocus is itself an activating operation.
        const existingProbe = JSON.parse(
          (
            await probe('packaging/release-window.ps1', [
              '-Executable',
              executable,
            ])
          ).stdout,
        ) as { interactiveAt: number; workingSetBytes: number };
        const afterFocus = JSON.parse(
          (await probe('e2e/inactive-window-probe.ps1')).stdout,
        ) as unknown;
        await probe('packaging/release-window.ps1', [
          '-Executable',
          executable,
          '-CloseOnly',
        ]);
        assert.equal(
          await Promise.race([
            child.exited,
            wait(30_000, 'timeout', { ref: false }),
          ]),
          0,
        );
        assert.doesNotMatch(child.errors(), /DESKTOP_START_FAILED/);
        samples.push({
          showCommand,
          startupFlags: child.startupFlags,
          ownedJob: child.ownedJob,
          beforeFocus,
          afterFocus,
          readyMs: beforeFocus.readyAt - started,
          existingStartupMs: existingProbe.interactiveAt - started,
          workingSetBytes: existingProbe.workingSetBytes,
        });
        await writeFile(
          proofOutput('release-inactive-launch-trial.json'),
          JSON.stringify({ unchangedRelease: true, samples }, null, 2),
        );
      } finally {
        await child.close();
      }
    }
    console.log(
      JSON.stringify({ proof: 'inactive-release-launch-trial', samples }),
    );
  } finally {
    await rm(data, { recursive: true, force: true });
  }
}
