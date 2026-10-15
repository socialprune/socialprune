import { expect, test } from 'vitest';
import type { PostProjection } from './selectors.ts';
import {
  confirmComment,
  rowCandidate,
  utcWindow,
  postAddress,
} from './selectors.ts';
import {
  instagramFixture,
  IG_FIXTURE,
} from '../../../e2e/fake-instagram/fixture.ts';

test.each(['owner', 'author', 'text', 'time', 'several'] as const)(
  'red-check %s independently rejects a planted wrong match',
  async (field) => {
    const { items } = await instagramFixture(),
      item = items[0]!;
    const comment = {
      username: item.account.handle!,
      text: item.text,
      id: IG_FIXTURE.commentId,
      createdAt: item.createdAt,
    };
    const post = {
      kind: 'p',
      code: IG_FIXTURE.code,
      owner: item.reference.ownerHandle!,
      ownerCount: 1,
      caption: IG_FIXTURE.caption,
      captionComplete: true,
      createdAt: IG_FIXTURE.postAt,
      comments: [comment],
    } as PostProjection;
    if (field === 'owner') post.owner = 'wrong-generated-owner';
    if (field === 'author') comment.username = IG_FIXTURE.other.username;
    if (field === 'text') comment.text = 'Wrong generated text';
    if (field === 'time')
      comment.createdAt = new Date(
        Date.parse(item.createdAt) + 60001,
      ).toISOString();
    if (field === 'several')
      post.comments.push({ ...comment, id: '2828282828' });
    expect(confirmComment(post, item, item.account.handle!).state).toBe(
      'unconfirmed',
    );
  },
);
test('author, full normalized text, 60 second time and first owner are independent confirmation checks', async () => {
  const { items } = await instagramFixture(),
    item = items[0]!;
  const base = {
    kind: 'p',
    code: IG_FIXTURE.code,
    owner: item.reference.ownerHandle!,
    ownerCount: 1,
    caption: IG_FIXTURE.caption,
    captionComplete: true,
    createdAt: IG_FIXTURE.postAt,
    comments: [
      {
        username: item.account.handle!,
        text: item.text,
        id: IG_FIXTURE.commentId,
        createdAt: item.createdAt,
      },
    ],
  } as PostProjection;
  expect(confirmComment(base, item, item.account.handle!).state).toBe(
    'confirmed',
  );
  for (const [change, code] of [
    [{ owner: 'different' }, 'owner'],
    [
      {
        comments: [
          {
            ...base.comments[0]!,
            createdAt: new Date(
              Date.parse(item.createdAt) + 60001,
            ).toISOString(),
          },
        ],
      },
      'time',
    ],
    [{ comments: [{ ...base.comments[0]!, text: 'Different text' }] }, 'text'],
    [
      {
        comments: [
          { ...base.comments[0]!, username: IG_FIXTURE.other.username },
        ],
      },
      'not-shown',
    ],
    [
      { comments: [...base.comments, { ...base.comments[0]!, id: '282828' }] },
      'several',
    ],
  ] as const)
    expect(
      confirmComment(
        {
          ...base,
          ...change,
          comments: change.comments ? [...change.comments] : base.comments,
        },
        item,
        item.account.handle!,
      ),
    ).toMatchObject({ state: 'unconfirmed', code });
  expect(
    confirmComment(
      {
        ...base,
        comments: [
          {
            ...base.comments[0]!,
            createdAt: new Date(
              Date.parse(item.createdAt) + 60000,
            ).toISOString(),
          },
        ],
      },
      item,
      item.account.handle!,
    ).state,
  ).toBe('confirmed');
  expect(rowCandidate(item.text.slice(0, 23) + '...', item.text)).toBe(true);
  expect(rowCandidate('Short...', item.text)).toBe(false);
  expect(utcWindow('2025-07-31T00:00:00.000Z')).toEqual([
    '2025-07-30',
    '2025-08-01',
  ]);
  expect(
    postAddress(
      'https://www.instagram.com/reel/A_-19/',
      'https://www.instagram.com',
    ),
  ).toEqual({ kind: 'reel', code: 'A_-19' });
  for (const path of [
    '/p/../',
    '/p/a/c/99/',
    '/p/a%2Fb/',
    '/p/' + 'a'.repeat(65) + '/',
  ])
    expect(
      postAddress(
        'https://www.instagram.com' + path,
        'https://www.instagram.com',
      ),
    ).toBeNull();
});
