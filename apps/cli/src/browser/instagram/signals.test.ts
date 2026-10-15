import { expect, test } from 'vitest';
import {
  LimitSignals,
  rateSignal,
  hostClass,
  pathClass,
  RATE_SIGNALS,
} from './signals.ts';
import { IG_FIXTURE } from '../../../e2e/fake-instagram/fixture.ts';

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
