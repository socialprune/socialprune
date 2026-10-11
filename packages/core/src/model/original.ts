import { z } from 'zod';
import { UtcTimestampSchema } from './v1.ts';

export const OriginalIdSchema = z.string().regex(/^[0-9]{1,40}$/);
export const OriginalPhotoSchema = z.strictObject({
  url: z.string().max(4096),
  file: z
    .string()
    .regex(/^[1-4]\.(?:jpg|png|gif|webp)$/)
    .nullable(),
  status: z.enum(['stored', 'failed']),
});
// Keep JSON validation at runtime without expanding recursive JSON types into
// every transport consumer (including Playwright's serializable arguments).
const RawOriginalSchema: z.ZodType<Record<string, unknown>> = z.record(
  z.string(),
  z.json(),
);
export const OriginalSchema = z.strictObject({
  id: OriginalIdSchema,
  status: z.enum(['fetched', 'not-found', 'tombstone', 'failed']),
  fetchedAt: UtcTimestampSchema,
  text: z.string().max(1_000_000).nullable(),
  authorName: z.string().max(4096).nullable(),
  authorHandle: z.string().max(512).nullable(),
  photos: z.array(OriginalPhotoSchema).max(4),
  quotedId: OriginalIdSchema.nullable(),
  parentId: OriginalIdSchema.nullable(),
  raw: RawOriginalSchema.nullable(),
  // Syndication does not establish that long-post text is complete.
  textCompleteness: z.enum(['unknown', 'truncated']),
  video: z.literal('not-stored').nullable(),
});
export type Original = z.infer<typeof OriginalSchema>;
