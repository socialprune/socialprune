import { test, expect } from 'vitest';
import { extract } from './extract.ts';
import { isPostAnswer, unexpectedAction } from './read.ts';
import { structureReport } from './report.ts';
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
  const body = detailAnswer(post, [
    detailPost('901'),
    detailPost('902'),
    detailPost('903'),
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
