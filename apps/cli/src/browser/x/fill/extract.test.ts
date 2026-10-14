import { test, expect } from 'vitest';
import { extract } from './extract.ts';
import { isPostAnswer, unexpectedAction } from './read.ts';
import { structureReport, failureToken } from './report.ts';
import { z } from 'zod';
import {
  DETAIL_FIXTURE,
  detailPost,
  detailAnswer,
} from '../../../originals/test/detail.ts';
test('response guard reads only the exact GET focal-id JSON answer and rejects planted adjacent bodies', () => {
  const url = `https://x.com/i/api/graphql/generated/TweetDetail?variables=${encodeURIComponent(JSON.stringify({ focalTweetId: DETAIL_FIXTURE.id }))}`,
    valid = {
      method: 'GET',
      url,
      status: 200,
      contentType: 'application/json; charset=utf-8',
    };
  expect(isPostAnswer(valid, DETAIL_FIXTURE.id)).toBe(true);
  for (const defect of [
    { ...valid, method: 'POST' },
    { ...valid, status: 429 },
    { ...valid, contentType: 'text/html' },
    { ...valid, url: url.replace('x.com', 'example.org') },
    { ...valid, url: url.replace('TweetDetail', 'OtherOperation') },
  ])
    expect(isPostAnswer(defect, DETAIL_FIXTURE.id)).toBe(false);
  expect(isPostAnswer(valid, '999')).toBe(false);
});
test('projector drops fixture viewer secrets and replies below while accepting core and legacy authors', () => {
  const lock = { instruction: null };
  const value = extract(detailAnswer(), DETAIL_FIXTURE.id, lock);
  expect(value.kind).toBe('read');
  for (const forbidden of DETAIL_FIXTURE.forbidden)
    expect(JSON.stringify(value)).not.toContain(forbidden);
  const post = detailPost();
  post.core.user_results.result = {
    legacy: post.core.user_results.result.core,
  } as unknown as typeof post.core.user_results.result;
  expect(extract(detailAnswer(post), DETAIL_FIXTURE.id, lock).kind).toBe(
    'read',
  );
});
test.each([
  'missing-id',
  'unknown-result',
  'foreign-media',
  'unknown-media',
  'instruction-path',
])('shape lock rejects planted %s defect', (defect) => {
  const post = detailPost(),
    body = detailAnswer(post) as Record<string, unknown>;
  if (defect === 'missing-id') delete (post as Partial<typeof post>).rest_id;
  if (defect === 'unknown-result') post.__typename = 'TweetPreviewDisplay';
  if (defect === 'foreign-media')
    post.legacy.extended_entities.media = [
      {
        ...DETAIL_FIXTURE.media[0],
        media_url_https: 'https://example.org/decoy.jpg',
      },
    ] as never[];
  if (defect === 'unknown-media')
    post.legacy.extended_entities.media = [
      { ...DETAIL_FIXTURE.media[0], type: 'generated-unknown' },
    ] as never[];
  if (defect === 'instruction-path')
    body.data = { different: { instructions: [] } };
  expect(extract(body, DETAIL_FIXTURE.id, { instruction: null }).kind).toBe(
    'shape-changed',
  );
});
test('long text, video/GIF variants, quotes, visibility wrappers and three parents keep only projected fields', () => {
  const post = detailPost();
  Object.assign(post, {
    note_tweet: {
      note_tweet_results: { result: { text: DETAIL_FIXTURE.longText } },
    },
    quoted_status_result: {
      result: {
        ...detailPost('909'),
        legacy: {
          ...post.legacy,
          extended_entities: { media: DETAIL_FIXTURE.media },
        },
      },
    },
  });
  post.legacy.extended_entities.media = DETAIL_FIXTURE.media as never[];
  Object.assign(post.legacy, { in_reply_to_status_id_str: '903' });
  const body = detailAnswer(post, [
    detailPost('901'),
    {
      ...detailPost('902'),
      legacy: { ...detailPost('902').legacy, in_reply_to_status_id_str: '901' },
    },
    {
      ...detailPost('903'),
      legacy: { ...detailPost('903').legacy, in_reply_to_status_id_str: '902' },
    },
  ]);
  const value = extract(body, DETAIL_FIXTURE.id, { instruction: null });
  expect(value).toMatchObject({
    kind: 'read',
    post: { text: DETAIL_FIXTURE.longText, textCompleteness: 'full' },
    chainAbove: 'complete',
  });
  if (value.kind !== 'read') throw new Error('not read');
  expect(value.above.map((post) => post.id)).toEqual(['901', '902', '903']);
  expect(value.quoted[0]?.media[0]).toMatchObject({
    kind: 'video',
    url: 'https://video.twimg.com/generated-high.mp4',
  });
  expect(
    extract(
      detailAnswer({
        __typename: 'TweetWithVisibilityResults',
        tweet: post,
        rest_id: post.rest_id,
      }),
      DETAIL_FIXTURE.id,
      { instruction: null },
    ).kind,
  ).toBe('read');
});
test('canary report contains no fixture IDs texts or handles and records structure only', () => {
  const report = JSON.stringify(structureReport(detailAnswer()));
  for (const value of [
    DETAIL_FIXTURE.id,
    DETAIL_FIXTURE.text,
    DETAIL_FIXTURE.handle,
    ...DETAIL_FIXTURE.forbidden,
  ])
    expect(report).not.toContain(value);
  expect(report).toContain('tweet-*');
});
test('exact unexpected-action identity stops account mutations but not background telemetry', () => {
  for (const name of [
    'FavoriteTweet',
    'DeleteTweet',
    'CreateTweet',
    'CreateBookmark',
  ])
    expect(
      unexpectedAction('POST', `https://x.com/i/api/graphql/generated/${name}`),
    ).toBe(true);
  expect(
    unexpectedAction(
      'POST',
      'https://x.com/i/api/graphql/generated/FavoriteTweetMetrics',
    ),
  ).toBe(false);
  expect(unexpectedAction('POST', 'https://x.com/i/api/telemetry')).toBe(false);
});
test('replace-entry parser is separate and cannot switch an accepted add-entry shape silently', () => {
  const normal = detailAnswer(),
    entry =
      normal.data.threaded_conversation_with_injections_v2.instructions[0]!
        .entries[0]!;
  const replacement = {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [{ type: 'TimelineReplaceEntry', entry }],
      },
    },
  };
  expect(
    extract(replacement, DETAIL_FIXTURE.id, { instruction: null }).kind,
  ).toBe('read');
  const lock = { instruction: null };
  expect(extract(normal, DETAIL_FIXTURE.id, lock).kind).toBe('read');
  expect(extract(replacement, DETAIL_FIXTURE.id, lock).kind).toBe(
    'shape-changed',
  );
});
test('only focal tombstone or unavailable results settle, a missing focal entry stays distinct', () => {
  for (const [type, kind] of [
    ['TweetTombstone', 'tombstone'],
    ['TweetUnavailable', 'unavailable'],
  ] as const) {
    const result = {
      __typename: type,
      rest_id: DETAIL_FIXTURE.id,
      tombstone: { text: { text: 'Generated withheld reason' } },
      reason: 'generated-hidden',
    };
    expect(
      extract(detailAnswer(result), DETAIL_FIXTURE.id, { instruction: null })
        .kind,
    ).toBe(kind);
    expect(
      extract(
        detailAnswer({
          __typename: 'TweetWithVisibilityResults',
          rest_id: DETAIL_FIXTURE.id,
          tweet: result,
        }),
        DETAIL_FIXTURE.id,
        { instruction: null },
      ).kind,
    ).toBe(kind);
  }
  const answer = detailAnswer();
  answer.data.threaded_conversation_with_injections_v2.instructions[0]!.entries.shift();
  expect(extract(answer, DETAIL_FIXTURE.id, { instruction: null }).kind).toBe(
    'no-entry',
  );
});
test('four photos and mixed GIF/HLS variants keep filenames metadata, while a fifth medium is a shape error', () => {
  const post = detailPost();
  const photos = Array.from({ length: 4 }, (_, i) => ({
    type: 'photo',
    media_url_https: `https://pbs.twimg.com/generated${i}.jpg`,
    ext_alt_text: `Generated alt${i}`,
  }));
  post.legacy.extended_entities.media = photos as never[];
  let value = extract(detailAnswer(post), DETAIL_FIXTURE.id, {
    instruction: null,
  });
  expect(value.kind).toBe('read');
  if (value.kind !== 'read') throw new Error('not read');
  expect(
    value.post.media.map((media) => ({
      n: media.n,
      kind: media.kind,
      altText: media.altText,
    })),
  ).toEqual(
    photos.map((_, i) => ({
      n: i + 1,
      kind: 'photo',
      altText: `Generated alt${i}`,
    })),
  );
  post.legacy.extended_entities.media = [
    ...photos,
    { ...photos[0] },
  ] as never[];
  expect(
    extract(detailAnswer(post), DETAIL_FIXTURE.id, { instruction: null }).kind,
  ).toBe('shape-changed');
  post.legacy.extended_entities.media = [
    photos[0],
    { ...DETAIL_FIXTURE.media[0], type: 'animated_gif' },
    {
      ...DETAIL_FIXTURE.media[0],
      video_info: {
        variants: [
          {
            content_type: 'application/x-mpegURL',
            url: 'https://video.twimg.com/generated.m3u8',
          },
        ],
      },
    },
  ] as never[];
  value = extract(detailAnswer(post), DETAIL_FIXTURE.id, { instruction: null });
  expect(value.kind).toBe('read');
  if (value.kind !== 'read') throw new Error('not read');
  expect(value.post.media.map((media) => media.kind)).toEqual([
    'photo',
    'gif',
    'video',
  ]);
  expect(value.post.media[2]?.status).toBe('hls-only');
});

