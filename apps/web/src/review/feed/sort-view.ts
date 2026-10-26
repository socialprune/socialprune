import type { ReviewView } from '@socialprune/core';
import type { FeedSort, FeedTab } from '@socialprune/core/criteria';

export type FeedViews = NonNullable<NonNullable<ReviewView['feed']>['views']>;
export function feedViews(review?: ReviewView): FeedViews {
  const views = structuredClone(review?.feed?.views ?? {});
  if (review?.accountKey)
    for (const [tab, anchor] of Object.entries(review.feed?.anchors ?? {})) {
      const account = (views[review.accountKey] ??= {});
      account[tab as FeedTab] ??= { sort: 'newest', anchor };
    }
  return views;
}
export function feedChoice(views: FeedViews, account: string, tab: FeedTab) {
  return views[account]?.[tab] ?? { sort: 'newest' as const };
}
export function changeFeedSort(
  views: FeedViews,
  account: string,
  tab: FeedTab,
  sort: FeedSort,
): FeedViews {
  const single = views[account]?.[tab]?.single;
  return {
    ...views,
    [account]: {
      ...views[account],
      [tab]: { sort, ...(single === undefined ? {} : { single }) },
    },
  };
}
