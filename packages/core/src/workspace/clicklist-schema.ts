import { z } from 'zod';
import {
  ItemKindSchema,
  OutcomeValueSchema,
  UtcTimestampSchema,
} from '../model/index.ts';

const id = z.string().min(1);
const count = z.number().int().nonnegative();
export const ClickListEntrySchema = z.strictObject({
  itemId: id,
  platform: id,
  kind: ItemKindSchema,
  createdAt: UtcTimestampSchema,
  outcome: OutcomeValueSchema,
  action: z.enum(['delete', 'undo-repost', 'delete-comment']),
  url: z.string().nullable(),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  text: z.string().nullable(),
  ownerHandle: z.string().nullable(),
  via: z.enum(['web-review', 'local-review']),
});
export type ClickListEntry = z.infer<typeof ClickListEntrySchema>;
export const ClickListSchema = z.strictObject({
  accountKey: id,
  timeZone: id,
  timeZoneSource: z.enum(['flag', 'workspace', 'system']),
  entries: z.array(ClickListEntrySchema),
});
export type ClickList = z.infer<typeof ClickListSchema>;
export const ClickListCountsSchema = z.strictObject({
  deletedByYou: count,
  skipped: count,
  left: count,
});
export const ClickListSummarySchema = z.strictObject({
  listId: id,
  accountKey: id,
  timeZone: id,
  timeZoneSource: z.enum(['flag', 'workspace', 'system']),
  revision: count,
  total: count,
  counts: ClickListCountsSchema,
});
export type ClickListSummary = z.infer<typeof ClickListSummarySchema>;
export const ClickListWindowSchema = ClickListSummarySchema.extend({
  offset: count,
  entries: z.array(ClickListEntrySchema).max(200),
});
export type ClickListWindow = z.infer<typeof ClickListWindowSchema>;
export const ClickListFormatSchema = z.enum(['csv', 'json']);
export type ClickListFormat = z.infer<typeof ClickListFormatSchema>;