test.each([
  {
    cursorType: 'ShowMore',
    value: 'generated-cursor-value',
    displayTreatment: { actionText: 'Generated show more' },
  },
  { __typename: 'TimelineTimelineCursor', value: 'generated-cursor-value' },
  { itemType: 'TimelineTimelineCursor', value: 'generated-cursor-value' },
])(
  'module cursor items are skipped between generated parents without changing focal projection: %j',
  (cursor) => {
    const root = detailPost('901');
    const parent = {
      ...detailPost('902'),
      legacy: { ...detailPost('902').legacy, in_reply_to_status_id_str: '901' },
    };
    const focal = {
      ...detailPost(),
      legacy: { ...detailPost().legacy, in_reply_to_status_id_str: '902' },
    };
    const body = detailAnswer(focal);
    const moduleEntry = {
      entryId: 'conversationthread-generated',
      content: {
        items: [
          {
            entryId: 'tweet-901',
            item: { itemContent: { tweet_results: { result: root } } },
          },
          {
            entryId: 'cursor-show-more-generated',
            item: { itemContent: cursor },
          },
          {
            entryId: 'tweet-902',
            item: { itemContent: { tweet_results: { result: parent } } },
          },
        ],
      },
    };
    const originalEntries =
      body.data.threaded_conversation_with_injections_v2.instructions[0]!
        .entries;
    const entries: unknown[] = [moduleEntry, ...originalEntries];
    const answer = {
      data: {
        threaded_conversation_with_injections_v2: {
          instructions: [{ type: 'TimelineAddEntries', entries }],
        },
      },
    };
    const result = extract(answer, DETAIL_FIXTURE.id, { instruction: null });
    expect(result.kind).toBe('read');
    if (result.kind !== 'read')
      throw new Error('Generated focal post was not read.');
    expect(result.post.text).toBe(DETAIL_FIXTURE.text);
    expect(result.above.map((post) => post.id)).toEqual(['901', '902']);
    expect(result.chainAbove).toBe('complete');
    expect(JSON.stringify(result)).not.toContain('generated-cursor-value');
    expect(JSON.stringify(result)).not.toContain('Generated show more');
  },
);

