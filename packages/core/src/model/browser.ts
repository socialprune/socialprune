import { z } from 'zod';
import { UtcTimestampSchema } from './v1.ts';
import type { Item } from './index.ts';
import type { InstagramContext } from './instagram-context.ts';

const id = z.string().min(1).max(512);
export const XWarningKindSchema = z.enum([
  'http-429',
  'limit-notice',
  'warning-notice',
]);
export const BrowserActionSchema = z.enum([
  'delete-post',
  'undo-repost',
  'verify',
  'read-post',
  'confirm-comment',
  'delete-comment',
  'refresh-comment-likes',
  'refresh-comment-replies',
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
  'confirmed',
  'unconfirmed',
  'not-listed',
]);
export const BrowserRequestSchema = z.strictObject({
  runId: id.optional(),
  requestId: id,
  method: z.string().min(1).max(16),
  host: z.string().min(1).max(512),
  path: z.string().min(1).max(4096),
  status: z.number().int().min(100).max(599).nullable(),
  operation: z
    .string()
    .max(256)
    .regex(/^[A-Za-z0-9_]+$/)
    .nullable()
    .optional(),
});
export const BrowserProfileReportSchema = z.strictObject({
  accountBefore: z.string().nullable(),
  accountAfter: z.string().nullable(),
  extensionsBefore: z.number().int().nonnegative(),
  extensionsAfter: z.number().int().nonnegative(),
  changedFiles: z.array(z.string()),
  unexpectedRequests: z.array(BrowserRequestSchema),
});
export const BrowserRunSchema = z
  .strictObject({
    runId: id,
    platform: z.enum(['x', 'instagram']),
    accountKey: id,
    mode: z.enum(['delete', 'verify', 'fill', 'context']),
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
    warningKind: XWarningKindSchema.optional(),
    instagramWarning: z
      .strictObject({
        kind: XWarningKindSchema,
        at: UtcTimestampSchema,
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
      })
      .optional(),
    pageDays: z
      .record(
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        z.number().int().nonnegative(),
      )
      .optional(),
    pageZone: z
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
      })
      .optional(),
  })
  .superRefine((run, ctx) => {
    if (
      run.warningKind &&
      (run.platform !== 'x' ||
        run.endReason !== 'platform-check' ||
        !run.endedAt)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'An X warning belongs to a completed platform-check run.',
      });
    if (
      (run.platform === 'instagram'
        ? !['context', 'delete', 'verify'].includes(run.mode)
        : run.mode === 'context') ||
      !run.accountKey.startsWith(`${run.platform}:`) ||
      (run.canaryAcceptedAt != null &&
        (!(
          ['fill', 'context'].includes(run.mode) ||
          (run.platform === 'instagram' && run.mode === 'delete')
        ) ||
          run.endReason !== 'canary' ||
          !run.endedAt ||
          Date.parse(run.canaryAcceptedAt) < Date.parse(run.endedAt)))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Run platform, mode and acceptance must agree.',
      });
    if (
      run.instagramWarning &&
      (run.platform !== 'instagram' ||
        (run.endedAt
          ? run.endReason !== 'platform-check' ||
            Date.parse(run.instagramWarning.at) > Date.parse(run.endedAt)
          : run.endReason !== null) ||
        Date.parse(run.instagramWarning.at) < Date.parse(run.startedAt))
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'An Instagram warning belongs to its completed platform-check run.',
      });
    if (
      (run.pageDays !== undefined || run.pageZone !== undefined) &&
      (run.platform !== 'instagram' ||
        !run.pageDays ||
        !run.pageZone ||
        Object.values(run.pageDays).reduce((sum, n) => sum + n, 0) !==
          run.pageOpens)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Instagram page days must account for every page.',
      });
    if (
      run.platform === 'instagram' &&
      run.mode !== 'context' &&
      run.planHash === null
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Instagram deletion and verification need a bound plan.',
      });
    if (run.pageDays && run.pageZone) {
      const format = (at: string) =>
        new Intl.DateTimeFormat('en-CA', {
          timeZone: run.pageZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(at));
      const first = format(run.startedAt),
        last = format(run.lastPageOpenedAt ?? run.startedAt);
      if (
        (run.pageOpens !== 0 && !run.lastPageOpenedAt) ||
        Object.entries(run.pageDays).some(
          ([day, count]) => count <= 0 || day < first || day > last,
        )
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Page days fall outside their observed interval.',
        });
    }
  });
