import {
  lstat,
  readFile,
  open,
  unlink,
  rename,
  readdir,
} from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { XWarningKindSchema, UtcTimestampSchema } from '@socialprune/core';
import { CliError } from '../cli/errors.ts';
import { canonicalProfileDirectory } from './profile-path.ts';
import { setTimeout as delay } from 'node:timers/promises';

export const X_WARNING_FILE = 'socialprune-x-warning.json';
type Platform = 'x' | 'instagram';
const warningFile = (platform: Platform) =>
  `socialprune-${platform}-warning.json`;
const profileQueues = new Map<string, Promise<unknown>>();
async function serialized<T>(
  profile: string,
  action: () => Promise<T>,
): Promise<T> {
  const key = process.platform === 'win32' ? profile.toLowerCase() : profile;
  const prior = profileQueues.get(key) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(action);
  profileQueues.set(key, next);
  try {
    return await next;
  } finally {
    if (profileQueues.get(key) === next) profileQueues.delete(key);
  }
}
// Persistence-only retries: at most five renames and 500 ms of waits. Never
// delete the old marker before replacement or retry a platform operation.
export const WARNING_RENAME_WAITS_MS = [50, 100, 150, 200] as const;
async function replaceWarning(
  source: string,
  destination: string,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (
        process.platform !== 'win32' ||
        attempt >= WARNING_RENAME_WAITS_MS.length ||
        !(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          ['EPERM', 'EBUSY'].includes(String(error.code))
        )
      )
        throw error;
      await delay(WARNING_RENAME_WAITS_MS[attempt]);
    }
  }
}

async function removePart(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if (!(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ))
      throw error;
  });
}

/** Temp bytes are never warning evidence. Only a positively dead writer's
 * regular file may be removed; live, unknown and legacy owners are ignored. */
async function cleanWarningParts(
  profile: string,
  platform: Platform,
): Promise<void> {
  const WARNING_PART = new RegExp(
    `^\\.socialprune-${platform}-warning-([1-9]\\d{0,9})-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.part$`,
    'i',
  );
  for (const entry of await readdir(profile, { withFileTypes: true })) {
    const match = WARNING_PART.exec(entry.name);
    if (!match || !entry.isFile() || entry.isSymbolicLink()) continue;
    const pid = Number(match[1]);
    if (pid === process.pid || pid > 2147483647) continue;
    try {
      process.kill(pid, 0);
      continue;
    } catch (error) {
      if (!(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ESRCH'
      ))
        continue;
    }
    const path = join(profile, entry.name);
    const stat = await lstat(path).catch((error: unknown) => {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return null;
      throw error;
    });
    if (stat?.isFile() && !stat.isSymbolicLink()) await removePart(path);
  }
}
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
async function warningProfileDirectory(
  profile: string,
): Promise<string | null> {
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
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new CliError('PROFILE_INVALID');
  return canonicalProfileDirectory(profile);
}
export async function readXWarningFile(
  profile: string,
  platform: Platform = 'x',
): Promise<XWarningFile | null> {
  const directory = await warningProfileDirectory(profile);
  if (!directory) return null;
  profile = directory;
  await cleanWarningParts(profile, platform);
  const path = join(profile, warningFile(platform));
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
  platform: Platform = 'x',
): Promise<void> {
  WarningFileSchema.parse(value);
  profile = await canonicalProfileDirectory(profile);
  await serialized(profile, async () => {
    const prior = await readXWarningFile(profile, platform);
    if (prior && JSON.stringify(prior) === JSON.stringify(value)) return;
    if (
      prior &&
      (prior.runId === value.runId || prior.createdAt > value.createdAt)
    )
      return;
    const temporary = join(
      profile,
      `.socialprune-${platform}-warning-${process.pid}-${crypto.randomUUID()}.part`,
    );
    const handle = await open(temporary, 'wx');
    try {
      try {
        await handle.writeFile(JSON.stringify(value));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await replaceWarning(temporary, join(profile, warningFile(platform)));
    } finally {
      await removePart(temporary);
    }
  });
}
export async function requireXWarningFileClear(
  profile: string,
  at: string,
  zone: string,
  platform: Platform = 'x',
): Promise<void> {
  const directory = await warningProfileDirectory(profile);
  if (!directory) return;
  profile = directory;
  await serialized(profile, async () => {
    const warning = await readXWarningFile(profile, platform);
    if (!warning) return;
    if (
      day(at, warning.zone) <= warning.day ||
      day(at, zone) <= day(warning.createdAt, zone)
    )
      throw new CliError(platform === 'x' ? 'X_WARNING_DAY' : 'IG_WARNING_DAY');
    throw new CliError(
      platform === 'x' ? 'X_WARNING_CARD_REQUIRED' : 'IG_WARNING_CARD_REQUIRED',
    );
  });
}
export async function clearXWarningFile(
  profile: string,
  runId: string,
  platform: Platform = 'x',
): Promise<void> {
  profile = await canonicalProfileDirectory(profile);
  await serialized(profile, async () => {
    const warning = await readXWarningFile(profile, platform);
    if (!warning) return;
    if (warning.runId !== runId)
      throw new CliError(
        platform === 'x'
          ? 'X_WARNING_CARD_REQUIRED'
          : 'IG_WARNING_CARD_REQUIRED',
      );
    await unlink(join(profile, warningFile(platform)));
  });
}
export function xWarningFileDay(at: string, zone: string): string {
  return day(at, zone);
}
