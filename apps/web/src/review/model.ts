import type { DecisionValue } from '@socialprune/core';

export const decisionMessage = {
  keep: 'review.keep',
  delete: 'review.marked',
  later: 'review.later',
  undecided: 'review.undecided',
} as const;
export function categoryID(value: string) {
  return Object.hasOwn(categoryMessage, value)
    ? categoryMessage[value as keyof typeof categoryMessage]
    : 'review.categoryUnclear';
}
export const kindMessage = {
  post: 'review.post',
  reply: 'review.reply',
  quote: 'review.quote',
  repost: 'review.repost',
  comment: 'review.comment',
} as const;
export const riskMessage = [
  'review.riskNone',
  'review.riskLow',
  'review.riskMedium',
  'review.riskHigh',
] as const;
export const categoryMessage = {
  toxic: 'review.categoryToxic',
  'personal-attack': 'review.categoryAttack',
  political: 'review.categoryPolitical',
  sexual: 'review.categorySexual',
  'drugs-illegal': 'review.categoryDrugs',
  'personal-info': 'review.categoryPersonal',
  embarrassing: 'review.categoryEmbarrassing',
  empty: 'review.categoryEmpty',
  harmless: 'review.categoryHarmless',
  unclear: 'review.categoryUnclear',
} as const;
export function letterDecision(
  key: string,
  gridFocused: boolean,
  enabled: boolean,
): DecisionValue | null {
  if (!gridFocused || !enabled) return null;
  return (
    ({ m: 'delete', k: 'keep', l: 'later', u: 'undecided' } as const)[
      key.toLowerCase() as 'm'
    ] ?? null
  );
}
export function evidenceParts(
  text: string,
  evidence: string | null,
): { before: string; match: string; after: string } | null {
  if (!evidence) return null;
  const index = text.indexOf(evidence);
  return index < 0
    ? null
    : {
        before: text.slice(0, index),
        match: evidence,
        after: text.slice(index + evidence.length),
      };
}
export function platformLink(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      ['x.com', 'twitter.com'].includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
