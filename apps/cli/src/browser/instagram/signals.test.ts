import { expect, test } from 'vitest';
import {
  LimitSignals,
  rateSignal,
  hostClass,
  pathClass,
  RATE_SIGNALS,
  postPathClass,
} from './signals.ts';
import {
  IG_FIXTURE,
  POST_NOTICE_FIXTURE,
} from '../../../e2e/fake-instagram/fixture.ts';
test('C19 post path classes separate media comments and info from unrelated API paths without IDs', () => {
  for (const entry of POST_NOTICE_FIXTURE.cases)
    expect(
      postPathClass(
        `https://www.instagram.com${entry.path}?${IG_FIXTURE.other.text}`,
      ),
    ).toBe(entry.pathClass);
  for (const suffix of ['', '/', '/extra']) {
    expect(
      postPathClass(
        `https://www.instagram.com/api/v1/media/${POST_NOTICE_FIXTURE.mediaId}_19/comments${suffix}`,
      ),
    ).toBe('api-v1-media-comments');
    expect(
      postPathClass(
        `https://www.instagram.com/api/v1/media/${POST_NOTICE_FIXTURE.mediaId}/info${suffix}`,
      ),
    ).toBe('api-v1-media-info');
  }
  for (const path of [
    '/api/v1/qe/expose/',
    '/api/v1/media/comment_infos/',
    '/api/v1/media/not-an-id/comments/',
    '/api/v1/media//comments/',
    `/api/v1/media/${POST_NOTICE_FIXTURE.mediaId}/comments_like/`,
    `/api/v1/media/${POST_NOTICE_FIXTURE.mediaId}/information/`,
  ])
    expect(postPathClass(`https://www.instagram.com${path}`)).toBe(
      'api-v1-other',
    );
  expect(postPathClass(`https://www.instagram.com/p/${IG_FIXTURE.code}`)).toBe(
    'post-page',
  );
  expect(
    postPathClass(
      `https://www.instagram.com/api/v1/media/${POST_NOTICE_FIXTURE.mediaId}/info/`,
      true,
    ),
  ).toBe('media');
});
test.each(['p', 'reel'] as const)(
  'C17 post path class %s is the same with and without the terminal slash',
  (kind) => {
    for (const suffix of ['', '/', '?generated_value=private'])
      expect(
        pathClass(
          `https://www.instagram.com/${kind}/${IG_FIXTURE.code}${suffix}`,
        ),
      ).toBe('post-page');
    expect(
      pathClass(`https://www.instagram.com/${kind}/${IG_FIXTURE.code}/foreign`),
    ).toBe('other');
  },
);

test('rate signals match only exact closed values under status or message keys', () => {
  for (const value of RATE_SIGNALS) {
    expect(rateSignal({ data: [{ status: value }] })).toBe(true);
    expect(rateSignal({ message: value })).toBe(true);
    for (const body of [
      { text: value },
      { status: `${value} later` },
      { message: `text ${value}` },
      { [value]: true },
      { Message: value },
    ])
      expect(rateSignal(body)).toBe(false);
  }
});
test('response and ready summaries contain only closed classifications, status codes, durations and header names', () => {
  const signals = new LimitSignals();
  for (const status of [200, 403, 403, 429, 502, 503])
    signals.response('instagram', 'graphql', status, {
      'Retry-After': IG_FIXTURE.other.text,
      'X-RateLimit-Remaining': IG_FIXTURE.other.username,
      'Content-Type': 'application/json',
      ['X-Private-' + IG_FIXTURE.other.code]: IG_FIXTURE.other.time,
    });
  for (const duration of [5, 10, 20, 25]) signals.navigated('list', duration);
  signals.navigated('post', 13);
  expect(signals.summary()).toEqual({
    responses: [
      {
        host: 'instagram',
        path: 'graphql',
        count: 6,
        status4xx: { '403': 2, '429': 1 },
        status5xx: 2,
      },
    ],
    ready: {
      list: { count: 4, medianMs: 15, maxMs: 25 },
      post: { count: 1, medianMs: 13, maxMs: 13 },
    },
    headerNames: ['retry-after', 'x-ratelimit-remaining'],
  });
  for (const value of Object.values(IG_FIXTURE.other))
    expect(JSON.stringify(signals.summary())).not.toContain(value);
  for (const [url, host, path] of [
    [
      'https://www.instagram.com/your_activity/interactions/comments',
      'instagram',
      'list-page',
    ],
    ['https://www.instagram.com/p/generated/', 'instagram', 'post-page'],
    [
      'https://www.instagram.com/async/wbloks/fetch/',
      'instagram',
      'wbloks-fetch',
    ],
    ['https://www.instagram.com/graphql/query?secret', 'instagram', 'graphql'],
    ['https://www.instagram.com/api/v1/read/', 'instagram', 'api-v1-read'],
    ['https://a.cdninstagram.com/image', 'cdninstagram', 'media'],
    ['https://a.fbcdn.net/image', 'fbcdn', 'media'],
  ] as const) {
    expect(hostClass(url)).toBe(host);
    expect(pathClass(url, path === 'media')).toBe(path);
  }
});
test('P2 planted header values never enter a report even when they resemble rate-header names', () => {
  const signals = new LimitSignals();
  const planted = 'x-ratelimit-planted-account-value';
  signals.response('instagram', 'api-v1-read', 200, {
    'X-RateLimit-Remaining': planted,
    'Retry-After': IG_FIXTURE.other.code,
  });
  expect(JSON.stringify(signals.summary())).not.toContain(planted);
  expect(signals.summary().headerNames).toEqual([
    'retry-after',
    'x-ratelimit-remaining',
  ]);
});