export const BrowserAttemptSchema = z
  .strictObject({
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
  })
  .superRefine((attempt, ctx) => {
    if (
      ['refresh-comment-likes', 'refresh-comment-replies'].includes(
        attempt.action,
      )
    ) {
      if (
        !attempt.itemId?.startsWith('instagram:') ||
        attempt.originalId !== undefined ||
        (attempt.settles === null
          ? attempt.state !== 'sending'
          : !['read', 'failed'].includes(attempt.state)) ||
        (attempt.state === 'failed' && !attempt.code)
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Invalid comment likes refresh attempt.',
        });
    } else if (attempt.action === 'confirm-comment') {
      if (
        !attempt.itemId?.startsWith('instagram:') ||
        attempt.originalId !== undefined ||
        (attempt.settles === null
          ? attempt.state !== 'sending'
          : ![
              'confirmed',
              'unconfirmed',
              'not-listed',
              'unavailable',
              'failed',
            ].includes(attempt.state)) ||
        (attempt.state === 'unconfirmed' &&
          !['text', 'time', 'owner', 'several', 'not-shown'].includes(
            attempt.code ?? '',
          )) ||
        (attempt.code === 'list-image-only' &&
          attempt.state !== 'not-listed') ||
        (attempt.state === 'not-listed' &&
          !['no-row', 'window-full', 'list-image-only'].includes(
            attempt.code ?? '',
          )) ||
        (attempt.state === 'failed' && !attempt.code)
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Invalid comment confirmation attempt.',
        });
    } else if (
      ['confirmed', 'unconfirmed', 'not-listed'].includes(attempt.state)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Confirmation states belong to comment confirmation.',
      });
    if (
      attempt.action === 'delete-comment' &&
      (!attempt.itemId?.startsWith('instagram:') ||
        attempt.originalId !== undefined ||
        (attempt.settles === null
          ? !['sending', 'withdrawn'].includes(attempt.state)
          : !['deleted', 'failed', 'ambiguous', 'not-deleted'].includes(
              attempt.state,
            )))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Instagram deletion attempts require comment-bound states.',
      });
  });
export type BrowserAction = z.infer<typeof BrowserActionSchema>;
export type BrowserAttempt = z.infer<typeof BrowserAttemptSchema>;
export type BrowserRun = z.infer<typeof BrowserRunSchema>;
export type BrowserRequest = z.infer<typeof BrowserRequestSchema>;
export type BrowserProfileReport = z.infer<typeof BrowserProfileReportSchema>;

