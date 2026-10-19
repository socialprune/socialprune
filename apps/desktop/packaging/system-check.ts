import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
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
): SystemChange[] {
  const result = compareSystemSnapshots(before, after);
  if (result.failures.length)
    throw new Error(
      `SYSTEM_CHANGED:${result.failures[0]!.inventory}:${JSON.stringify(result.failures)}`,
    );
  return result.diagnostics;
}
