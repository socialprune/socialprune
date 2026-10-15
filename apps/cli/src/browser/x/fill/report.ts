import { object } from '@socialprune/core';
import { z } from 'zod';
import {
  CliError,
  CLI_ERRORS,
  platformCheckReason,
} from '../../../cli/errors.ts';
import type { CliErrorCode, PlatformCheckReason } from '../../../cli/errors.ts';

interface XWindow {
  operation: string;
  limit: number;
  lowestRemaining: number;
  responses: number;
  longestResetSeconds: number;
  latestRemaining: number;
  latestReset: number;
}
/** Only header numbers and bounded operation identities leave this monitor. */
export class XResponseWindows {
  private readonly windows = new Map<string, XWindow>();
  private readonly testOrigin?: string;
  constructor(testOrigin?: string) {
    this.testOrigin = testOrigin;
  }
  accepts(url: string): boolean {
    try {
      const parsed = new URL(url);
      return this.testOrigin === undefined
        ? parsed.protocol === 'https:' &&
            ['x.com', 'api.x.com'].includes(parsed.hostname) &&
            !parsed.port &&
            !parsed.username &&
            !parsed.password
        : parsed.origin === this.testOrigin;
    } catch {
      return false;
    }
  }
  observe(url: string, headers: Record<string, string>, now: number): void {
    if (!this.accepts(url)) return;
    const names = [
      'x-rate-limit-limit',
      'x-rate-limit-remaining',
      'x-rate-limit-reset',
    ] as const;
    if (names.some((name) => !/^\d+$/.test(headers[name] ?? ''))) return;
    const limit = Number(headers[names[0]]),
      remaining = Number(headers[names[1]]),
      reset = Number(headers[names[2]]);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isSafeInteger(remaining) ||
      remaining < 0 ||
      !Number.isSafeInteger(reset) ||
      reset < 0 ||
      !Number.isSafeInteger(reset * 1000)
    )
      return;
    const path = new URL(url).pathname;
    const operation =
      path.match(/^\/i\/api\/graphql\/[^/]+\/([A-Za-z0-9_]{1,64})\/?$/)?.[1] ??
      (path.includes('/graphql/')
        ? 'graphql-other'
        : path.startsWith('/i/api/')
          ? 'api-other'
          : 'other');
    const prior = this.windows.get(operation);
    const longest = Math.max(0, Math.ceil((reset * 1000 - now) / 1000));
    this.windows.set(operation, {
      operation,
      limit,
      latestRemaining: remaining,
      latestReset: reset * 1000,
      lowestRemaining: Math.min(prior?.lowestRemaining ?? remaining, remaining),
      responses: (prior?.responses ?? 0) + 1,
      longestResetSeconds: Math.max(prior?.longestResetSeconds ?? 0, longest),
    });
  }
  beforePage(
    now: number,
  ):
    | { kind: 'ready' }
    | { kind: 'long' }
    | { kind: 'wait'; ms: number; minutes: number } {
    const low = [...this.windows.values()].filter(
      (window) =>
        window.latestRemaining < window.limit / 2 && window.latestReset > now,
    );
    if (low.some((window) => window.latestReset - now > 16 * 60000))
      return { kind: 'long' };
    if (!low.length) return { kind: 'ready' };
    const ms =
      Math.max(...low.map((window) => window.latestReset - now)) + 5000;
    return { kind: 'wait', ms, minutes: Math.ceil(ms / 60000) };
  }
  summary(): {
    operation: string;
    limit: number;
    lowestRemaining: number;
    responses: number;
    longestResetSeconds: number;
  }[] {
    return [...this.windows.values()]
      .sort((a, b) => a.operation.localeCompare(b.operation))
      .map(
        ({
          operation,
          limit,
          lowestRemaining,
          responses,
          longestResetSeconds,
        }) => ({
          operation,
          limit,
          lowestRemaining,
          responses,
          longestResetSeconds,
        }),
      );
  }
}

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
