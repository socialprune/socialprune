import { expect, test } from 'vitest';
import {
  classifyTweet,
  decodeEntities,
  matchingNotes,
  notePrefix,
  parseIsoDate,
  parseTweetDate,
  tweetItem,
} from './tweet.ts';
import type { Note } from './tweet.ts';
import { assignedObject } from './archive.ts';

test.each([
  ['Wed Oct 10 20:19:24 +0000 2018', '2018-10-10T20:19:24.000Z'],
  ['2013-01-15 10:00:00 +0000', '2013-01-15T10:00:00.000Z'],
  ['Wed Oct 10 20:19:24 +0230 2018', '2018-10-10T17:49:24.000Z'],
  ['2013-01-15 00:10:00 +0100', '2013-01-14T23:10:00.000Z'],
  ['Thu Feb 29 10:00:00 +0000 2024', '2024-02-29T10:00:00.000Z'],
])('date %s', (raw, expected) => {
  expect(parseTweetDate(raw)).toBe(expected);
});
test.each([
  [{ extended_entities: { media: [{}, {}] }, entities: { media: [{}] } }, 2],
  [{ entities: { media: [{}] } }, 1],
  [{ extended_entities: { media: [] }, entities: { media: [{}] } }, 0],
  [{ entities: { media: [] } }, 0],
  [{ extended_entities: { media: 'not-an-array' } }, null],
  [{}, null],
])(
  'mediaCount comes only from declared attachment arrays: %j',
  (raw, expected) => {
    const item = tweetItem(
      {
        tweet: {
          id_str: '123',
          text: 'Generated media post.',
          created_at: 'Wed Oct 10 20:19:24 +0000 2018',
          ...raw,
        },
      },
      { key: 'x:test', handle: null },
      { archive: 'synthetic', path: 'posts.js', size: 0 },
      0,
    );
    expect(item?.mediaCount).toBe(expected);
  },
);
test.each([
  'bad',
  'Fri Feb 30 10:00:00 +0000 2024',
  'Thu Feb 29 10:00:00 +0000 2023',
  'Wed Oct 10 24:00:00 +0000 2018',
  'Wed Oct 10 20:19:60 +0000 2018',
  'Wed Foo 10 20:19:24 +0000 2018',
  '2013-00-15 10:00:00 +0000',
  '2013-01-15 10:00:00 +2460',
])('invalid date %s', (raw) => {
  expect(parseTweetDate(raw)).toBeNull();
});
test('ISO metadata timestamps normalize to UTC and reject impossible dates', () => {
  expect(parseIsoDate('2026-10-01T14:00:00+02:00')).toBe(
    '2026-10-01T12:00:00.000Z',
  );
  expect(parseIsoDate('2026-10-01T12:00:00.123456Z')).toBe(
    '2026-10-01T12:00:00.123Z',
  );
  for (const invalid of [
    '2026-02-30T10:00:00Z',
    '2026-10-01T24:00:00Z',
    '2026-10-01',
    '0000-01-01T10:00:00Z',
  ])
    expect(parseIsoDate(invalid)).toBeNull();
});
test('HTML entity decoding is one pass and makes no other text changes', () => {
  expect(
    decodeEntities(
      '  &amp; &lt; &gt; &quot; &#39; &apos; &#x661f; &#128512;\n',
    ),
  ).toBe("  & < > \" ' ' 星 😀\n");
  expect(
    decodeEntities('&amp;lt; &nbsp; &unknown; &#0; &#xD800; &#1114112;'),
  ).toBe('&lt; &nbsp; &unknown; &#0; &#xD800; &#1114112;');
});
test('kind precedence keeps reference IDs and does not confuse hosts or self links', () => {
  expect(
    classifyTweet(
      { in_reply_to_status_id_str: '1', quoted_status_id_str: '2' },
      'RT @moss_badger: text',
    ),
  ).toMatchObject({
    kind: 'repost',
    reference: { replyToId: '1', quotedId: '2', repostOfHandle: 'moss_badger' },
  });
  expect(
    classifyTweet(
      { in_reply_to_status_id_str: '1', quoted_status_id_str: '2' },
      'reply',
    ),
  ).toMatchObject({ kind: 'reply' });
  expect(classifyTweet({ quoted_status_id_str: '2' }, 'quote')).toMatchObject({
    kind: 'quote',
    reference: { quotedId: '2' },
  });
  for (const url of [
    'https://x.com/moss_badger/status/9',
    'https://twitter.com/i/web/status/9',
    'https://mobile.twitter.com/violet_otter/statuses/9',
  ])
    expect(
      classifyTweet({ entities: { urls: [{ expanded_url: url }] } }, 'quoted'),
    ).toMatchObject({ kind: 'quote', reference: { quotedId: '9' } });
  for (const url of [
    'https://x.com.evil.example.org/moss_badger/status/9',
    'https://example.org/status/9',
    'ftp://x.com/moss_badger/status/9',
    'https://x.com/moss_badger/status/8',
  ])
    expect(
      classifyTweet(
        { id_str: '8', entities: { urls: [{ expanded_url: url }] } },
        'linked',
      ),
    ).toMatchObject({ kind: 'post' });
  expect(classifyTweet({}, 'not RT @moss_badger')).toMatchObject({
    kind: 'post',
  });
});
test('note prefix matches same UTC second only and exposes ambiguity instead of choosing first', () => {
  const notes: Note[] = [
    'Moss first continuation.',
    'Moss second continuation.',
  ].map((text) => ({
    text,
    createdAt: '2024-01-01T00:00:00.345Z',
    hits: 0,
    used: false,
    ambiguous: false,
  }));
  const index = new Map([['2024-01-01T00:00:00', notes]]);
  expect(notePrefix('Moss\u2026 https://t.co/abc')).toBe('Moss');
  expect(notePrefix('Moss...')).toBe('Moss');
  expect(
    matchingNotes('Moss\u2026', '2024-01-01T00:00:00.000Z', index),
  ).toEqual(notes);
  expect(
    matchingNotes('Moss\u2026', '2024-01-01T00:00:01.000Z', index),
  ).toEqual([]);
  expect(
    matchingNotes('Other text\u2026', '2024-01-01T00:00:00.000Z', index),
  ).toEqual([]);
  expect(matchingNotes('\u2026', '2024-01-01T00:00:00.000Z', index)).toEqual(
    [],
  );
});
test('metadata object parser accepts one strict assignment and no executable tail', () => {
  expect(
    assignedObject('\uFEFF window.__THAR_CONFIG = {"archiveInfo":{}};\n'),
  ).toEqual({ archiveInfo: {} });
  expect(assignedObject('var user_details = {"id":"700001"};', true)).toEqual({
    id: '700001',
  });
  for (const input of [
    'window.__THAR_CONFIG = []',
    'window.__THAR_CONFIG = (function(){return {}})()',
    'window.__THAR_CONFIG = {}; globalThis.__pwned = 1',
    'other = {}',
    'window.__THAR_CONFIG = {};;',
  ])
    expect(() => assignedObject(input)).toThrow();
});
