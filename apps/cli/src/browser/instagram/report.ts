import { CLI_ERRORS, CliError } from '../../cli/errors.ts';
import type { CliErrorCode } from '../../cli/errors.ts';
import { z } from 'zod';
import { POST_PATH_CLASSES } from './signals.ts';

const count = z.number().int().nonnegative();
const sourceCountSchema = z.strictObject({
  responses: count,
  bodies: count,
  single: count,
  sequence: count,
  failed: count,
  responsesWithCode: count,
  bodiesWithCode: count,
});
const sourceFieldsSchema = z.strictObject({
  owner: z.boolean(),
  time: z.boolean(),
  caption: z.boolean(),
  image: z.boolean(),
});
export const SecondSourceReportSchema = z.strictObject({
  contentTypes: z.strictObject({
    json: sourceCountSchema,
    javascript: sourceCountSchema,
  }),
  objects: z
    .array(
      z.strictObject({
        path: z
          .string()
          .max(1024)
          .refine((path) =>
            path.split('.').every((part) => {
              const stem = part.replace(/(?:\[\])+$/u, '');
              return (
                /^(?:[a-z_]+|\*)?(?:\[\])*$/u.test(part) &&
                (REPORT_KEYS.has(stem) || (stem === '' && part.length > 0))
              );
            }),
          ),
        keys: z.array(z.string().refine((key) => REPORT_KEYS.has(key))).max(64),
        keysCapped: z.boolean(),
        fields: sourceFieldsSchema,
      }),
    )
    .max(64),
  objectsCapped: z.boolean(),
  skippedParameters: count,
});
export type SecondSourceReport = z.infer<typeof SecondSourceReportSchema>;
export const BODY_CLASSES = [
  'bare-not-found',
  'json',
  'html',
  'empty',
  'other',
  'unreadable',
  'large',
  'not-classified',
] as const;
export type BodyClass = (typeof BODY_CLASSES)[number];
export const PostRequestsSchema = z
  .array(
    z
      .strictObject({
        path: z.enum(POST_PATH_CLASSES),
        status: z.number().int().min(100).max(599),
        count: z.number().int().positive(),
        bodyClasses: z
          .array(
            z.strictObject({
              class: z.enum(BODY_CLASSES),
              count: z.number().int().positive(),
            }),
          )
          .max(BODY_CLASSES.length)
          .optional(),
      })
      .refine((group) => {
        if (group.status < 400 || group.status > 499)
          return group.bodyClasses === undefined;
        return (
          group.bodyClasses !== undefined &&
          new Set(group.bodyClasses.map((body) => body.class)).size ===
            group.bodyClasses.length &&
          group.bodyClasses.reduce((sum, body) => sum + body.count, 0) ===
            group.count
        );
      }),
  )
  .max(POST_PATH_CLASSES.length * 500);
export type PostRequestStatus = z.infer<typeof PostRequestsSchema>[number];

