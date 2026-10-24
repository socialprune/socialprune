import {
  lstat,
  readFile,
  open,
  unlink,
  rename,
  realpath,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { XWarningKindSchema, UtcTimestampSchema } from '@socialprune/core';
import { CliError } from '../cli/errors.ts';

export const X_WARNING_FILE = 'socialprune-x-warning.json';
const WarningFileSchema = z
  .strictObject({
    runId: z.string().regex(/^[A-Za-z0-9-]{1,128}$/),
    kind: XWarningKindSchema,
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    zone: z
      .string()
      .min(1)
      .max(128)
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }),
    createdAt: UtcTimestampSchema,
  })
  .refine(
    (warning) =>
      warning.day ===
      new Intl.DateTimeFormat('en-CA', {
        timeZone: warning.zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(warning.createdAt)),
  );
export type XWarningFile = z.infer<typeof WarningFileSchema>;
const day = (at: string, zone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
export async function readXWarningFile(
  profile: string,
): Promise<XWarningFile | null> {
  const directory = await lstat(profile).catch((error: unknown) => {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return null;
    throw new CliError('PROFILE_INVALID');
  });
  if (!directory) return null;
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    resolve(profile) !== (await realpath(profile))
  )
    throw new CliError('PROFILE_INVALID');
  const path = join(profile, X_WARNING_FILE);
  const stat = await lstat(path).catch((error: unknown) => {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return null;
    throw new CliError('PROFILE_INVALID');
  });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2048)
    throw new CliError('PROFILE_INVALID');
  try {
    return WarningFileSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    throw new CliError('PROFILE_INVALID');
  }
}
export async function writeXWarningFile(
  profile: string,
  value: XWarningFile,
): Promise<void> {
  WarningFileSchema.parse(value);
  const prior = await readXWarningFile(profile);
  if (
    prior &&
    (prior.runId === value.runId || prior.createdAt > value.createdAt)
  )
    return;
  const temporary = join(
    profile,
    `.socialprune-x-warning-${crypto.randomUUID()}.part`,
  );
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, join(profile, X_WARNING_FILE));
}
export async function requireXWarningFileClear(
  profile: string,
  at: string,
  zone: string,
): Promise<void> {
  const warning = await readXWarningFile(profile);
  if (!warning) return;
  if (
    day(at, warning.zone) <= warning.day ||
    day(at, zone) <= day(warning.createdAt, zone)
  )
    throw new CliError('X_WARNING_DAY');
  throw new CliError('X_WARNING_CARD_REQUIRED');
}
export async function clearXWarningFile(
  profile: string,
  runId: string,
): Promise<void> {
  const warning = await readXWarningFile(profile);
  if (!warning) return;
  if (warning.runId !== runId) throw new CliError('X_WARNING_CARD_REQUIRED');
  await unlink(join(profile, X_WARNING_FILE));
}
export function xWarningFileDay(at: string, zone: string): string {
  return day(at, zone);
}