test('an unknown non-cursor module item still fails closed instead of being discarded', () => {
  const normal = detailAnswer();
  const entries: unknown[] = [
    {
      entryId: 'conversationthread-generated',
      content: {
        items: [
          {
            entryId: 'generated-unknown',
            item: {
              itemContent: {
                __typename: 'GeneratedUnknownModule',
                itemType: 'GeneratedUnknown',
                value: 'Generated private value',
              },
            },
          },
        ],
      },
    },
    ...normal.data.threaded_conversation_with_injections_v2.instructions[0]!
      .entries,
  ];
  expect(
    extract(
      {
        data: {
          threaded_conversation_with_injections_v2: {
            instructions: [{ type: 'TimelineAddEntries', entries }],
          },
        },
      },
      DETAIL_FIXTURE.id,
      { instruction: null },
    ),
  ).toMatchObject({ kind: 'shape-changed', path: 'module-result-type' });
});

test('shape-failure report tokens reject decoy values and map projection errors to a fixed token', () => {
  const decoy = 'Generated secret @private_decoy 12345678901234567890';
  expect(failureToken('module-result-type')).toBe('module-result-type');
  expect(failureToken('no-entry')).toBe('no-entry');
  for (const value of [
    decoy,
    new Error(decoy),
    'REST_ID',
    'rest_id',
    'x'.repeat(41),
    '',
    null,
    {},
    910,
  ])
    expect(failureToken(value)).toBe('other');
  const parsed = z
    .strictObject({ count: z.number() })
    .safeParse({ count: decoy });
  if (parsed.success)
    throw new Error('Generated projection decoy unexpectedly passed.');
  expect(failureToken(parsed.error)).toBe('projection');
  const report = structureReport(detailAnswer(), decoy);
  expect(report).toMatchObject({ failure: 'other' });
  expect(JSON.stringify(report)).not.toContain(decoy);
  for (const value of [
    DETAIL_FIXTURE.id,
    DETAIL_FIXTURE.text,
    DETAIL_FIXTURE.handle,
    ...DETAIL_FIXTURE.forbidden,
  ])
    expect(JSON.stringify(report)).not.toContain(value);
  expect(structureReport(detailAnswer(), 'no-entry')).toMatchObject({
    failure: 'no-entry',
  });
});

