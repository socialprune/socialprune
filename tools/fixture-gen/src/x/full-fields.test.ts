import type { Item } from '@socialprune/core';
import { expect, test } from 'vitest';
import { variants } from './variants.ts';

const fixture = variants.find(({ id }) => id === 'current-full-fields')!;
function entityText(value: string, indices: string[]): string {
  return value.slice(Number(indices[0]), Number(indices[1]));
}
function payload(path: string): unknown {
  const content = fixture.archives[0]!.files[path];
  if (typeof content !== 'string') throw new Error('Missing authored data.');
  return JSON.parse(
    content
      .slice(content.indexOf('=') + 1)
      .trim()
      .replace(/;$/, ''),
  ) as unknown;
}
const stringValue: unknown = expect.any(String);
const booleanValue: unknown = expect.any(Boolean);
const mediaShape = {
  id: stringValue,
  id_str: stringValue,
  display_url: stringValue,
  expanded_url: stringValue,
  media_url: stringValue,
  media_url_https: stringValue,
  url: stringValue,
  indices: [stringValue, stringValue],
  type: stringValue,
  sizes: Object.fromEntries(
    ['large', 'medium', 'small', 'thumb'].map((size) => [
      size,
      { w: stringValue, h: stringValue, resize: stringValue },
    ]),
  ),
};
interface Tweet {
  id: string;
  id_str: string;
  full_text: string;
  entities: {
    hashtags: Array<{ text: string; indices: string[] }>;
    urls: Array<{ url: string; indices: string[] }>;
    user_mentions: Array<{ screen_name: string; indices: string[] }>;
    media: unknown[];
  };
  extended_entities: { media: unknown[] };
  edit_info: { initial: { editTweetIds: string[] } };
}

test('full-field rows preserve string archive types and authored entity ranges', () => {
  const rows = [
    ...(payload('data/tweets.js') as Array<{ tweet: Tweet }>),
    ...(payload('data/deleted-tweets.js') as Array<{ tweet: Tweet }>),
  ];
  expect(rows).toHaveLength(9);
  for (const { tweet } of rows) {
    expect(tweet).toMatchObject({
      id: stringValue,
      id_str: tweet.id,
      display_text_range: ['0', String(tweet.full_text.length)],
      favorite_count: stringValue,
      retweet_count: stringValue,
      favorited: booleanValue,
      retweeted: booleanValue,
      lang: stringValue,
      source: stringValue,
      in_reply_to_user_id_str: stringValue,
      truncated: false,
      possibly_sensitive: booleanValue,
      entities: { symbols: [] },
      edit_info: {
        initial: {
          editTweetIds: expect.arrayContaining([tweet.id]) as unknown,
          editableUntil: stringValue,
          editsRemaining: stringValue,
          isEditEligible: booleanValue,
        },
      },
    });
    for (const hashtag of tweet.entities.hashtags) {
      expect(hashtag).toMatchObject({ text: stringValue });
      expect(hashtag.indices).toEqual([stringValue, stringValue]);
      expect(entityText(tweet.full_text, hashtag.indices)).toBe(
        `#${hashtag.text}`,
      );
    }
    for (const mention of tweet.entities.user_mentions) {
      expect(mention).toMatchObject({
        id: stringValue,
        id_str: stringValue,
        name: stringValue,
        screen_name: stringValue,
      });
      expect(mention.indices).toEqual([stringValue, stringValue]);
      expect(entityText(tweet.full_text, mention.indices)).toBe(
        `@${mention.screen_name}`,
      );
    }
    for (const url of tweet.entities.urls) {
      expect(url.indices).toEqual([stringValue, stringValue]);
      expect(entityText(tweet.full_text, url.indices)).toBe(url.url);
    }
    for (const media of [
      ...tweet.entities.media,
      ...tweet.extended_entities.media,
    ])
      expect(media).toMatchObject(mediaShape);
  }
  const tweets = rows.slice(0, 8).map(({ tweet }) => tweet);
  expect(tweets[0]!.entities.hashtags).toHaveLength(2);
  expect(tweets[0]!.entities.user_mentions).toHaveLength(1);
  expect(tweets[1]!.entities.media).toHaveLength(1);
  expect(tweets[1]!.extended_entities.media).toHaveLength(2);
  for (const video of [tweets[2]!, rows[8]!.tweet])
    expect(video.extended_entities.media).toMatchObject([
      {
        type: 'video',
        video_info: {
          aspect_ratio: ['16', '9'],
          duration_millis: '6400',
          variants: [
            { url: stringValue, content_type: 'video/mp4', bitrate: '832000' },
            { url: stringValue, content_type: 'video/mp4', bitrate: '2176000' },
          ],
        },
      },
    ]);
  expect(tweets[6]!.edit_info.initial.editTweetIds).toEqual([
    '9007199254742609',
    '9007199254742606',
  ]);
  expect(tweets[7]).toMatchObject({ possibly_sensitive: true });
});

test('full-field manifest counts and canonical expectations are authored without the adapter', () => {
  expect(payload('data/note-tweet.js')).toEqual([]);
  expect(payload('data/community-tweet.js')).toEqual([]);
  const manifest = payload('data/manifest.js') as {
    dataTypes: Record<string, { files: Array<{ count: string }> }>;
  };
  expect(manifest).toMatchObject({
    userInfo: {
      accountId: '710001',
      userName: 'example_quokka',
      displayName: 'Invented Orbit',
    },
    archiveInfo: {
      sizeBytes: stringValue,
      generationDate: stringValue,
      maxPartSizeBytes: stringValue,
      isArchivePartial: false,
    },
    dataTypes: { tweets: { mediaDirectory: 'data/tweets_media' } },
  });
  expect(
    Object.values(manifest.dataTypes).map(({ files }) => files[0]!.count),
  ).toEqual(['1', '8', '1', '0', '0']);
  for (const entry of Object.values(manifest.dataTypes))
    expect(entry.files).toMatchObject([
      { fileName: stringValue, globalName: stringValue, count: stringValue },
    ]);
  const expected = fixture.expected as { items: Item[] };
  expect(
    expected.items.map(({ id, kind, mediaCount }) => ({
      id,
      kind,
      mediaCount,
    })),
  ).toEqual([
    { id: 'x:9007199254742600', kind: 'post', mediaCount: 0 },
    { id: 'x:9007199254742601', kind: 'post', mediaCount: 2 },
    { id: 'x:9007199254742602', kind: 'post', mediaCount: 1 },
    { id: 'x:9007199254742603', kind: 'reply', mediaCount: 0 },
    { id: 'x:9007199254742604', kind: 'quote', mediaCount: 0 },
    { id: 'x:9007199254742605', kind: 'repost', mediaCount: 0 },
    { id: 'x:9007199254742606', kind: 'post', mediaCount: 0 },
    { id: 'x:9007199254742607', kind: 'post', mediaCount: 0 },
  ]);
  expect(expected.items.slice(3, 6).map(({ reference }) => reference)).toEqual([
    {
      replyToId: '9007199254742610',
      replyToHandle: 'example_moth',
      quotedId: null,
      repostOfHandle: null,
      ownerHandle: null,
    },
    {
      replyToId: null,
      replyToHandle: null,
      quotedId: '9007199254742600',
      repostOfHandle: null,
      ownerHandle: null,
    },
    {
      replyToId: null,
      replyToHandle: null,
      quotedId: null,
      repostOfHandle: 'example_badger',
      ownerHandle: null,
    },
  ]);
});
