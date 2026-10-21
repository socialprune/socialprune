import type { Item } from '../model/index.ts';
import { isPopular } from '../workspace/popular.ts';
import { dayKey } from '../workspace/time.ts';
import { KeepRulesSchema } from './schema.ts';
import type { KeepRule } from './schema.ts';

export function evaluateKeepRules(
  item: Item,
  rules: readonly KeepRule[],
  timeZone: string,
  popularThreshold: number | null,
): string[] {
  return KeepRulesSchema.parse(rules)
    .filter((rule) => {
      if (!rule.enabled) return false;
      if (rule.kind === 'created-from')
        return dayKey(item.createdAt, timeZone) >= rule.date;
      if (rule.kind === 'top-liked-tenth')
        return isPopular(item, item.account.key, popularThreshold);
      if (item.platform !== 'x' || item.kind === 'repost') return false;
      const value =
        rule.kind === 'likes-at-least'
          ? item.engagement.likes
          : item.engagement.reposts;
      return value === null ? rule.alsoWhenUnknown : value >= rule.count;
    })
    .map((rule) => rule.id);
}
