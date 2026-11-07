import { expect, test } from 'vitest';
import { soleCommentAnswer } from './sole-comment-answer.ts';
const match = {
  id: '123',
  username: 'generated_own',
  text: 'Generated focal comment',
  createdAt: '2025-01-01T00:00:00.000Z',
};
const focal = {
  pk: match.id,
  user: { username: match.username },
  text: match.text,
  created_at: Date.parse(match.createdAt) / 1000,
  child_comment_count: 0,
};
const code = 'Generated';
test.each([
  'no-count',
  'count',
  'edge',
  'empty-child-list',
  'network',
  'duplicate-focal',
  'other-post',
  'parameters',
] as const)(
  'SOLESCOPE exact sole zero answer admits %s evidence only',
  (kind) => {
    let value: unknown = focal;
    if (kind === 'count') value = { code, comment_count: 1, comments: [focal] };
    if (kind === 'edge')
      value = {
        shortcode: code,
        edge_media_to_parent_comment: { count: 1, edges: [{ node: focal }] },
      };
    if (kind === 'empty-child-list') {
      const rest: Record<string, unknown> = { ...focal };
      delete rest.child_comment_count;
      value = { ...rest, child_comments: [] };
    }
    const extra =
      kind === 'duplicate-focal'
        ? [focal]
        : kind === 'other-post'
          ? [
              {
                code: 'Other',
                comment_count: 9,
                comments: [{ ...focal, pk: '456' }],
              },
            ]
          : kind === 'parameters'
            ? [
                {
                  variables: {
                    comments: [{ ...focal, pk: '456' }],
                    comment_count: 9,
                  },
                },
              ]
            : [];
    expect(
      soleCommentAnswer(
        kind === 'network' ? [value, ...extra] : [],
        kind === 'network' ? [] : [value, ...extra],
        match,
        code,
      ),
    ).toBe(true);
  },
);
test.each([
  'absent',
  'positive',
  'id',
  'author',
  'time',
  'text',
  'other-comment',
  'count-zero',
  'count-two',
  'count-string',
  'unknown-comment',
  'nested-other',
  'mixed-source',
  'count-only',
  'capped',
] as const)('SOLESCOPE refuses %s answer evidence', (kind) => {
  let value: unknown = focal,
    bodies: unknown[] = [];
  if (kind === 'absent') value = {};
  if (kind === 'positive') value = { ...focal, child_comment_count: 1 };
  if (kind === 'id') value = { ...focal, pk: '456' };
  if (kind === 'author')
    value = { ...focal, user: { username: 'generated_other' } };
  if (kind === 'time') value = { ...focal, created_at: focal.created_at + 1 };
  if (kind === 'text') value = { ...focal, text: 'Generated other text' };
  if (kind === 'other-comment')
    value = { comments: [focal, { ...focal, pk: '456' }] };
  if (kind.startsWith('count-'))
    value = {
      code,
      comment_count:
        kind === 'count-zero' ? 0 : kind === 'count-string' ? '1' : 2,
      comments: [focal],
    };
  if (kind === 'count-only') {
    value = focal;
    bodies = [{ comment_count: 2 }];
  }
  if (kind === 'unknown-comment')
    value = { code, comments: [focal, { pk: '456' }] };
  if (kind === 'nested-other')
    value = {
      code,
      comments: { nodes: [focal], extra: { data: { pk: '456' } } },
    };
  if (kind === 'mixed-source') {
    value = focal;
    bodies = [{ comments: [{ ...focal, pk: '456' }] }];
  }
  if (kind === 'capped') {
    value = focal;
    for (let index = 0; index < 42; index++) value = { data: value };
  }
  expect(soleCommentAnswer(bodies, [value], match, code)).toBe(false);
});
