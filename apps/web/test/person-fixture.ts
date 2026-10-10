import type { WorkspaceV2 } from '@socialprune/core';
import { reviewFixture } from '../e2e/review-fixture.ts';

// The generated input and the declared oracle are independent of archive code.
// No fixture is a copy of a real post or a parser-produced expected value.
export const personExpected = {
  accountKey: 'synthetic-review',
  handle: 'invented_review',
  thread: ['x:review-0000', 'x:review-0001', 'x:review-0002'],
  groupsNewestFirst: [
    ['x:review-0006'],
    ['x:review-0005'],
    ['x:review-0004'],
    ['x:review-0003'],
    ['x:review-0000', 'x:review-0001', 'x:review-0002'],
  ],
  recapAt20261010: {
    age: 7,
    year: '2020',
    activeCount: 3,
    likes: 12,
    lols: 2,
    oldest: '2018-10-11T12:00:00.000Z',
    years: ['2021', '2020', '2018'],
  },
  year2020Ids: ['x:review-0005', 'x:review-0004', 'x:review-0003'],
  query: 'café',
  foreignReplyId: 'x:review-0003',
  deleteIds: ['x:review-0000', 'x:review-0003'],
  suggestionIds: ['x:review-0000', 'x:review-0003'],
} as const;

export function personFixture(): WorkspaceV2 {
  const data = reviewFixture();
  const rows = [
    ['2018-10-11T12:00:00.000Z', 'Invented café thread. lol', 0],
    ['2018-10-12T12:00:00.000Z', 'Invented second thread post.', 5],
    ['2018-10-13T12:00:00.000Z', 'Invented last thread post. LOL', 12],
    ['2020-05-02T12:00:00.000Z', 'Invented reply to a different person.', 8],
    ['2020-06-04T12:00:00.000Z', 'Invented repost from another account.', null],
    [
      '2020-07-09T12:00:00.000Z',
      'Invented quote, without original content.',
      4,
    ],
    ['2021-01-01T00:30:00.000Z', 'Invented New Year note.', 3],
    ['2022-02-03T12:00:00.000Z', 'Invented Instagram comment.', null],
  ] as const;
  data.items.forEach((item, index) => {
    const [createdAt, text, likes] = rows[index]!;
    item.createdAt = createdAt;
    item.text = text;
    item.engagement = { likes, reposts: index === 4 ? 2 : 0 };
    item.mediaCount = index === 1 ? 2 : 0;
    item.kind = 'post';
  });
  for (const index of [1, 2]) {
    const item = data.items[index]!;
    item.kind = 'reply';
    item.reference.replyToId = data.items[index - 1]!.id.slice(2);
    item.reference.replyToHandle = item.account.handle;
  }
  const foreign = data.items[3]!;
  foreign.kind = 'reply';
  foreign.reference.replyToId = data.items[0]!.id.slice(2);
  foreign.reference.replyToHandle = 'generated_other';
  data.items[4]!.kind = 'repost';
  data.items[4]!.reference.repostOfHandle = 'generated_repost';
  data.items[5]!.kind = 'quote';
  data.items[5]!.reference.quotedId = 'generated-quote-not-in-export';
  const ig = data.items[7]!;
  ig.platform = 'instagram';
  ig.id = 'instagram:generated-comment';
  ig.kind = 'comment';
  ig.account = { key: 'synthetic-comment', handle: 'generated_commenter' };
  ig.reference.ownerHandle = 'generated_owner';
  ig.url = null;
  data.assessments[0]!.risk = 3;
  data.assessments[0]!.evidence = null;
  data.assessments[1]!.itemId = foreign.id;
  data.assessments[1]!.risk = 2;
  return data;
}
