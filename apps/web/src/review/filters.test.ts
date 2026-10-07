import { expect, test } from 'vitest';
import { inputDate, templateFilter } from './filters.ts';

test('templates only produce explicit filters and keep unknown engagement separate', () => {
  expect(
    templateFilter(
      'old',
      'Europe/Berlin',
      new Date('2026-10-07T12:00:00.000Z'),
    ),
  ).toEqual({
    dates: { from: null, to: '2024-10-07' },
    likes: { min: 0, max: 0, unknown: 'exclude' },
    reposts: { min: 0, max: 0, unknown: 'exclude' },
  });
  expect(templateFilter('replies', 'UTC')).toEqual({ kinds: ['reply'] });
  expect(templateFilter('reposts', 'UTC')).toEqual({ kinds: ['repost'] });
  expect(templateFilter('application', 'UTC')).toMatchObject({
    risk: { min: 1, max: 3, unknown: 'exclude' },
  });
  expect(inputDate('2026-10-07')).toBe('2026-10-07');
  expect(inputDate('')).toBeNull();
});
