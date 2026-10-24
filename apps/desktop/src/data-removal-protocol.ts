import { z } from 'zod';

export const DATA_REMOVAL_REQUEST_EVENT = 'socialprune:data-removal-request';
export const DATA_REMOVAL_REPLY_EVENT = 'socialprune:data-removal-reply';
export const DATA_REMOVAL_CHANNEL = 'socialprune:data-removal';
export const DataRemovalRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('preview'), id: z.uuid() }),
  z.strictObject({
    type: z.literal('confirm'),
    id: z.uuid(),
    token: z.uuid(),
    signedOut: z.literal(true),
    phrase: z.enum(['REMOVE', 'ENTFERNEN']),
    locale: z.enum(['en', 'de']),
  }),
]);
const row = z.strictObject({
  name: z.string().min(1).max(1024),
  bytes: z.number().int().nonnegative(),
  disposition: z.enum(['remove', 'retain']),
  reason: z.enum([
    'managed',
    'backup',
    'unknown',
    'link',
    'changed',
    'locked',
    'io',
  ]),
});
export const DataRemovalReplySchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('preview'),
    id: z.uuid(),
    token: z.uuid(),
    root: z.string().max(4096),
    expiresAt: z.string(),
    rows: z.array(row).max(10000),
    groups: z
      .array(
        z.strictObject({
          kind: z.enum([
            'workspace',
            'profile-x',
            'profile-instagram',
            'logs',
            'settings',
          ]),
          bytes: z.number().int().nonnegative(),
        }),
      )
      .length(5),
  }),
  z.strictObject({
    type: z.literal('result'),
    id: z.uuid(),
    removed: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    retained: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('failed'),
    id: z.uuid(),
    code: z.enum(['busy', 'invalid', 'stale', 'root', 'io']),
  }),
]);
export type DataRemovalRequest = z.infer<typeof DataRemovalRequestSchema>;
export type DataRemovalReply = z.infer<typeof DataRemovalReplySchema>;
export type DataRemovalRow = z.infer<typeof row>;
