import { z } from 'zod';
import { UtcTimestampSchema } from './v1.ts';
import type { Item } from './index.ts';
import type { BrowserAttempt, BrowserRun } from './browser.ts';

export const InstagramItemIdSchema = z
  .string()
  .regex(/^instagram:[^\s:]+$/)
  .max(512);
export const InstagramPostCodeSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/);
export const InstagramContextSchema = z
  .strictObject({
    itemId: InstagramItemIdSchema,
    accountKey: z
      .string()
      .regex(/^instagram:[^\s:]+$/)
      .max(512),
    post: z.strictObject({
      kind: z.enum(['p', 'reel']),
      code: InstagramPostCodeSchema,
      owner: z
        .string()
        .min(1)
        .max(512)
        .regex(/^[^@\s/]+$/),
      ownerCount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      createdAt: UtcTimestampSchema.nullable(),
      caption: z.string().max(10_000).nullable(),
      captionComplete: z.boolean(),
    }),
    comment: z.strictObject({
      id: z.string().regex(/^[0-9]{1,40}$/),
      createdAt: UtcTimestampSchema,
      expandClicks: z.number().int().min(0).max(10),
    }),
    image: z.strictObject({
      file: z.enum(['image.jpg', 'image.png', 'image.webp']).nullable(),
      host: z
        .string()
        .max(253)
        .regex(/^[A-Za-z0-9.-]+$/)
        .nullable(),
      status: z.enum(['stored', 'not-captured', 'not-image', 'too-large']),
    }),
    screenshot: z.strictObject({
      file: z.literal('shot.jpg').nullable(),
      bytes: z.number().int().min(1).max(400_000).nullable(),
      status: z.enum(['stored', 'too-large', 'failed']),
    }),
    confirmedAt: UtcTimestampSchema,
    runId: z.string().min(1).max(512),
    attemptId: z.string().min(1).max(512),
  })
  .superRefine((value, ctx) => {
    if (
      (value.image.status === 'stored') !== (value.image.file !== null) ||
      (value.screenshot.status === 'stored') !==
        (value.screenshot.file !== null) ||
      (value.screenshot.status === 'stored') !==
        (value.screenshot.bytes !== null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Stored files must match their status.',
      });
  });
export type InstagramContext = z.infer<typeof InstagramContextSchema>;

export function validateInstagramContextItem(
  record: InstagramContext,
  item: Item | undefined,
): void {
  const owner = (value: string) => value.replace(/^@/, '').toLowerCase();
  if (
    !item ||
    item.id !== record.itemId ||
    item.platform !== 'instagram' ||
    item.kind !== 'comment' ||
    item.account.key !== record.accountKey ||
    !item.text.normalize('NFC').trim() ||
    !item.reference.ownerHandle ||
    !owner(item.reference.ownerHandle) ||
    owner(item.reference.ownerHandle) !== owner(record.post.owner) ||
    Math.abs(
      Date.parse(item.createdAt) - Date.parse(record.comment.createdAt),
    ) > 60_000
  )
    throw new Error('INVALID_INSTAGRAM_CONTEXT');
}

/** Shared by both backup readers; attemptId always identifies the sending record. */
export function validateInstagramContexts(
  records: readonly InstagramContext[],
  items: ReadonlyMap<string, Item>,
  runs: readonly BrowserRun[],
  attempts: readonly BrowserAttempt[],
): void {
  const itemIds = new Set<string>(),
    commentIds = new Set<string>(),
    confirmed = new Set<string>();
  const byRun = new Map(runs.map((run) => [run.runId, run]));
  const byAttempt = new Map(
    attempts.map((attempt) => [attempt.attemptId, attempt]),
  );
  for (const input of records) {
    const record = InstagramContextSchema.parse(input);
    validateInstagramContextItem(record, items.get(record.itemId));
    const run = byRun.get(record.runId),
      send = byAttempt.get(record.attemptId);
    const settlements = attempts.filter(
      (attempt) => attempt.settles === record.attemptId,
    );
    if (
      itemIds.has(record.itemId) ||
      commentIds.has(record.comment.id) ||
      run?.platform !== 'instagram' ||
      run.mode !== 'context' ||
      run.accountKey !== record.accountKey ||
      send?.action !== 'confirm-comment' ||
      send.state !== 'sending' ||
      send.runId !== record.runId ||
      send.itemId !== record.itemId ||
      settlements.length !== 1 ||
      settlements[0]!.state !== 'confirmed' ||
      settlements[0]!.runId !== record.runId ||
      settlements[0]!.itemId !== record.itemId ||
      settlements[0]!.action !== 'confirm-comment' ||
      settlements[0]!.at !== record.confirmedAt
    )
      throw new Error('INVALID_INSTAGRAM_CONTEXT');
    itemIds.add(record.itemId);
    commentIds.add(record.comment.id);
    confirmed.add(settlements[0]!.attemptId);
  }
  for (const attempt of attempts)
    if (attempt.state === 'confirmed' && !confirmed.has(attempt.attemptId))
      throw new Error('INVALID_INSTAGRAM_CONTEXT');
}
