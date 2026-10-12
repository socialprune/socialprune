import { z } from 'zod';
import { UtcTimestampSchema } from './v1.ts';

const id = z.string().min(1).max(512);
export const BrowserActionSchema = z.enum([
  'delete-post',
  'undo-repost',
  'verify',
  'read-post',
]);
export const BrowserAttemptStateSchema = z.enum([
  'withdrawn',
  'sending',
  'deleted',
  'not-found',
  'failed',
  'ambiguous',
  'not-deleted',
  'still-gone',
  'reappeared',
  'read',
  'tombstone',
  'unavailable',
]);
export const BrowserRequestSchema = z.strictObject({
  runId: id.optional(),
  requestId: id,
  method: z.string().min(1).max(16),
  host: z.string().min(1).max(512),
  path: z.string().min(1).max(4096),
  status: z.number().int().min(100).max(599).nullable(),
});
export const BrowserProfileReportSchema = z.strictObject({
  accountBefore: z.string().nullable(),
  accountAfter: z.string().nullable(),
  extensionsBefore: z.number().int().nonnegative(),
  extensionsAfter: z.number().int().nonnegative(),
  changedFiles: z.array(z.string()),
  unexpectedRequests: z.array(BrowserRequestSchema),
});
export const BrowserRunSchema = z.strictObject({
  runId: id,
  platform: z.literal('x'),
  accountKey: id,
  mode: z.enum(['delete', 'verify', 'fill']),
  planHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  startedAt: UtcTimestampSchema,
  endedAt: UtcTimestampSchema.nullable(),
  endReason: z
    .enum([
      'done',
      'daily-cap',
      'stopped-by-person',
      'error',
      'platform-check',
      'canary',
      'size-cap',
      'shape-changed',
    ])
    .nullable(),
  bodyShapes: z.record(z.string(), z.array(z.string())),
  profileReport: BrowserProfileReportSchema.nullable(),
  ownerPid: z.number().int().positive().optional(),
  canaryAcceptedAt: UtcTimestampSchema.nullable().optional(),
  pageOpens: z.number().int().nonnegative().optional(),
  lastPageOpenedAt: UtcTimestampSchema.nullable().optional(),
});
export const BrowserAttemptSchema = z.strictObject({
  seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  attemptId: id,
  runId: id,
  itemId: id.nullable(),
  originalId: z
    .string()
    .regex(/^\d{1,40}$/)
    .nullable()
    .optional(),
  action: BrowserActionSchema,
  state: BrowserAttemptStateSchema,
  settles: id.nullable(),
  at: UtcTimestampSchema,
  code: z.string().nullable(),
  receipt: z
    .strictObject({
      method: z.string().min(1).max(16),
      path: z.string().min(1),
      status: z.number().int().min(100).max(599),
      shape: z.array(z.string()),
    })
    .optional(),
});
export type BrowserAction = z.infer<typeof BrowserActionSchema>;
export type BrowserAttempt = z.infer<typeof BrowserAttemptSchema>;
export type BrowserRun = z.infer<typeof BrowserRunSchema>;
export type BrowserRequest = z.infer<typeof BrowserRequestSchema>;
export type BrowserProfileReport = z.infer<typeof BrowserProfileReportSchema>;

/** Read-only graph check used by restore. No platform capability lives in core. */
export function validateBrowserJournal(
  runs: readonly BrowserRun[],
  attempts: readonly BrowserAttempt[],
  itemIds: ReadonlySet<string>,
  originalIds: ReadonlySet<string> = new Set(),
): void {
  const knownRuns = new Map<string, BrowserRun>();
  for (const input of runs) {
    const run = BrowserRunSchema.parse(input);
    if (
      run.canaryAcceptedAt !== undefined &&
      run.canaryAcceptedAt !== null &&
      (run.mode !== 'fill' ||
        run.endReason !== 'canary' ||
        !run.endedAt ||
        Date.parse(run.canaryAcceptedAt) < Date.parse(run.endedAt))
    )
      throw new Error('INVALID_BROWSER_JOURNAL');
    if (
      knownRuns.has(run.runId) ||
      (run.endedAt === null) !== (run.endReason === null) ||
      (run.endedAt && Date.parse(run.endedAt) < Date.parse(run.startedAt))
    )
      throw new Error('INVALID_BROWSER_JOURNAL');
    knownRuns.set(run.runId, run);
  }
  const known = new Map<string, BrowserAttempt>();
  const settled = new Set<string>();
  let seq = 0;
  for (const input of attempts) {
    const value = BrowserAttemptSchema.parse(input);
    const run = knownRuns.get(value.runId);
    if (
      !run ||
      (value.action === 'read-post'
        ? value.itemId !== null ||
          !value.originalId ||
          !originalIds.has(value.originalId) ||
          run.mode !== 'fill'
        : value.itemId === null ||
          !itemIds.has(value.itemId) ||
          !value.itemId.startsWith('x:') ||
          Boolean(value.originalId)) ||
      known.has(value.attemptId) ||
      value.seq <= seq
    )
      throw new Error('INVALID_BROWSER_JOURNAL');
    if (value.settles !== null) {
      const prior = known.get(value.settles);
      if (
        !prior ||
        !['sending', 'ambiguous'].includes(prior.state) ||
        prior.itemId !== value.itemId ||
        prior.originalId !== value.originalId ||
        prior.runId !== value.runId ||
        prior.action !== value.action ||
        settled.has(prior.attemptId) ||
        !(
          value.action === 'read-post'
            ? ['read', 'not-found', 'tombstone', 'unavailable', 'failed']
            : ['deleted', 'failed', 'ambiguous', 'not-deleted']
        ).includes(value.state)
      )
        throw new Error('INVALID_BROWSER_JOURNAL');
      settled.add(prior.attemptId);
    } else if (
      (value.action === 'read-post' && value.state !== 'sending') ||
      (!['sending', 'withdrawn', 'not-found'].includes(value.state) &&
        !(
          value.action === 'verify' &&
          ['still-gone', 'not-deleted', 'reappeared'].includes(value.state)
        ))
    )
      throw new Error('INVALID_BROWSER_JOURNAL');
    seq = value.seq;
    known.set(value.attemptId, value);
  }
}

export function validateBrowserOutcomes(
  attempts: readonly BrowserAttempt[],
  events: readonly {
    itemId: string;
    value: string;
    source: { via: string };
    action: { id: string };
  }[],
): void {
  const byId = new Map(attempts.map((attempt) => [attempt.attemptId, attempt]));
  const referenced = new Set<string>();
  for (const event of events)
    if (event.source.via === 'browser-x') {
      const attempt = byId.get(event.action.id);
      if (
        !attempt ||
        attempt.itemId !== event.itemId ||
        referenced.has(attempt.attemptId) ||
        !(
          (event.value === 'deleted-via-browser' &&
            attempt.state === 'deleted') ||
          (event.value === 'unknown' &&
            attempt.state === 'reappeared' &&
            attempt.action === 'verify')
        )
      )
        throw new Error('INVALID_BROWSER_OUTCOME');
      referenced.add(attempt.attemptId);
    }
  for (const attempt of attempts)
    if (
      ['deleted', 'reappeared'].includes(attempt.state) &&
      !referenced.has(attempt.attemptId)
    )
      throw new Error('INVALID_BROWSER_OUTCOME');
}
