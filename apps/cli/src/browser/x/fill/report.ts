import { object } from '@socialprune/core';
import { z } from 'zod';
import {
  CliError,
  CLI_ERRORS,
  platformCheckReason,
} from '../../../cli/errors.ts';
import type { CliErrorCode, PlatformCheckReason } from '../../../cli/errors.ts';

export { XResponseWindows } from '../rate-windows.ts';

export type ErrorStopClass =
  | 'media-origin'
  | 'media-format'
  | 'media-exists'
  | 'original-path'
  | 'fs-EEXIST'
  | 'fs-ENOSPC'
  | 'fs-EACCES'
  | 'fs-EPERM'
  | 'fs-ENOENT'
  | 'fs-EBUSY'
  | 'type-error'
  | 'other';
export interface StopDetails {
  code: CliErrorCode | ErrorStopClass;
  reason?: PlatformCheckReason;
}
export function errorStop(value: unknown): StopDetails {
  if (value instanceof CliError && Object.hasOwn(CLI_ERRORS, value.code))
    return {
      code: value.code,
      ...(value.code === 'PLATFORM_CHECK'
        ? { reason: platformCheckReason(value.reason) ?? 'unspecified' }
        : {}),
    };
  const code = object(value).code;
  for (const candidate of [
    'EEXIST',
    'ENOSPC',
    'EACCES',
    'EPERM',
    'ENOENT',
    'EBUSY',
  ] as const)
    if (code === candidate) return { code: `fs-${candidate}` };
  const message = value instanceof Error ? value.message : null;
  for (const [name, token] of [
    ['MEDIA_ORIGIN', 'media-origin'],
    ['MEDIA_FORMAT', 'media-format'],
    ['MEDIA_EXISTS', 'media-exists'],
    ['ORIGINAL_PATH', 'original-path'],
  ] as const)
    if (message === name) return { code: token };
  return { code: value instanceof TypeError ? 'type-error' : 'other' };
}

export function failureToken(value: unknown): string {
  if (value instanceof z.ZodError) return 'projection';
  if (value === 'MEDIA_ORIGIN') return 'media-origin';
  return typeof value === 'string' && /^[a-z][a-z_-]{0,39}$/.test(value)
    ? value
    : 'other';
}

export function structureReport(
  body: unknown,
  failure?: unknown,
): {
  paths: { path: string; type: string }[];
  entries: Record<string, number>;
  failure?: string;
} {
  const paths = new Map<string, string>(),
    entries: Record<string, number> = {};
  function walk(value: unknown, path: string) {
    const type = Array.isArray(value)
      ? 'array'
      : value === null
        ? 'null'
        : typeof value;
    paths.set(path, type);
    if (Array.isArray(value))
      for (const entry of value) walk(entry, path + '[]');
    else if (value && typeof value === 'object')
      for (const [key, entry] of Object.entries(object(value))) {
        if (key === 'entryId' && typeof entry === 'string') {
          const prefix = /^tweet-\d+$/.test(entry)
            ? 'tweet-*'
            : entry.startsWith('cursor-')
              ? 'cursor-*'
              : entry.startsWith('promoted-')
                ? 'promoted-*'
                : 'other';
          entries[prefix] = (entries[prefix] ?? 0) + 1;
        }
        walk(entry, path ? path + '.' + key : key);
      }
  }
  walk(body, '');
  return {
    paths: [...paths].map(([path, type]) => ({ path, type })),
    entries,
    ...(failure === undefined ? {} : { failure: failureToken(failure) }),
  };
}
