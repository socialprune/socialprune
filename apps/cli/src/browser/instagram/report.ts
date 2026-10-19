import { CLI_ERRORS, CliError } from '../../cli/errors.ts';
import type { CliErrorCode } from '../../cli/errors.ts';
import { z } from 'zod';

export const ContextStepReportSchema = z.looseObject({
  confirmedBy: z.enum(['post', 'list']).optional(),
  ownerLinksOneAccount: z.boolean().optional(),
  ownerEqualsExport: z.boolean().optional(),
  firstProfileNamesOwner: z.boolean().optional(),
});

export const CONTEXT_STOP_TOKENS = [
  'login',
  'challenge',
  'checkpoint',
  'locked',
  'rate-limit',
  'notice-error',
  'http-429',
  'rate-signal',
  'list-timeout',
  'post-timeout',
  'navigation',
  'browser-closed',
  'extensions-added',
  'account-readback',
  'account-changed',
  'page-language',
  'row-structure',
  'filter-control',
  'post-structure',
  'comment-structure',
  'unexpected-action',
  'unexpected-page',
  'request-journal',
  'second-source',
  'field-mismatch',
  'canary-check',
  'disk-low',
  'stopped',
] as const;
export type ContextStopToken = (typeof CONTEXT_STOP_TOKENS)[number];
export class ContextStop extends CliError {
  readonly token: ContextStopToken;
  constructor(code: CliErrorCode, token: ContextStopToken) {
    super(code);
    this.token = token;
  }
}
export function stopDetails(error: unknown): { code: string; token: string } {
  if (
    error instanceof ContextStop &&
    CONTEXT_STOP_TOKENS.some((token) => token === error.token)
  )
    return { code: error.code, token: error.token };
  if (error instanceof CliError && Object.hasOwn(CLI_ERRORS, error.code))
    return { code: error.code, token: error.code };
  if (error && typeof error === 'object' && 'code' in error)
    for (const code of [
      'EEXIST',
      'ENOSPC',
      'EACCES',
      'EPERM',
      'ENOENT',
      'EBUSY',
    ] as const)
      if (error.code === code)
        return { code: `fs-${code}`, token: `fs-${code}` };
  return {
    code: error instanceof TypeError ? 'type-error' : 'other',
    token: error instanceof TypeError ? 'type-error' : 'other',
  };
}
const KEYS = new Set([
  'data',
  'items',
  'media',
  'code',
  'user',
  'owner',
  'username',
  'taken_at',
  'caption',
  'text',
  'image_versions2',
  'candidates',
  'url',
  'carousel_media',
  'comments',
  'id',
  'pk',
  'edges',
  'node',
  'shortcode',
  'timestamp',
  'display_url',
]);
export function keyPaths(body: unknown, equal?: unknown): string[] {
  const paths = new Set<string>();
  let visited = 0;
  function walk(value: unknown, path: string, depth: number): void {
    if (++visited > 100000 || depth > 40) return;
    if (equal === undefined || value === equal) paths.add(path || '*');
    if (Array.isArray(value))
      for (const entry of value) walk(entry, path + '[]', depth + 1);
    else if (value && typeof value === 'object')
      for (const [key, entry] of Object.entries(value))
        walk(
          entry,
          (path ? path + '.' : '') +
            (KEYS.has(key) ? key.replace(/\d/g, '') : '*'),
          depth + 1,
        );
  }
  walk(body, '', 0);
  return [...paths].sort();
}
export function pairedCode(body: unknown): boolean {
  let visits = 0;
  function walk(input: unknown, depth: number): boolean {
    if (++visits > 100000 || depth > 40) return false;
    if (Array.isArray(input))
      return input.some((value) => walk(value, depth + 1));
    if (!input || typeof input !== 'object') return false;
    const value = input as Record<string, unknown>;
    return (
      (typeof value.code === 'string' &&
        ('comment_id' in value || 'text' in value)) ||
      Object.values(value).some((entry) => walk(entry, depth + 1))
    );
  }
  return walk(body, 0);
}
