import type { Item, InstagramContext } from '../model/index.ts';

/** Export metadata wins. Context contributes only exact post-confirmed comment likes. */
export function effectiveEngagement(
  item: Pick<Item, 'id' | 'platform' | 'kind' | 'engagement'>,
  context?: InstagramContext,
): Item['engagement'] {
  return {
    ...item.engagement,
    likes:
      item.engagement.likes ??
      (item.platform === 'instagram' &&
      item.kind === 'comment' &&
      context?.itemId === item.id &&
      context.confirmedBy === 'post'
        ? (context.likes?.count ?? null)
        : null),
  };
}
export function withEffectiveEngagement(
  item: Item,
  context?: InstagramContext,
): Item {
  const engagement = effectiveEngagement(item, context);
  return engagement.likes === item.engagement.likes
    ? item
    : { ...item, engagement };
}