/** Same write-once run transitions in SQLite, IndexedDB and the reference store. */
export function validateBrowserRunUpdate(
  prior: BrowserRun,
  next: BrowserRun,
): void {
  BrowserRunSchema.parse(next);
  const without = (value: BrowserRun, keys: readonly string[]) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !keys.includes(key))
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
  if (prior.endedAt) {
    if (
      !(
        ['fill', 'context'].includes(prior.mode) ||
        (prior.platform === 'instagram' && prior.mode === 'delete')
      ) ||
      prior.endReason !== 'canary' ||
      prior.canaryAcceptedAt ||
      !next.canaryAcceptedAt ||
      without(prior, ['canaryAcceptedAt']) !==
        without(next, ['canaryAcceptedAt'])
    )
      throw new Error('RUN_WRITE_ONCE');
    return;
  }
  if (next.endedAt) {
    if (
      without(prior, [
        'endedAt',
        'endReason',
        'bodyShapes',
        'profileReport',
        'warningKind',
        'instagramWarning',
      ]) !==
        without(next, [
          'endedAt',
          'endReason',
          'bodyShapes',
          'profileReport',
          'warningKind',
          'instagramWarning',
        ]) ||
      (prior.instagramWarning &&
        JSON.stringify(prior.instagramWarning) !==
          JSON.stringify(next.instagramWarning))
    )
      throw new Error('RUN_WRITE_ONCE');
    return;
  }
  if (
    !prior.instagramWarning &&
    next.instagramWarning &&
    without(prior, ['instagramWarning']) === without(next, ['instagramWarning'])
  )
    return;
  const fields = ['pageOpens', 'lastPageOpenedAt', 'pageDays', 'pageZone'];
  if (
    without(prior, fields) !== without(next, fields) ||
    next.pageOpens !== (prior.pageOpens ?? 0) + 1 ||
    !next.lastPageOpenedAt ||
    Date.parse(next.lastPageOpenedAt) <
      Date.parse(prior.lastPageOpenedAt ?? prior.startedAt)
  )
    throw new Error('RUN_WRITE_ONCE');
  if (next.pageDays) {
    if (prior.pageZone && prior.pageZone !== next.pageZone)
      throw new Error('RUN_WRITE_ONCE');
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: next.pageZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(next.lastPageOpenedAt));
    const expected = {
      ...prior.pageDays,
      [day]: (prior.pageDays?.[day] ?? 0) + 1,
    };
    if (
      JSON.stringify(Object.entries(expected).sort()) !==
      JSON.stringify(Object.entries(next.pageDays).sort())
    )
      throw new Error('RUN_WRITE_ONCE');
  } else if (prior.pageDays) throw new Error('RUN_WRITE_ONCE');
}

