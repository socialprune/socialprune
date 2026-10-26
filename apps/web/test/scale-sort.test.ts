import { expect, test } from 'vitest';
import { scaleWorkspace, SCALE_ACCOUNT } from '../e2e/scale-data.ts';
import { WorkspaceSchema } from '@socialprune/core';

test('SORT-1 measurement seeds nondefault sort in all six tabs with a fixture-derived keyboard oracle', async () => {
  const generated = await scaleWorkspace(6000, 'likes');
  const data = WorkspaceSchema.parse(JSON.parse(generated.text) as unknown);
  expect(generated.manifest.sort).toBe('likes');
  expect(data.settings.review?.feed?.views?.[SCALE_ACCOUNT]).toEqual(
    Object.fromEntries(
      ['suggested', 'held', 'kept', 'unclear', 'marked', 'all'].map((tab) => [
        tab,
        { sort: 'likes' },
      ]),
    ),
  );
  const expected = data.items
    .slice()
    .sort(
      (
        a: {
          engagement: { likes: number | null };
          createdAt: string;
          id: string;
        },
        b: typeof a,
      ) =>
        (b.engagement.likes ?? -1) - (a.engagement.likes ?? -1) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    )
    .map((item: { id: string }) => item.id);
  expect(generated.suggestionOrder).toEqual(expected);
  expect(new Set(generated.suggestionOrder).size).toBe(6000);
  expect(generated.suggestionOrder).not.toEqual(
    data.items.map((item: { id: string }) => item.id),
  );
});