export const ContextStepReportSchema = z.looseObject({
  postRequests: PostRequestsSchema.optional(),
  secondSource: SecondSourceReportSchema.optional(),
  otherName: z.number().int().nonnegative().optional(),
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
export const AccountCheckSchema = z
  .strictObject({
    profileLinkFound: z.boolean(),
    outsidePathCount: count,
    rows: count,
    ownRows: count,
    elapsedMs: count,
    reads: z.number().int().positive(),
    lastReadAfterDeadline: z.boolean(),
  })
  .refine((value) => value.ownRows <= value.rows);
export type AccountCheck = z.infer<typeof AccountCheckSchema>;
export const ACCOUNT_CLASSES = ['expected', 'absent', 'other'] as const;
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];
export const AccountReadbackSchema = z.strictObject({
  accountBeforeClass: z.enum(ACCOUNT_CLASSES),
  accountAfterClass: z.enum(ACCOUNT_CLASSES),
});
export function accountClass(
  expected: string,
  paths: readonly string[],
): AccountClass {
  const profiles = paths.filter((path) =>
    /^\/[A-Za-z0-9_.]{1,30}\/$/.test(path),
  );
  if (
    profiles.some(
      (path) => path.toLowerCase() === `/${expected.toLowerCase()}/`,
    )
  )
    return 'expected';
  return profiles.length ? 'other' : 'absent';
}
export class ContextStop extends CliError {
  readonly token: ContextStopToken;
  readonly accountCheck?: AccountCheck;
  constructor(
    code: CliErrorCode,
    token: ContextStopToken,
    accountCheck?: AccountCheck,
  ) {
    super(code);
    this.token = token;
    if (
      accountCheck &&
      code === 'ACCOUNT_MISMATCH' &&
      token === 'account-changed'
    )
      this.accountCheck = Object.freeze(AccountCheckSchema.parse(accountCheck));
  }
}
export const CONTEXT_CAUSE_STAGES = [
  'run',
  'run-start',
  'browser-launch',
  'browser-setup',
  'start',
  'checkpoint',
  'pace',
  'attempt',
  'list-read',
  'post-open',
  'post-read',
  'capture',
  'compare',
  'settlement',
  'canary-check',
  'progress',
  'answers',
  'network',
  'manual-match',
  'snapshot',
  'read-back',
  'structure-report',
  'extension-report',
  'automatic-check',
  'audit',
  'end-run',
  'acceptance',
  'browser-close',
  'confirmation-close',
  'projection',
] as const;
export type ContextCauseStage = (typeof CONTEXT_CAUSE_STAGES)[number];
const CAUSE_TOKENS = [
  'browser-timeout',
  'browser-closed',
  'aborted',
  'type-error',
  'range-error',
  'reference-error',
  'syntax-error',
  'unexpected-error',
  'unexpected-value',
  'fs-EEXIST',
  'fs-ENOSPC',
  'fs-EACCES',
  'fs-EPERM',
  'fs-ENOENT',
  'fs-EBUSY',
  'socket-EADDRINUSE',
  'socket-ECONNRESET',
  'socket-ECONNREFUSED',
  'socket-ETIMEDOUT',
  'sqlite-busy',
  'sqlite-error',
] as const;
type CauseToken = (typeof CAUSE_TOKENS)[number];
export const ContextCauseSchema = z.strictObject({
  runId: z.uuid(),
  stage: z.enum(CONTEXT_CAUSE_STAGES),
  step: z.number().int().nonnegative(),
  token: z.enum(CAUSE_TOKENS),
  chain: z.array(z.enum(CAUSE_TOKENS)).min(1).max(4),
});
function causeToken(error: unknown): CauseToken {
  if (error && typeof error === 'object') {
    if ('code' in error) {
      for (const code of [
        'EEXIST',
        'ENOSPC',
        'EACCES',
        'EPERM',
        'ENOENT',
        'EBUSY',
      ] as const)
        if (error.code === code) return `fs-${code}`;
      for (const code of [
        'EADDRINUSE',
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
      ] as const)
        if (error.code === code) return `socket-${code}`;
      if (error.code === 'ERR_SQLITE_ERROR') {
        return 'errcode' in error &&
          (error.errcode === 5 || error.errcode === 6)
          ? 'sqlite-busy'
          : 'sqlite-error';
      }
    }
    if ('name' in error) {
      if (error.name === 'TimeoutError') return 'browser-timeout';
      if (error.name === 'TargetClosedError') return 'browser-closed';
      if (error.name === 'AbortError') return 'aborted';
    }
  }
  if (error instanceof TypeError) return 'type-error';
  if (error instanceof RangeError) return 'range-error';
  if (error instanceof ReferenceError) return 'reference-error';
  if (error instanceof SyntaxError) return 'syntax-error';
  return error instanceof Error ? 'unexpected-error' : 'unexpected-value';
}
export function contextCause(
  error: unknown,
  runId: string,
  stage: ContextCauseStage,
  step: number,
) {
  return ContextCauseSchema.parse({ runId, stage, step, ...causeChain(error) });
}
function causeChain(error: unknown) {
  const seen = new Set<unknown>();
  const chain: CauseToken[] = [];
  let current = error;
  while (chain.length < 4 && !seen.has(current)) {
    seen.add(current);
    chain.push(causeToken(current));
    if (
      !current ||
      typeof current !== 'object' ||
      !('cause' in current) ||
      current.cause === undefined
    )
      break;
    current = current.cause;
  }
  const token =
    [...chain]
      .reverse()
      .find(
        (value) => !['unexpected-error', 'unexpected-value'].includes(value),
      ) ?? chain[0]!;
  return { token, chain };
}
export function stopDetails(error: unknown): {
  code: string;
  token: string;
  accountCheck?: AccountCheck;
} {
  if (
    error instanceof ContextStop &&
    CONTEXT_STOP_TOKENS.some((token) => token === error.token)
  )
    return {
      code: error.code,
      token: error.token,
      ...(error.accountCheck
        ? { accountCheck: AccountCheckSchema.parse(error.accountCheck) }
        : {}),
    };
  if (error instanceof CliError && Object.hasOwn(CLI_ERRORS, error.code))
    return { code: error.code, token: error.code };
  const { token } = causeChain(error);
  return { code: token, token };
}
export function stopDetailText(error: unknown): string {
  const detail = stopDetails(error),
    account = detail.accountCheck;
  return (
    detail.token +
    (account
      ? `; link=${account.profileLinkFound}; outsidePathCount=${account.outsidePathCount}; rows=${account.rows}; own=${account.ownRows}; reads=${account.reads}; elapsedMs=${account.elapsedMs}; lastReadAfterDeadline=${account.lastReadAfterDeadline}`
      : '')
  );
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
const REPORT_KEYS = new Set([...KEYS].map((key) => key.replace(/\d/g, '')));
REPORT_KEYS.add('*');
export function reportKey(key: string): string {
  return KEYS.has(key) ? key.replace(/\d/g, '') : '*';
}
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
        walk(entry, (path ? path + '.' : '') + reportKey(key), depth + 1);
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