function visibilityPost(id = DETAIL_FIXTURE.id, gated = false) {
  const tweet = detailPost(id);
  delete (tweet as Partial<typeof tweet>).__typename;
  tweet.legacy.extended_entities.media = [
    ...DETAIL_FIXTURE.media,
    {
      type: 'photo',
      media_url_https: 'https://pbs.twimg.com/generated-gated-photo.jpg',
    },
    { ...DETAIL_FIXTURE.media[0], type: 'animated_gif' },
  ] as never[];
  return {
    __typename: 'TweetWithVisibilityResults',
    tweet,
    mediaVisibilityResults: gated
      ? {
          blurred_image_interstitial: {
            interstitial_action: 'AgeVerificationPrompt',
            opacity: 0.5,
            title: { text: 'Generated title', entities: [], rtl: false },
            text: { text: 'Generated overlay', entities: [], rtl: false },
          },
        }
      : {},
  };
}

test.each([
  'direct',
  'module',
  'parent',
  'module-parent',
  'quote',
  'parent-quote',
])(
  'visibility wrapper with an untyped inner Tweet extracts in %s and retains its media gate',
  (location) => {
    const focal = detailPost();
    const wrapped = visibilityPost(
      location === 'direct' || location === 'module'
        ? DETAIL_FIXTURE.id
        : '901',
      true,
    );
    const body = detailAnswer(location === 'direct' ? wrapped : focal);
    const entries =
      body.data.threaded_conversation_with_injections_v2.instructions[0]!
        .entries;
    if (location === 'module') {
      entries[0] = {
        entryId: 'conversationthread-generated',
        content: {
          items: [
            {
              entryId: 'tweet-910',
              item: { itemContent: { tweet_results: { result: wrapped } } },
            },
          ],
        },
      } as never;
    } else if (location === 'parent' || location === 'module-parent') {
      Object.assign(focal.legacy, { in_reply_to_status_id_str: '901' });
      entries.unshift(
        (location === 'parent'
          ? {
              entryId: 'tweet-901',
              content: { itemContent: { tweet_results: { result: wrapped } } },
            }
          : {
              entryId: 'conversationthread-generated',
              content: {
                items: [
                  {
                    entryId: 'tweet-901',
                    item: {
                      itemContent: { tweet_results: { result: wrapped } },
                    },
                  },
                ],
              },
            }) as never,
      );
    } else if (location === 'quote') {
      Object.assign(focal, { quoted_status_result: { result: wrapped } });
      Object.assign(focal.legacy, { quoted_status_id_str: '901' });
    } else if (location === 'parent-quote') {
      const parent = detailPost('902');
      Object.assign(parent, { quoted_status_result: { result: wrapped } });
      Object.assign(parent.legacy, { quoted_status_id_str: '901' });
      Object.assign(focal.legacy, { in_reply_to_status_id_str: '902' });
      entries.unshift({
        entryId: 'tweet-902',
        content: { itemContent: { tweet_results: { result: parent } } },
      });
    }
    const result = extract(body, DETAIL_FIXTURE.id, { instruction: null });
    expect(result.kind).toBe('read');
    if (result.kind !== 'read')
      throw new Error('Generated visibility post was not read.');
    const projected = [...result.above, ...result.quoted, result.post].find(
      (post) => post.id === wrapped.tweet.rest_id,
    )!;
    expect(projected.text).toBe(DETAIL_FIXTURE.text);
    expect(
      projected.media.map(({ kind, status, url, file, poster }) => ({
        kind,
        status,
        url,
        file,
        poster,
      })),
    ).toEqual(
      ['video', 'photo', 'gif'].map((kind) => ({
        kind,
        status: 'not-stored',
        url: null,
        file: null,
        poster: null,
      })),
    );
    expect(projected.signedInRecord?.mediaDetails).toEqual([]);
    expect(Reflect.get(result, 'gated')).toEqual([
      { id: wrapped.tweet.rest_id, mediaItems: 3 },
    ]);
    expect(JSON.stringify(projected)).not.toContain('AgeVerificationPrompt');
    expect(JSON.stringify(projected)).not.toContain('Generated overlay');
    expect(JSON.stringify(projected)).not.toContain('https://video.twimg.com/');
    expect(JSON.stringify(projected)).not.toContain('https://pbs.twimg.com/');
  },
);