/** Read-only graph check used by restore. No platform capability lives in core. */
export function validateBrowserJournal(
  runs: readonly BrowserRun[],
  attempts: readonly BrowserAttempt[],
  itemIds: ReadonlySet<string>,
  originalIds: ReadonlySet<string> = new Set(),
  items: ReadonlyMap<string, Item> = new Map(),
): void {
  const knownRuns = new Map<string, BrowserRun>();
  for (const input of runs) {
    const run = BrowserRunSchema.parse(input);
    if (
      run.canaryAcceptedAt !== undefined &&
      run.canaryAcceptedAt !== null &&
      (!(
        ['fill', 'context'].includes(run.mode) ||
        (run.platform === 'instagram' && run.mode === 'delete')
      ) ||
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
    const item = value.itemId ? items.get(value.itemId) : undefined;
    if (
      !run ||
      ([
        'confirm-comment',
        'refresh-comment-likes',
        'refresh-comment-replies',
      ].includes(value.action)
        ? run.platform !== 'instagram' ||
          run.mode !== 'context' ||
          !value.itemId ||
          !itemIds.has(value.itemId) ||
          !item ||
          item.platform !== 'instagram' ||
          item.kind !== 'comment' ||
          item.account.key !== run.accountKey
        : value.action === 'read-post'
          ? value.itemId !== null ||
            !value.originalId ||
            !originalIds.has(value.originalId) ||
            run.mode !== 'fill' ||
            run.platform !== 'x'
          : run.platform === 'instagram'
            ? value.itemId === null ||
              !itemIds.has(value.itemId) ||
              !item ||
              item.platform !== 'instagram' ||
              item.kind !== 'comment' ||
              item.account.key !== run.accountKey ||
              Boolean(value.originalId) ||
              !['delete', 'verify'].includes(run.mode) ||
              (run.mode === 'delete'
                ? value.action !== 'delete-comment'
                : value.action !== 'verify')
            : value.itemId === null ||
              !itemIds.has(value.itemId) ||
              !value.itemId.startsWith('x:') ||
              Boolean(value.originalId) ||
              run.platform !== 'x' ||
              value.action === 'delete-comment' ||
              !['delete', 'verify'].includes(run.mode)) ||
      known.has(value.attemptId) ||
      value.seq <= seq
    )
      throw new Error('INVALID_BROWSER_JOURNAL');
    if (
      [
        'confirm-comment',
        'refresh-comment-likes',
        'refresh-comment-replies',
      ].includes(value.action) &&
      run &&
      (Date.parse(value.at) < Date.parse(run.startedAt) ||
        (run.endedAt !== null &&
          Date.parse(value.at) > Date.parse(run.endedAt)))
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
          ['refresh-comment-likes', 'refresh-comment-replies'].includes(
            value.action,
          )
            ? ['read', 'failed']
            : value.action === 'confirm-comment'
              ? [
                  'confirmed',
                  'unconfirmed',
                  'not-listed',
                  'unavailable',
                  'failed',
                ]
              : value.action === 'read-post'
                ? ['read', 'not-found', 'tombstone', 'unavailable', 'failed']
                : ['deleted', 'failed', 'ambiguous', 'not-deleted']
        ).includes(value.state)
      )
        throw new Error('INVALID_BROWSER_JOURNAL');
      settled.add(prior.attemptId);
    } else if (
      ([
        'read-post',
        'confirm-comment',
        'refresh-comment-likes',
        'refresh-comment-replies',
      ].includes(value.action) &&
        value.state !== 'sending') ||
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
  for (const attempt of attempts) {
    const run = knownRuns.get(attempt.runId);
    if (
      [
        'confirm-comment',
        'refresh-comment-likes',
        'refresh-comment-replies',
      ].includes(attempt.action) &&
      attempt.state === 'sending' &&
      run?.endedAt &&
      !settled.has(attempt.attemptId)
    )
      throw new Error('INVALID_BROWSER_JOURNAL');
  }
  for (const run of runs)
    if (
      run.platform === 'instagram' &&
      run.mode === 'delete' &&
      run.canaryAcceptedAt
    ) {
      const own = attempts.filter((a) => a.runId === run.runId),
        sends = own.filter((a) => a.state === 'sending'),
        deleted = own.filter((a) => a.state === 'deleted');
      if (
        sends.length !== 1 ||
        deleted.length !== 1 ||
        deleted[0]!.settles !== sends[0]!.attemptId ||
        deleted[0]!.action !== 'delete-comment' ||
        deleted[0]!.receipt?.status !== 200 ||
        own.some((a) => ['failed', 'ambiguous'].includes(a.state))
      )
        throw new Error('INVALID_BROWSER_JOURNAL');
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
    if (['browser-x', 'browser-instagram'].includes(event.source.via)) {
      const attempt = byId.get(event.action.id);
      if (
        !attempt ||
        (event.source.via === 'browser-instagram'
          ? !event.itemId.startsWith('instagram:') ||
            !['delete-comment', 'verify'].includes(attempt.action)
          : !event.itemId.startsWith('x:') ||
            attempt.action === 'delete-comment') ||
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

export function validateInstagramDeletionEvidence(
  attempts: readonly BrowserAttempt[],
  contexts: readonly InstagramContext[],
): void {
  const byItem = new Map(contexts.map((c) => [c.itemId, c]));
  for (const attempt of attempts)
    if (attempt.action === 'delete-comment') {
      const context = attempt.itemId ? byItem.get(attempt.itemId) : undefined;
      if (
        context?.confirmedBy !== 'post' ||
        context.ownerCheck !== 'matched-export' ||
        !context.comment.id ||
        !context.comment.createdAt
      )
        throw new Error('INVALID_INSTAGRAM_DELETION');
      if (
        attempt.state === 'deleted' &&
        (!attempt.settles ||
          attempt.receipt?.method !== 'POST' ||
          attempt.receipt.status !== 200 ||
          attempt.receipt.shape?.join(',') !== 'status' ||
          !new RegExp(
            `^(?:/api/v1)?/web/comments/\\d{1,40}/delete/${context.comment.id}/$`,
          ).test(attempt.receipt.path))
      )
        throw new Error('INVALID_INSTAGRAM_DELETION');
    }
}
