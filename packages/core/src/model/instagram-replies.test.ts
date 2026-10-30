import { expect, test } from 'vitest';
import {
  InstagramContextSchema,
  validateInstagramRepliesFill,
} from './instagram-context.ts';
import { createMemoryStore } from '../workspace/memory-store.ts';
import { writeInstagramContextContract } from '../workspace/store-contract.ts';

test('REPLIES-1 post observations fill once, survive likes fills and cannot alter confirmation or list records', async () => {
  const store = createMemoryStore();
  const prior = await writeInstagramContextContract(store);
  const replies = {
    entries: [
      {
        account: 'generated_reply',
        text: 'Generated reply text',
        createdAt: null,
        likes: { count: 3, source: 'dom' as const },
      },
    ],
    moreCount: 1,
    capped: false,
  };
  const next = { ...prior, replies };
  expect(InstagramContextSchema.safeParse(next).success).toBe(true);
  expect(() => validateInstagramRepliesFill(prior, next)).not.toThrow();
  expect(() => validateInstagramRepliesFill(next, next)).toThrow(
    'CONTEXT_WRITE_ONCE',
  );
  expect(() =>
    validateInstagramRepliesFill(prior, { ...next, runId: 'other' }),
  ).toThrow('CONTEXT_WRITE_ONCE');
  expect(
    InstagramContextSchema.safeParse({
      ...prior,
      confirmedBy: 'list',
      comment: { ...prior.comment, id: null, createdAt: null },
      replies,
    }).success,
  ).toBe(false);
  expect(
    InstagramContextSchema.safeParse({
      ...next,
      replies: {
        ...replies,
        entries: Array.from({ length: 51 }, () => replies.entries[0]),
      },
    }).success,
  ).toBe(false);
  await store.write((tx) => tx.instagramContext.fillReplies(next));
  await expect(
    store.write((tx) => tx.instagramContext.fillReplies(next)),
  ).rejects.toThrow('CONTEXT_WRITE_ONCE');
  expect(
    (await store.read((tx) => tx.instagramContext.get(prior.itemId)))?.replies,
  ).toEqual(replies);
  const withLikes = { ...next, likes: { count: 8, source: 'dom' as const } };
  await store.write((tx) => tx.instagramContext.fillLikes(withLikes));
  expect(
    await store.read((tx) => tx.instagramContext.get(prior.itemId)),
  ).toEqual(withLikes);
  await expect(
    store.write((tx) =>
      tx.instagramContext.fillLikes({
        ...withLikes,
        replies: { ...replies, moreCount: 2 },
      }),
    ),
  ).rejects.toThrow('CONTEXT_WRITE_ONCE');
  await store.close();
});