test('an ungated visibility wrapper with an untyped inner Tweet retains downloadable media', () => {
  const result = extract(detailAnswer(visibilityPost()), DETAIL_FIXTURE.id, {
    instruction: null,
  });
  expect(result.kind).toBe('read');
  if (result.kind !== 'read')
    throw new Error('Generated visibility post was not read.');
  expect(result.post.media[0]?.url).toBe(
    DETAIL_FIXTURE.media[0]!.video_info.variants[1]!.url,
  );
  expect(result.post.signedInRecord?.mediaDetails).toHaveLength(3);
  expect(Reflect.get(result, 'gated')).toEqual([]);
});

test.each([
  'bare-untyped',
  'missing-rest-id',
  'missing-legacy',
  'unknown-inner',
  'unknown-wrapper',
])('untyped visibility admission still fails closed for %s', (defect) => {
  const wrapped = visibilityPost();
  if (defect === 'missing-rest-id')
    delete (wrapped.tweet as Partial<typeof wrapped.tweet>).rest_id;
  if (defect === 'missing-legacy')
    delete (wrapped.tweet as Partial<typeof wrapped.tweet>).legacy;
  if (defect === 'unknown-inner')
    Object.assign(wrapped.tweet, { __typename: 'GeneratedUnknownTweet' });
  if (defect === 'unknown-wrapper')
    wrapped.__typename = 'GeneratedUnknownWrapper';
  expect(
    extract(
      detailAnswer(defect === 'bare-untyped' ? wrapped.tweet : wrapped),
      DETAIL_FIXTURE.id,
      { instruction: null },
    ).kind,
  ).toBe('shape-changed');
});

test.each(['GeneratedDifferentAction', null, {}, false])(
  'every non-null interstitial gates media without matching an action or overlay label: %j',
  (interstitial) => {
    const wrapped = visibilityPost(DETAIL_FIXTURE.id, true);
    Object.assign(wrapped.mediaVisibilityResults, {
      blurred_image_interstitial: { interstitial_action: interstitial },
    });
    Object.assign(wrapped.tweet, { __typename: 'Tweet' });
    const result = extract(detailAnswer(wrapped), DETAIL_FIXTURE.id, {
      instruction: null,
    });
    expect(result.kind).toBe('read');
    if (result.kind !== 'read')
      throw new Error('Generated gated post was not read.');
    expect(result.gated).toEqual([{ id: DETAIL_FIXTURE.id, mediaItems: 3 }]);
    expect(
      result.post.media.every(
        (entry) => entry.status === 'not-stored' && entry.url === null,
      ),
    ).toBe(true);
    expect(result.post.signedInRecord?.mediaDetails).toEqual([]);
  },
);

test.each(['parent', 'quote', 'parent-quote'])(
  'an unknown inner result type still stops in %s',
  (location) => {
    const focal = detailPost();
    const wrapper = visibilityPost('901');
    Object.assign(wrapper.tweet, { __typename: 'GeneratedUnknownTweet' });
    const parent = detailPost('902');
    if (location === 'parent') {
      Object.assign(focal.legacy, { in_reply_to_status_id_str: '901' });
    } else {
      const owner = location === 'quote' ? focal : parent;
      Object.assign(owner, { quoted_status_result: { result: wrapper } });
      Object.assign(owner.legacy, { quoted_status_id_str: '901' });
      if (location === 'parent-quote')
        Object.assign(focal.legacy, { in_reply_to_status_id_str: '902' });
    }
    const answer = detailAnswer(
      focal,
      location === 'parent'
        ? [{ ...wrapper, rest_id: '901' }]
        : location === 'parent-quote'
          ? [parent]
          : [],
    );
    expect(extract(answer, DETAIL_FIXTURE.id, { instruction: null }).kind).toBe(
      'shape-changed',
    );
  },
);
