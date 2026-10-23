import { expect, test } from 'vitest';
import { deletionPace, cleanDeletions } from './delete-pace.ts';
import { XResponseWindows } from './fill/report.ts';
import type { BrowserRun, BrowserAttempt } from '@socialprune/core';

const now = Date.parse('2026-10-23T12:00:00Z');
const url = 'https://x.com/i/api/graphql/generated/DeleteTweet';
const headers = (limit: number, remaining: number, seconds: number) => ({
  'x-rate-limit-limit': String(limit),
  'x-rate-limit-remaining': String(remaining),
  'x-rate-limit-reset': String(now / 1000 + seconds),
});

test('DEL-1 starts at 30/200 and only a clean hundred enables 15/300', () => {
  const windows = new XResponseWindows();
  for (const count of [0, 1, 99])
    expect(deletionPace(count, windows, now)).toEqual({
      intervalMs: 30000,
      perDay: 200,
    });
  expect(deletionPace(100, windows, now)).toEqual({
    intervalMs: 15000,
    perDay: 300,
  });
});

test('DEL-1 8/500 needs a live DeleteTweet window whose remaining half covers the projected 8-second starts', () => {
  const windows = new XResponseWindows();
  windows.observe(url, headers(1000, 900, 900), now);
  expect(deletionPace(99, windows, now)).toEqual({
    intervalMs: 30000,
    perDay: 200,
  });
  expect(deletionPace(100, windows, now)).toEqual({
    intervalMs: 8000,
    perDay: 500,
  });
  windows.observe(url, headers(1000, 600, 900), now);
  expect(deletionPace(100, windows, now)).toEqual({
    intervalMs: 15000,
    perDay: 300,
  });
  windows.observe(url, headers(1000, 900, 900), now);
  expect(deletionPace(100, windows, now + 900000)).toEqual({
    intervalMs: 15000,
    perDay: 300,
  });
  const other = new XResponseWindows();
  other.observe(
    url.replace('DeleteTweet', 'TweetDetail'),
    headers(1000, 900, 900),
    now,
  );
  expect(deletionPace(100, other, now)).toEqual({
    intervalMs: 15000,
    perDay: 300,
  });
});

test.each([
  [26, 900, { kind: 'ready' }],
  [25, 900, { kind: 'wait', ms: 905000, minutes: 16 }],
  [24, 960, { kind: 'wait', ms: 965000, minutes: 17 }],
  [24, 961, { kind: 'long' }],
  [0, 0, { kind: 'ready' }],
] as const)(
  'a deletion reserves one request before the half-window boundary (%s, %s)',
  (remaining, seconds, expected) => {
    const windows = new XResponseWindows();
    windows.observe(url, headers(50, remaining, seconds), now);
    expect(windows.beforeDeletion(now)).toEqual(expected);
  },
);

test('deletion checks every reported operation, rounds an odd half up, and ignores invalid or foreign headers', () => {
  const windows = new XResponseWindows();
  windows.observe(url, headers(51, 27, 900), now);
  expect(windows.beforeDeletion(now)).toEqual({ kind: 'ready' });
  windows.observe(url, headers(51, 26, 900), now);
  expect(windows.beforeDeletion(now)).toEqual({
    kind: 'wait',
    ms: 905000,
    minutes: 16,
  });
  windows.observe(
    url.replace('DeleteTweet', 'TweetDetail'),
    headers(100, 0, 961),
    now,
  );
  expect(windows.beforeDeletion(now)).toEqual({ kind: 'long' });
  const invalid = new XResponseWindows();
  for (const header of [
    {},
    { ...headers(50, 0, 900), 'x-rate-limit-remaining': '-1' },
    { ...headers(50, 0, 900), 'x-rate-limit-reset': 'private' },
  ])
    invalid.observe(url, header, now);
  invalid.observe(
    url.replace('x.com', 'example.org'),
    headers(50, 0, 900),
    now,
  );
  expect(invalid.summary()).toEqual([]);
  expect(invalid.beforeDeletion(now)).toEqual({ kind: 'ready' });
});

test('clean journal count binds direct confirmed settlements to their sending, run and account; failures reset it', () => {
  const run: BrowserRun = {
    runId: 'generated',
    platform: 'x',
    accountKey: 'x:generated',
    mode: 'delete',
    planHash: 'a'.repeat(64),
    startedAt: new Date(now).toISOString(),
    endedAt: null,
    endReason: null,
    bodyShapes: {},
    profileReport: null,
  };
  const attempts: BrowserAttempt[] = Array.from({ length: 100 }, (_, index) => {
    const sending = {
      seq: index * 2 + 1,
      attemptId: `send-${index}`,
      runId: run.runId,
      itemId: `x:${1000 + index}`,
      action: 'delete-post' as const,
      state: 'sending' as const,
      settles: null,
      at: run.startedAt,
      code: null,
    };
    return [
      sending,
      {
        ...sending,
        seq: sending.seq + 1,
        attemptId: `settle-${index}`,
        state: 'deleted' as const,
        settles: sending.attemptId,
        receipt: {
          method: 'POST',
          path: '/i/api/graphql/generated/DeleteTweet',
          status: 200,
          shape: ['data'],
        },
      },
    ];
  }).flat();
  expect(cleanDeletions({ runs: [run], attempts }, run.accountKey)).toBe(100);
  expect(
    cleanDeletions(
      { runs: [{ ...run, accountKey: 'x:other' }], attempts },
      run.accountKey,
    ),
  ).toBe(0);
  expect(
    cleanDeletions(
      { runs: [{ ...run, mode: 'verify' }], attempts },
      run.accountKey,
    ),
  ).toBe(0);
  expect(
    cleanDeletions(
      { runs: [run], attempts: attempts.slice(0, -1) },
      run.accountKey,
    ),
  ).toBe(0);
  expect(
    cleanDeletions(
      {
        runs: [run],
        attempts: [
          ...attempts.slice(0, -1),
          { ...attempts.at(-1)!, state: 'ambiguous' },
        ],
      },
      run.accountKey,
    ),
  ).toBe(0);
  expect(
    cleanDeletions(
      {
        runs: [{ ...run, endedAt: run.startedAt, endReason: 'platform-check' }],
        attempts,
      },
      run.accountKey,
    ),
  ).toBe(0);
  expect(
    cleanDeletions(
      {
        runs: [run],
        attempts: attempts.map((value) =>
          value.state === 'deleted' ? { ...value, settles: 'missing' } : value,
        ),
      },
      run.accountKey,
    ),
  ).toBe(0);
});
