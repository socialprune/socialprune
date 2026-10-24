import {
  KeepRulesSchema,
  CRITERIA_SELECTED_MAX,
} from '@socialprune/core/criteria';
import type { KeepRule, CriteriaSettings } from '@socialprune/core/criteria';
import type { KeepRuleModel } from './types.ts';

export function ruleModels(
  rules: readonly KeepRule[],
  held: Record<string, number>,
  threshold: number | null,
): KeepRuleModel[] {
  return rules.map((rule) => ({
    id: rule.id,
    enabled: rule.enabled,
    held: held[rule.id] ?? 0,
    kind:
      rule.kind === 'top-liked-tenth'
        ? 'top-tenth'
        : rule.kind === 'likes-at-least'
          ? 'likes'
          : rule.kind === 'reposts-at-least'
            ? 'reposts'
            : 'date',
    value:
      rule.kind === 'top-liked-tenth'
        ? String(threshold ?? 3)
        : rule.kind === 'created-from'
          ? rule.date
          : String(rule.count),
    ...('alsoWhenUnknown' in rule ? { unknown: rule.alsoWhenUnknown } : {}),
  }));
}
export function storedRules(
  models: readonly KeepRuleModel[],
): KeepRule[] | null {
  const input = models.map((rule) =>
    rule.kind === 'top-tenth'
      ? { id: rule.id, kind: 'top-liked-tenth', enabled: rule.enabled }
      : rule.kind === 'date'
        ? {
            id: rule.id,
            kind: 'created-from',
            enabled: rule.enabled,
            date: rule.value,
          }
        : {
            id: rule.id,
            kind: rule.kind === 'likes' ? 'likes-at-least' : 'reposts-at-least',
            enabled: rule.enabled,
            count: /^\d+$/.test(rule.value) ? Number(rule.value) : -1,
            alsoWhenUnknown: !!rule.unknown,
          },
  );
  const parsed = KeepRulesSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
export type RuleOffer = { kind: 'likes' | 'reposts' | 'date'; value: string };
export function contentLimitOffer(text: string): RuleOffer | null {
  const date = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (
    date &&
    /date|datum|ab|since|from|nach|after/i.test(text) &&
    !Number.isNaN(Date.parse(date[0]))
  )
    return { kind: 'date', value: date[0] };
  const number = text.match(/[-+]?\d+(?:[.,]\d+)?/)?.[0];
  if (!number) return null;
  if (/reposts?|retweets?/i.test(text))
    return { kind: 'reposts', value: number };
  if (/likes?|gefällt\s*mir|herzen/i.test(text))
    return { kind: 'likes', value: number };
  return null;
}
export function toggleCriterion(
  criteria: CriteriaSettings,
  id: string,
  selected: boolean,
): CriteriaSettings | null {
  const ids = selected
    ? [...new Set([...criteria.selected, id])]
    : criteria.selected.filter((value) => value !== id);
  return ids.length <= CRITERIA_SELECTED_MAX
    ? { ...criteria, selected: ids }
    : null;
}
