import {
  OriginalIdSchema,
  object,
  mediaFromAnswer,
  VariantSchema,
  SignedInRecordSchema,
} from '@socialprune/core';
import type { Original } from '@socialprune/core';
import { acceptShape } from './lock.ts';
import type { ShapeLock } from './lock.ts';
import { mediaURL } from '../../../originals/video.ts';
import { z } from 'zod';
const ProjectionSchema = z.strictObject({
  rest_id: OriginalIdSchema,
  text: z.string().max(1_000_000),
  author: z.strictObject({
    name: z.string().max(4096),
    screen_name: z.string().regex(/^[A-Za-z0-9_]{1,50}$/),
  }),
  created_at: z.string().nullable(),
  conversation_id_str: OriginalIdSchema.nullable(),
  in_reply_to_status_id_str: OriginalIdSchema.nullable(),
  quoted_status_id_str: OriginalIdSchema.nullable(),
  mediaDetails: z
    .array(
      z.strictObject({
        type: z.enum(['photo', 'video', 'animated_gif']),
        media_url_https: z.string(),
        ext_alt_text: z.string().nullable(),
        video_info: z.strictObject({
          duration_millis: z.number().nonnegative().nullable(),
          variants: z.array(VariantSchema),
        }),
      }),
    )
    .max(4),
});

