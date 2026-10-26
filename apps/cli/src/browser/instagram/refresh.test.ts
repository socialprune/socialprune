import { expect, test } from 'vitest';
import { instagramContractRecord } from '@socialprune/core/workspace/store-contract';
import { refreshOutcome } from './refresh.ts';

test('F4 unavailable and absent comment are closed settled outcomes; identity changes still stop', () => {
  const context = instagramContractRecord();
  const post = {
    owner: context.post.owner,
    ownerCount: 1,
    code: context.post.code,
  };
  const result = {
    state: 'confirmed' as const,
    comment: { ...context.comment, username: 'generated', text: 'Generated' },
  };
  expect(refreshOutcome({ opened: false, context })).toBe('post-unavailable');
  expect(
    refreshOutcome({
      opened: true,
      context,
      post,
      result: { state: 'unconfirmed', code: 'not-shown' },
    }),
  ).toBe('comment-not-shown');
  expect(refreshOutcome({ opened: true, context, post, result })).toBeNull();
  for (const change of [
    { post: { ...post, owner: 'different' } },
    { post: { ...post, code: 'Different' } },
    { post: { ...post, ownerCount: 2 } },
    { result: { ...result, comment: { ...result.comment, id: '999' } } },
    {
      result: {
        ...result,
        comment: { ...result.comment, createdAt: '2025-01-01T00:00:00.000Z' },
      },
    },
    { result: { state: 'unconfirmed' as const, code: 'time' as const } },
  ])
    expect(() =>
      refreshOutcome({ opened: true, context, post, result, ...change }),
    ).toThrow();
});
