import type { Item } from '../model/index.ts';

export type PopularityItem = Pick<
  Item,
  'id' | 'account' | 'platform' | 'kind' | 'engagement'
>;

export function topDecileIndex(count: number): number {
  return Math.max(0, Math.ceil(count / 10) - 1);
}

export function eligibleForPopularity(
  item: PopularityItem,
  accountKey: string,
): boolean {
  return (
    item.account.key === accountKey &&
    item.platform === 'x' &&
    item.kind !== 'repost' &&
    item.engagement.likes !== null
  );
}

/** The rank item comes from known-like own non-reposts sorted by likes. */
export function popularityCutoff(
  rankItem: PopularityItem,
  accountKey: string,
): number | null {
  return eligibleForPopularity(rankItem, accountKey)
    ? Math.max(3, rankItem.engagement.likes!)
    : null;
}

/** Highest ceil(n/10) known-like own X entries, with ties and a floor of three. */
export function popularityThreshold(
  items: readonly PopularityItem[],
  accountKey: string,
): number | null {
  const own = items
    .filter((item) => eligibleForPopularity(item, accountKey))
    .sort((a, b) => b.engagement.likes! - a.engagement.likes!);
  const rank = own[topDecileIndex(own.length)];
  return rank ? popularityCutoff(rank, accountKey) : null;
}

export function isPopular(
  item: PopularityItem,
  accountKey: string,
  threshold: number | null,
): boolean {
  return (
    threshold !== null &&
    eligibleForPopularity(item, accountKey) &&
    item.engagement.likes! >= threshold
  );
}

export function popularIds(
  items: readonly PopularityItem[],
  accountKey: string,
  threshold = popularityThreshold(items, accountKey),
): Set<string> {
  return new Set(
    items
      .filter((item) => isPopular(item, accountKey, threshold))
      .map((item) => item.id),
  );
}
