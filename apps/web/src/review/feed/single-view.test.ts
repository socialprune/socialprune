import { expect, test, vi } from 'vitest';
import { singleMode, setSingleMode } from './single-view.ts';
import { ReviewViewSchema } from '@socialprune/core';
import { feedViews } from './sort-view.ts';
test('single mode is browser-local and bounded by workspace, account and tab', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  setSingleMode('one', 'x', 'all', true);
  expect(singleMode('one', 'x', 'all')).toBe(true);
  expect(singleMode('two', 'x', 'all')).toBe(false);
  expect(singleMode('one', 'ig', 'all')).toBe(false);
  expect(singleMode('one', 'x', 'kept')).toBe(false);
  setSingleMode('one', 'x', 'all', false);
  expect(singleMode('one', 'x', 'all')).toBe(false);
  vi.unstubAllGlobals();
});
test('browser-local mode never enters the strict version-11 review document', () => {
  const review = {
    accountKey: 'x',
    filter: {},
    search: '',
    sort: [{ by: 'createdAt', direction: 'desc' }],
    feed: {
      tab: 'all',
      anchors: {},
      views: { x: { all: { sort: 'newest' } } },
    },
  };
  expect(ReviewViewSchema.safeParse(review).success).toBe(true);
  expect(
    ReviewViewSchema.safeParse({
      ...review,
      feed: {
        ...review.feed,
        views: { x: { all: { sort: 'newest', single: true } } },
      },
    }).success,
  ).toBe(false);
  expect(feedViews(ReviewViewSchema.parse(review))).toEqual({
    x: { all: { sort: 'newest' } },
  });
});
