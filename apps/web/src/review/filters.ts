import type { QueryFilter } from '@socialprune/core/workspace/protocol';
import { dayKey } from '@socialprune/core/workspace/time';

export const templateMessage = {
  none: 'review.templateNone',
  application: 'review.templateApplication',
  old: 'review.templateOld',
  replies: 'review.templateReplies',
  reposts: 'review.templateReposts',
} as const;
export type Template = keyof typeof templateMessage;

export function templateFilter(
  template: Template,
  timeZone: string,
  now = new Date(),
): QueryFilter {
  switch (template) {
    case 'application':
      return {
        categories: [
          'toxic',
          'personal-attack',
          'political',
          'sexual',
          'drugs-illegal',
          'embarrassing',
        ],
        risk: { min: 1, max: 3, unknown: 'exclude' },
      };
    case 'old': {
      const twoYearsAgo = new Date(now);
      twoYearsAgo.setUTCFullYear(twoYearsAgo.getUTCFullYear() - 2);
      return {
        dates: { from: null, to: dayKey(twoYearsAgo.toISOString(), timeZone) },
        likes: { min: 0, max: 0, unknown: 'exclude' },
        reposts: { min: 0, max: 0, unknown: 'exclude' },
      };
    }
    case 'replies':
      return { kinds: ['reply'] };
    case 'reposts':
      return { kinds: ['repost'] };
    default:
      return {};
  }
}
export function inputDate(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
