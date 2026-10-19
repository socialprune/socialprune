import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { directory } from './paths.ts';

const SnapshotSchema = z.strictObject({
  services: z.array(z.string()),
  tasks: z.array(z.string()),
  runKeys: z.array(z.string()),
  firewall: z.array(z.string()),
  listeners: z.array(z.string()),
  startup: z.array(z.string()),
});
export type SystemSnapshot = z.infer<typeof SnapshotSchema>;

export async function systemSnapshot(): Promise<SystemSnapshot> {
  const { stdout } = await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'packaging/system-snapshot.ps1'),
    ],
    { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
  return SnapshotSchema.parse(JSON.parse(stdout));
}

export function assertSystemUnchanged(
  before: SystemSnapshot,
  after: SystemSnapshot,
): void {
  SnapshotSchema.parse(before);
  SnapshotSchema.parse(after);
  // Keep the whole-machine socket inventory as diagnostic evidence only.
  // D-R2: another lane's listener lifetime cannot be attributed to this app.
  // network-watch.ps1 checks both install-root images and owned descendants.
  for (const key of [
    'services',
    'tasks',
    'runKeys',
    'firewall',
    'startup',
  ] as const) {
    const oldRows = new Set(before[key]);
    const newRows = new Set(after[key]);
    const added = [...newRows].filter((row) => !oldRows.has(row)).sort();
    const removed = [...oldRows].filter((row) => !newRows.has(row)).sort();
    if (added.length || removed.length)
      throw new Error(
        `SYSTEM_CHANGED:${key}:${JSON.stringify({ added, removed })}`,
      );
  }
}
