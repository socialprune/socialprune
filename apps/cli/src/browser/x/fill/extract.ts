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
import { failureToken } from './report.ts';
import { displayTextFromAnswer, displayLinksFromAnswer } from './compare.ts';
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
/** Only this known wrapper may omit its inner Tweet's type name. */
function tweetResult(input: unknown): Record<string, unknown> {
  let value = object(input);
  if (value.__typename === 'TweetWithVisibilityResults') {
    value = object(value.tweet);
    if (
      !Object.hasOwn(value, '__typename') &&
      OriginalIdSchema.safeParse(value.rest_id).success &&
      value.legacy !== undefined &&
      value.legacy === object(value.legacy)
    )
      return { ...value, __typename: 'Tweet' };
  }
  return value;
}
function post(
  input: unknown,
  id: string,
  gated: Map<string, number>,
): SignedInPost {
  const wrapper = object(input);
  const visibility = object(wrapper.mediaVisibilityResults);
  const mediaGated =
    wrapper.__typename === 'TweetWithVisibilityResults' &&
    visibility.blurred_image_interstitial !== undefined &&
    visibility.blurred_image_interstitial !== null;
  const value = tweetResult(input);
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
  if (mediaGated) gated.set(id, media.length);
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
      ((value.note_tweet === undefined ||
        object(value.note_tweet).is_expandable === false) &&
        legacy.truncated !== true)
        ? 'full'
        : 'truncated',
    media: mediaFromAnswer(record, 'signed-in').map((entry) =>
      mediaGated ? { ...entry, status: 'not-stored', url: null } : entry,
    ),
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
    // No gated photo, video variant or poster URL survives for later downloads.
    signedInRecord: SignedInRecordSchema.parse(
      mediaGated ? { ...record, mediaDetails: [] } : record,
    ),
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
      displayText: string;
      displayLinks: string[];
      gated: { id: string; mediaItems: number }[];
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
    const timeline: { id: string; result: unknown; module: boolean }[] = [];
    const add = (id: string, input: unknown, module = false) => {
      if (timeline.some((value) => value.id === id))
        throw new Error('duplicate-entry');
      const value = tweetResult(input);
      if (
        !['Tweet', 'TweetTombstone', 'TweetUnavailable'].includes(
          String(value.__typename),
        )
      )
        throw new Error('result-type');
      timeline.push({ id, result: input, module });
    };
    for (const input of entries) {
      const entry = object(input),
        content = object(entry.content);
      if (
        content.cursorType !== undefined ||
        content.entryType === 'TimelineTimelineCursor'
      )
        continue;
      if (Array.isArray(content.items)) {
        for (const item of content.items) {
          const itemContent = object(object(object(item).item).itemContent);
          if (
            itemContent.cursorType !== undefined ||
            itemContent.__typename === 'TimelineTimelineCursor' ||
            itemContent.itemType === 'TimelineTimelineCursor'
          )
            continue;
          const result = object(itemContent.tweet_results).result;
          const tweet = tweetResult(result);
          if (
            !['Tweet', 'TweetTombstone', 'TweetUnavailable'].includes(
              String(tweet.__typename),
            )
          )
            throw new Error('module-result-type');
          const entryId = string(object(item).entryId),
            id =
              string(tweet.rest_id) ??
              (entryId && /^tweet-\d{1,40}$/.test(entryId)
                ? entryId.slice(6)
                : null);
          if (!id) continue; // Known incomplete module: retain the focal post and a partial chain.
          if (!OriginalIdSchema.safeParse(id).success)
            throw new Error('module-rest_id');
          add(id, result, true);
        }
        continue;
      }
      if (
        typeof entry.entryId !== 'string' ||
        !/^tweet-\d{1,40}$/.test(entry.entryId)
      )
        throw new Error('entry-id');
      add(
        entry.entryId.slice(6),
        object(object(content.itemContent).tweet_results).result,
      );
    }
    const focal = timeline.findIndex((value) => value.id === focalId);
    if (focal < 0) return { kind: 'no-entry' };
    const value = object(timeline[focal]?.result);
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
    const unwrapped = tweetResult(value);
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
    const gated = new Map<string, number>();
    const current = post(value, focalId, gated),
      above: SignedInPost[] = [];
    const preceding = timeline.slice(0, focal),
      map = new Map(preceding.map((value) => [value.id, value]));
    let parent = current.parentId;
    const chain = new Set([focalId]);
    while (parent && above.length < 20) {
      if (chain.has(parent)) throw new Error('parent-cycle');
      chain.add(parent);
      const value = map.get(parent);
      if (!value) break;
      const raw = tweetResult(value.result);
      if (
        value.module &&
        (raw.__typename !== 'Tweet' ||
          Object.keys(object(object(raw.core).user_results)).length === 0)
      )
        break;
      const read = post(value.result, value.id, gated);
      above.unshift(read);
      parent = read.parentId;
    }
    // Old generated examples omitted parent IDs. They no longer imply a chain.
    const quoted: SignedInPost[] = [];
    for (const input of [
      value,
      ...above.map(
        (value) => timeline.find((entry) => entry.id === value.id)?.result,
      ),
    ]) {
      const entry = tweetResult(input);
      const quote = object(entry.quoted_status_result).result;
      if (quote === undefined) continue;
      const value = tweetResult(quote);
      if (
        !['Tweet', 'TweetTombstone', 'TweetUnavailable'].includes(
          String(value.__typename),
        )
      )
        throw new Error('result-type');
      if (value.__typename !== 'Tweet') continue;
      if (value.rest_id !== undefined)
        quoted.push(post(quote, string(value.rest_id) ?? '', gated));
    }
    return {
      kind: 'read',
      displayText: displayTextFromAnswer(value),
      displayLinks: displayLinksFromAnswer(value),
      post: current,
      above,
      quoted,
      chainAbove: parent ? 'partial' : 'complete',
      gated: [...gated].map(([id, mediaItems]) => ({ id, mediaItems })),
    };
  } catch (error) {
    return {
      kind: 'shape-changed',
      path: failureToken(
        error instanceof z.ZodError
          ? error
          : error instanceof Error
            ? error.message
            : error,
      ),
    };
  }
}