export type SignedInPost = Omit<Original, 'anonymous' | 'signedIn'>;
const string = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;
function post(input: unknown, id: string): SignedInPost {
  let value = object(input);
  if (value.__typename === 'TweetWithVisibilityResults')
    value = object(value.tweet);
  if (
    value.__typename !== 'Tweet' ||
    value.rest_id !== id ||
    !OriginalIdSchema.safeParse(id).success
  )
    throw new Error('rest_id');
  const legacy = object(value.legacy),
    user = object(object(object(value.core).user_results).result),
    author = Object.keys(object(user.core)).length
      ? object(user.core)
      : object(user.legacy),
    note = object(object(object(value.note_tweet).note_tweet_results).result);
  const text = string(note.text) ?? string(legacy.full_text);
  if (
    text === null ||
    string(author.screen_name) === null ||
    string(author.name) === null
  )
    throw new Error('required-text-author');
  const entities = object(legacy.extended_entities);
  const media = Array.isArray(entities.media) ? entities.media : [];
  if (media.length > 4) throw new Error('media-count');
  for (const input of media) {
    const entry = object(input);
    if (!['photo', 'video', 'animated_gif'].includes(String(entry.type)))
      throw new Error('media-type');
    if (typeof entry.media_url_https !== 'string') throw new Error('media-url');
    mediaURL(entry.media_url_https, 'photo');
    const variants = object(entry.video_info).variants;
    if (variants !== undefined && !Array.isArray(variants))
      throw new Error('media-variants');
    for (const input of Array.isArray(variants) ? variants : []) {
      const variant = object(input);
      if (
        !['video/mp4', 'application/x-mpegURL'].includes(
          String(variant.content_type),
        ) ||
        typeof variant.url !== 'string'
      )
        throw new Error('media-variant');
      mediaURL(variant.url, 'video');
    }
  }
  const record = {
    rest_id: id,
    text,
    author: { name: author.name, screen_name: author.screen_name },
    created_at: string(legacy.created_at),
    conversation_id_str: string(legacy.conversation_id_str),
    in_reply_to_status_id_str: string(legacy.in_reply_to_status_id_str),
    quoted_status_id_str: string(legacy.quoted_status_id_str),
    mediaDetails: media.map((input) => {
      const entry = object(input),
        info = object(entry.video_info);
      return {
        type: entry.type,
        media_url_https: entry.media_url_https,
        ext_alt_text: string(entry.ext_alt_text),
        video_info: {
          duration_millis:
            typeof info.duration_millis === 'number'
              ? info.duration_millis
              : null,
          variants: Array.isArray(info.variants)
            ? info.variants.map((value) => {
                const entry = object(value);
                return {
                  content_type: entry.content_type,
                  url: entry.url,
                  ...(typeof entry.bitrate === 'number'
                    ? { bitrate: entry.bitrate }
                    : {}),
                };
              })
            : [],
        },
      };
    }),
  };
  const date = string(legacy.created_at);
  ProjectionSchema.parse(record);
  return {
    id,
    text,
    authorName: String(author.name),
    authorHandle: String(author.screen_name),
    createdAt:
      date && Number.isFinite(Date.parse(date))
        ? new Date(date).toISOString()
        : null,
    textSource: 'signed-in',
    textCompleteness:
      note.text !== undefined ||
      (value.note_tweet === undefined && legacy.truncated !== true)
        ? 'full'
        : 'truncated',
    media: mediaFromAnswer(record, 'signed-in'),
    quotedId: OriginalIdSchema.safeParse(legacy.quoted_status_id_str).success
      ? String(legacy.quoted_status_id_str)
      : null,
    parentId: OriginalIdSchema.safeParse(legacy.in_reply_to_status_id_str)
      .success
      ? String(legacy.in_reply_to_status_id_str)
      : null,
    conversationId: OriginalIdSchema.safeParse(legacy.conversation_id_str)
      .success
      ? String(legacy.conversation_id_str)
      : null,
    chainAbove: null,
    raw: null,
    signedInRecord: SignedInRecordSchema.parse(record),
  };
}
export function extract(
  body: unknown,
  focalId: string,
  lock: ShapeLock,
):
  | {
      kind: 'read';
      post: SignedInPost;
      above: SignedInPost[];
      quoted: SignedInPost[];
      chainAbove: 'complete' | 'partial';
    }
  | { kind: 'tombstone' | 'unavailable'; reason: string }
  | { kind: 'no-entry' }
  | { kind: 'shape-changed'; path: string } {
  try {
    const root = object(body),
      instructions = object(
        object(root.data).threaded_conversation_with_injections_v2,
      ).instructions;
    if (!Array.isArray(instructions)) throw new Error('instructions');
    const added = instructions.filter(
      (value) => object(value).type === 'TimelineAddEntries',
    );
    const replaced = instructions.filter(
      (value) => object(value).type === 'TimelineReplaceEntry',
    );
    const path =
      added.length === 1
        ? 'data.threaded_conversation_with_injections_v2.instructions.TimelineAddEntries.entries.tweet-*'
        : replaced.length === 1
          ? 'data.threaded_conversation_with_injections_v2.instructions.TimelineReplaceEntry.entry.tweet-*'
          : null;
    const ids = new Set<string>();
    for (const value of instructions)
      if (object(value).type === 'TimelineAddEntries') {
        const entries = object(value).entries;
        if (Array.isArray(entries))
          for (const input of entries) {
            const entry = object(input);
            if (
              typeof entry.entryId === 'string' &&
              entry.entryId.startsWith('tweet-')
            ) {
              if (ids.has(entry.entryId)) throw new Error('duplicate-entry');
              ids.add(entry.entryId);
            }
          }
      }
    if (
      path === null ||
      added.length > 1 ||
      replaced.length > 1 ||
      (added.length && replaced.length) ||
      !acceptShape(lock, path)
    )
      throw new Error('instruction-shape');
    const entries = added.length
      ? object(added[0]).entries
      : [object(replaced[0]).entry];
    if (!Array.isArray(entries)) throw new Error('entries');
    const focal = entries.findIndex(
      (value) => object(value).entryId === `tweet-${focalId}`,
    );
    if (focal < 0) return { kind: 'no-entry' };
    const result = (entry: unknown) =>
      object(object(object(object(entry).content).itemContent).tweet_results)
        .result;
    const value = object(result(entries[focal]));
    if (value.__typename === 'TweetTombstone')
      return {
        kind: 'tombstone',
        reason: (string(object(object(value.tombstone).text).text) ?? '').slice(
          0,
          500,
        ),
      };
    if (value.__typename === 'TweetUnavailable')
      return {
        kind: 'unavailable',
        reason: (string(value.reason) ?? '').slice(0, 64),
      };
    const unwrapped =
      value.__typename === 'TweetWithVisibilityResults'
        ? object(value.tweet)
        : value;
    if (unwrapped.__typename === 'TweetTombstone')
      return {
        kind: 'tombstone',
        reason: (
          string(object(object(unwrapped.tombstone).text).text) ?? ''
        ).slice(0, 500),
      };
    if (unwrapped.__typename === 'TweetUnavailable')
      return {
        kind: 'unavailable',
        reason: (string(unwrapped.reason) ?? '').slice(0, 64),
      };
    const current = post(value, focalId),
      above: SignedInPost[] = [];
    const candidates = entries.slice(0, focal).slice(-20);
    for (const input of candidates) {
      const entry = object(input);
      if (
        typeof entry.entryId !== 'string' ||
        !/^tweet-\d{1,40}$/.test(entry.entryId)
      )
        throw new Error('entry-id');
    }
    for (const input of candidates) {
      const entry = object(input);
      if (
        typeof entry.entryId !== 'string' ||
        !/^tweet-\d{1,40}$/.test(entry.entryId)
      )
        throw new Error('entry-id');
      above.push(post(result(input), entry.entryId.slice(6)));
    }
    const quoted: SignedInPost[] = [];
    for (const input of [value, ...entries.slice(0, focal).map(result)]) {
      let entry = object(input);
      if (entry.__typename === 'TweetWithVisibilityResults')
        entry = object(entry.tweet);
      let value = object(object(entry.quoted_status_result).result);
      if (value.__typename === 'TweetWithVisibilityResults')
        value = object(value.tweet);
      if (value.rest_id !== undefined)
        quoted.push(post(value, string(value.rest_id) ?? ''));
    }
    return {
      kind: 'read',
      post: current,
      above,
      quoted,
      chainAbove:
        focal > 20
          ? 'partial'
          : above.length
            ? above[0]!.parentId
              ? 'partial'
              : 'complete'
            : current.parentId
              ? 'partial'
              : 'complete',
    };
  } catch (error) {
    return {
      kind: 'shape-changed',
      path: error instanceof Error ? error.message : 'shape',
    };
  }
}
