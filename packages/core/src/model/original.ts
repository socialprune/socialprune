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
export const LegacyOriginalSchema = z.strictObject({
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
export const VariantSchema = z.strictObject({
  content_type: z.enum(['video/mp4', 'application/x-mpegURL']),
  url: z.string().max(4096),
  bitrate: z.number().nonnegative().optional(),
});
export type Variant = z.infer<typeof VariantSchema>;
export const OriginalMediaSchema = z.strictObject({
  n: z.number().int().min(1).max(4),
  kind: z.enum(['photo', 'video', 'gif']),
  source: z.enum(['anonymous', 'signed-in']),
  url: z.string().max(4096).nullable(),
  file: z
    .string()
    .regex(/^[1-4]\.(?:jpg|png|gif|webp|mp4)$/)
    .nullable(),
  poster: z
    .string()
    .regex(/^[1-4]-poster\.(?:jpg|png|webp)$/)
    .nullable(),
  status: z.enum([
    'stored',
    'failed',
    'refused',
    'too-large',
    'hls-only',
    'no-variant',
    'run-cap',
    'not-stored',
  ]),
  bytes: z.number().int().nonnegative().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  bitrateLabel: z.number().nonnegative().nullable(),
  altText: z.string().max(1000).nullable(),
});
export type OriginalMedia = z.infer<typeof OriginalMediaSchema>;
export const SignedInRecordSchema = z.strictObject({
  rest_id: OriginalIdSchema,
  text: z.string().max(1_000_000),
  author: z
    .strictObject({
      name: z.string().max(4096),
      screen_name: z.string().max(512),
    })
    .optional(),
  created_at: z.string().nullable().optional(),
  conversation_id_str: OriginalIdSchema.nullable().optional(),
  in_reply_to_status_id_str: OriginalIdSchema.nullable().optional(),
  quoted_status_id_str: OriginalIdSchema.nullable().optional(),
  mediaDetails: z
    .array(
      z.strictObject({
        type: z.enum(['photo', 'video', 'animated_gif']),
        media_url_https: z.string().max(4096),
        ext_alt_text: z.string().max(1000).nullable(),
        video_info: z.strictObject({
          duration_millis: z.number().nonnegative().nullable(),
          variants: z.array(VariantSchema),
        }),
      }),
    )
    .max(4)
    .optional(),
});
export const OriginalSchema = z.strictObject({
  id: OriginalIdSchema,
  anonymous: z
    .strictObject({
      status: LegacyOriginalSchema.shape.status,
      at: UtcTimestampSchema,
    })
    .nullable(),
  signedIn: z
    .strictObject({
      status: z.enum(['read', 'not-found', 'tombstone', 'unavailable']),
      at: UtcTimestampSchema,
      runId: z.string().min(1),
      attemptId: z.string().min(1),
      reason: z.string().max(500).nullable(),
    })
    .nullable(),
  text: z.string().max(1_000_000).nullable(),
  authorName: z.string().max(4096).nullable(),
  authorHandle: z.string().max(512).nullable(),
  createdAt: UtcTimestampSchema.nullable(),
  textSource: z.enum(['anonymous', 'signed-in']).nullable(),
  textCompleteness: z.enum(['unknown', 'truncated', 'full']),
  media: z.array(OriginalMediaSchema).max(4),
  quotedId: OriginalIdSchema.nullable(),
  parentId: OriginalIdSchema.nullable(),
  conversationId: OriginalIdSchema.nullable(),
  chainAbove: z.enum(['complete', 'partial']).nullable(),
  raw: RawOriginalSchema.nullable(),
  signedInRecord: SignedInRecordSchema.nullable(),
});
export type Original = z.infer<typeof OriginalSchema>;
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function mediaFromAnswer(
  raw: Record<string, unknown>,
  source: 'anonymous' | 'signed-in' = 'anonymous',
): OriginalMedia[] {
  const details = Array.isArray(raw.mediaDetails) ? raw.mediaDetails : [];
  return details.slice(0, 4).map((input, index) => {
    const value = object(input),
      info = object(value.video_info);
    const variants = Array.isArray(info.variants)
      ? info.variants.flatMap((value) => {
          const parsed = VariantSchema.safeParse(value);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    const mp4 = variants
      .filter((v) => v.content_type === 'video/mp4')
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
    const kind =
      value.type === 'photo'
        ? 'photo'
        : value.type === 'animated_gif'
          ? 'gif'
          : 'video';
    return {
      n: index + 1,
      kind,
      source,
      url:
        kind === 'photo'
          ? typeof value.media_url_https === 'string'
            ? value.media_url_https
            : null
          : (mp4?.url ?? null),
      file: null,
      poster: null,
      status:
        kind === 'photo'
          ? 'failed'
          : mp4
            ? 'not-stored'
            : variants.length
              ? 'hls-only'
              : 'no-variant',
      bytes: null,
      durationMs:
        typeof info.duration_millis === 'number' ? info.duration_millis : null,
      bitrateLabel: mp4?.bitrate ?? null,
      altText:
        typeof value.ext_alt_text === 'string'
          ? value.ext_alt_text.slice(0, 1000)
          : null,
    } satisfies OriginalMedia;
  });
}
export function migrateOriginal(input: unknown): Original {
  const current = OriginalSchema.safeParse(input);
  if (current.success) return current.data;
  const old = LegacyOriginalSchema.parse(input),
    raw = old.raw ?? {};
  const derived = mediaFromAnswer(raw);
  const photos = old.photos.map((photo, index) => ({
    n: index + 1,
    kind: 'photo' as const,
    source: 'anonymous' as const,
    url: photo.url,
    file: photo.file,
    poster: null,
    status: photo.status,
    bytes: null,
    durationMs: null,
    bitrateLabel: null,
    altText: null,
  }));
  const media = derived.length
    ? derived.map((entry) => {
        const photo = photos.find(
          (photo) => photo.n === entry.n && entry.kind === 'photo',
        );
        return photo
          ? { ...entry, file: photo.file, status: photo.status }
          : entry;
      })
    : photos;
  if (
    old.video &&
    !media.some((entry) => entry.kind !== 'photo') &&
    media.length < 4
  )
    media.push({
      n: media.length + 1,
      kind: 'video',
      source: 'anonymous',
      url: null,
      file: null,
      poster: null,
      status: 'not-stored',
      bytes: null,
      durationMs: null,
      bitrateLabel: null,
      altText: null,
    });
  const quoted = object(raw.quoted_tweet).id_str,
    parent = object(raw.parent).id_str;
  return OriginalSchema.parse({
    id: old.id,
    anonymous: { status: old.status, at: old.fetchedAt },
    signedIn: null,
    text: old.text,
    authorName: old.authorName,
    authorHandle: old.authorHandle,
    createdAt: null,
    textSource: old.status === 'fetched' ? 'anonymous' : null,
    textCompleteness:
      Object.hasOwn(raw, 'note_tweet') || raw.truncated === true
        ? 'truncated'
        : old.textCompleteness,
    media,
    quotedId: OriginalIdSchema.safeParse(quoted).success
      ? quoted
      : old.quotedId,
    parentId: OriginalIdSchema.safeParse(parent).success
      ? parent
      : old.parentId,
    conversationId: null,
    chainAbove: null,
    raw: old.raw,
    signedInRecord: null,
  });
}
export function validateOriginal(value: Original): void {
  const seen = new Set<number>();
  let n = 0;
  for (const media of value.media) {
    if (
      seen.has(media.n) ||
      media.n <= n ||
      Boolean(media.file) !== (media.status === 'stored') ||
      (media.file &&
        !new RegExp(
          `^${media.n}\\.${media.kind === 'photo' ? '(?:jpg|png|gif|webp)' : 'mp4'}$`,
        ).test(media.file)) ||
      (media.poster &&
        (media.kind === 'photo' ||
          !media.poster.startsWith(`${media.n}-poster.`)))
    )
      throw new Error('INVALID_ORIGINAL_MEDIA');
    n = media.n;
    seen.add(n);
  }
  if (
    (value.signedIn?.status === 'read' && !value.signedInRecord) ||
    (value.textSource === 'signed-in' && !value.signedInRecord)
  )
    throw new Error('INVALID_ORIGINAL_SOURCE');
  if (
    value.signedInRecord?.rest_id !== undefined &&
    value.signedInRecord.rest_id !== value.id
  )
    throw new Error('INVALID_ORIGINAL_SOURCE');
}
