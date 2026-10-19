import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { directory } from '../packaging/paths.ts';
import { proofOutput } from './proof-context.ts';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import {
  systemSnapshot,
  compareSystemSnapshots,
} from '../packaging/system-check.ts';

export async function systemTokenProof(phase: string) {
  const output = proofOutput(`release-system-token-${phase}.json`);
  await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'e2e/system-token-proof.ps1'),
      '-Output',
      output,
    ],
    { timeout: 30_000, windowsHide: true },
  );
  const evidence = JSON.parse(
    (await readFile(output, 'utf8')).replace(/^\uFEFF/, ''),
  ) as {
    proof: string;
    openServiceError: number;
    changeServiceConfigError: number;
    adminMember: boolean;
    allArgumentsNoChange: boolean;
    machineValuesWritten: boolean;
  };
  assert.equal(evidence.openServiceError, 5);
  assert.equal(evidence.changeServiceConfigError, 5);
  assert.equal(evidence.adminMember, false);
  assert.equal(evidence.allArgumentsNoChange, true);
  assert.equal(evidence.machineValuesWritten, false);
  return evidence;
}

export async function systemTaskControl() {
  const before = await systemSnapshot();
  const name = `SocialPrune-inventory-control-${randomUUID()}`;
  const local = JSON.parse(
    (
      await promisify(execFile)(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          join(directory, 'packaging/install-layout.ps1'),
        ],
        { timeout: 30_000, windowsHide: true },
      )
    ).stdout,
  ) as { install: string };
  const task = (action: string) =>
    promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        join(directory, 'e2e/system-user-task.ps1'),
        '-Action',
        action,
        '-Name',
        name,
        '-Program',
        join(local.install, 'SocialPrune.exe'),
      ],
      { timeout: 30_000, windowsHide: true },
    );
  let created = false;
  const evidence: {
    name: string;
    created: boolean;
    strict?: boolean;
    appReference?: boolean;
    rejected?: boolean;
    removed?: boolean;
    creationDenied?: boolean;
    unavailable?: string;
  } = { name, created: false };
  try {
    try {
      const creation = JSON.parse((await task('create')).stdout) as {
        created: boolean;
        absent?: string;
      };
      if (creation.absent) {
        evidence.unavailable = creation.absent;
        return evidence;
      }
      assert.equal(creation.created, true);
      created = true;
      evidence.created = true;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('stderr' in error) ||
        !/0x80070005|Access is denied|Zugriff verweigert/i.test(
          String(error.stderr),
        )
      )
        throw error;
      evidence.creationDenied = true;
      return evidence;
    }
    const after = await systemSnapshot();
    const row = after.tasks.find((row) => row.name === `\\${name}`);
    assert.ok(row, 'TASK_CONTROL_NOT_VISIBLE');
    evidence.strict = row.strict;
    evidence.appReference = row.appReference;
    assert.equal(row.strict, true, 'TASK_CONTROL_NOT_STRICT');
    assert.equal(row.appReference, true, 'TASK_CONTROL_NOT_ATTRIBUTED');
    const comparison = compareSystemSnapshots(before, after);
    evidence.rejected = comparison.failures.some(
      (failure) =>
        failure.inventory === 'tasks' &&
        failure.name === `\\${name}` &&
        failure.reason === 'added',
    );
    assert.equal(evidence.rejected, true, 'TASK_CONTROL_NOT_REJECTED');
    console.log(
      'RED_CONTROL: disabled run-owned user task is strict, app-attributed and rejected as an added task',
    );
    return evidence;
  } finally {
    if (created) {
      await task('remove');
      const after = await systemSnapshot();
      assert.equal(
        after.tasks.some((row) => row.name === `\\${name}`),
        false,
        'TASK_CONTROL_REMAINS',
      );
      evidence.removed = true;
    }
    await writeFile(
      proofOutput('release-system-positive-control.json'),
      JSON.stringify(evidence, null, 2),
    );
  }
}
