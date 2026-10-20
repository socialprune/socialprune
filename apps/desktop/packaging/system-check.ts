import { join } from 'node:path';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from './windows-powershell.ts';
import { z } from 'zod';
import { directory } from './paths.ts';

const RowSchema = z.strictObject({
  name: z.string().min(1),
  count: z.number().int().positive(),
  strict: z.boolean(),
  appReference: z.boolean(),
  fields: z.record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/),
    z.string().regex(/^[a-f0-9]{64}$/),
  ),
});
const inventory = z.array(RowSchema).superRefine((rows, context) => {
  if (new Set(rows.map((row) => row.name.toLowerCase())).size !== rows.length)
    context.addIssue({ code: 'custom', message: 'SYSTEM_DUPLICATE_NAME' });
});
const SnapshotSchema = z.strictObject({
  version: z.literal(2),
  services: inventory,
  tasks: inventory,
  runKeys: inventory,
  firewall: inventory,
  listeners: z.array(z.string()),
  startup: inventory,
  absent: z.array(z.string()).optional(),
});
export type SystemSnapshot = z.infer<typeof SnapshotSchema>;
const inventories = [
  'services',
  'tasks',
  'runKeys',
  'firewall',
  'startup',
] as const;
export type SystemChange = {
  inventory: (typeof inventories)[number];
  name: string;
  fields: string[];
  reason:
    | 'added'
    | 'removed'
    | 'entry-count'
    | 'user-writable'
    | 'app-reference'
    | 'unattributed-system-configuration';
};
export type SystemComparison = {
  failures: SystemChange[];
  diagnostics: SystemChange[];
};

export function compareSystemSnapshots(
  before: SystemSnapshot,
  after: SystemSnapshot,
): SystemComparison {
  SnapshotSchema.parse(before);
  SnapshotSchema.parse(after);
  const result: SystemComparison = { failures: [], diagnostics: [] };
  for (const key of inventories) {
    const oldRows = new Map(
      before[key].map((row) => [row.name.toLowerCase(), row]),
    );
    const newRows = new Map(
      after[key].map((row) => [row.name.toLowerCase(), row]),
    );
    for (const name of [
      ...new Set([...oldRows.keys(), ...newRows.keys()]),
    ].sort()) {
      const old = oldRows.get(name),
        current = newRows.get(name);
      if (!old || !current) {
        result.failures.push({
          inventory: key,
          name: (current ?? old)!.name,
          fields: [],
          reason: old ? 'removed' : 'added',
        });
        continue;
      }
      const fields = [
        ...new Set([
          ...Object.keys(old.fields),
          ...Object.keys(current.fields),
        ]),
      ]
        .filter((field) => old.fields[field] !== current.fields[field])
        .sort();
      if (old.strict !== current.strict) fields.push('WritableByToken');
      if (old.appReference !== current.appReference)
        fields.push('AppReference');
      fields.sort();
      if (old.count !== current.count) {
        result.failures.push({
          inventory: key,
          name: current.name,
          fields: [...fields, 'EntryCount'].sort(),
          reason: 'entry-count',
        });
      } else if (fields.length) {
        const reason =
          old.strict || current.strict
            ? 'user-writable'
            : old.appReference || current.appReference
              ? 'app-reference'
              : 'unattributed-system-configuration';
        result[
          reason === 'unattributed-system-configuration'
            ? 'diagnostics'
            : 'failures'
        ].push({ inventory: key, name: current.name, fields, reason });
      }
    }
  }
  return result;
}

// R13, 2026-10-20: fresh-process cold/warm 9,203/5,890 ms; retain the
// earlier restricted/concurrent maximum 44,131 ms (D-R4, 2026-10-19).
// ceil(3 * 44,131 to seconds) = 133 s; next runner query receipts recalibrate.
export const SYSTEM_SNAPSHOT_TIMEOUT_MS = Math.max(
  133_000,
  WINDOWS_QUERY_TIMEOUT_MS,
);

export async function systemSnapshot(): Promise<SystemSnapshot> {
  const { stdout } = await runPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'packaging/system-snapshot.ps1'),
    ],
    {
      timeout: SYSTEM_SNAPSHOT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );
  return SnapshotSchema.parse(JSON.parse(stdout));
}

export function assertSystemUnchanged(
  before: SystemSnapshot,
  after: SystemSnapshot,
): SystemChange[] {
  const result = compareSystemSnapshots(before, after);
  if (result.failures.length)
    throw new Error(
      `SYSTEM_CHANGED:${result.failures[0]!.inventory}:${JSON.stringify(result.failures)}`,
    );
  return result.diagnostics;
}
