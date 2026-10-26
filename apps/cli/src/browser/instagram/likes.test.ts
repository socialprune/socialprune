import { expect, test } from 'vitest';
import { answerLikes, parseVisibleLikes } from './likes.ts';

test('answer likes require exact comment identity and reject post likes, foreign comments and conflicts', () => {
  const match = {
    id: '123',
    createdAt: '2025-01-02T12:00:00.000Z',
    username: 'generated_person',
    text: 'Generated text',
  };
  const comment = {
    pk: '123',
    created_at: 1735819200,
    user: { username: 'generated_person' },
    text: match.text,
    comment_like_count: 17,
  };
  expect(
    answerLikes(
      [{ code: 'Post', like_count: 999, comments: [comment] }],
      match,
    ),
  ).toBe(17);
  expect(answerLikes([{ ...comment, pk: '124' }], match)).toBeNull();
  expect(
    answerLikes([{ ...comment, user: { username: 'other' } }], match),
  ).toBeNull();
  expect(answerLikes([{ ...comment, text: 'other' }], match)).toBeNull();
  expect(
    answerLikes([comment, { ...comment, comment_like_count: 18 }], match),
  ).toBeNull();
  expect(
    answerLikes([{ ...comment, created_at: comment.created_at + 1 }], match),
  ).toBeNull();
  expect(answerLikes([{ variables: comment }], match)).toBeNull();
  expect(
    answerLikes([{ ...comment, comment_like_count: -1 }], match),
  ).toBeNull();
});
test('visible like parsing accepts only full unambiguous integer English counts', () => {
  expect(parseVisibleLikes('1 like')).toBe(1);
  expect(parseVisibleLikes('1,234 likes')).toBe(1234);
  for (const value of [
    '1.2K likes',
    'Likes',
    'Reply',
    '12',
    '-1 likes',
    '12.5 likes',
    '1,23 likes',
  ])
    expect(parseVisibleLikes(value)).toBeNull();
});
