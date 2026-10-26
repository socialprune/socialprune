import { expect, test } from 'vitest';
import { changeFeedSort, feedChoice, feedViews } from './sort-view.ts';

test('changing a sort resets only that account/tab anchor and retains other choices', () => {
  const views = {
    x: {
      all: { sort: 'likes' as const, anchor: 'one' },
      kept: { sort: 'oldest' as const, anchor: 'two' },
    },
    ig: { all: { sort: 'oldest' as const, anchor: 'three' } },
  };
  const changed = changeFeedSort(views, 'x', 'all', 'reposts');
  expect(changed).toEqual({
    ...views,
    x: { ...views.x, all: { sort: 'reposts' } },
  });
  expect(feedChoice(changed, 'new', 'all')).toEqual({ sort: 'newest' });
});
test('legacy anchors migrate into the old account only and never replace new preferences', () => {
  const review = {
    accountKey: 'x',
    filter: {},
    sort: [{ by: 'id' as const, direction: 'asc' as const }],
    search: '',
    feed: { tab: 'all' as const, anchors: { all: 'legacy' } },
  };
  expect(feedViews(review)).toEqual({
    x: { all: { sort: 'newest', anchor: 'legacy' } },
  });
  expect(
    feedViews({
      ...review,
      feed: { ...review.feed, views: { x: { all: { sort: 'likes' } } } },
    }),
  ).toEqual({ x: { all: { sort: 'likes' } } });
});
