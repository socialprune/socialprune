import { expect, test } from 'vitest';
import {
  InstagramContextSchema,
  InstagramRepliesSchema,
  repliesObserved,
  validateInstagramRepliesFill,
} from './instagram-context.ts';
import { createMemoryStore } from '../workspace/memory-store.ts';
import { writeInstagramContextContract } from '../workspace/store-contract.ts';
import {
  createBackup,
  readBackup,
  restoreBackup,
} from '../workspace/backup.ts';
import { validateWorkspace } from '../workspace/validation.ts';

const chunks = (text: string) =>
  (async function* () {
    await Promise.resolve();
    yield text;
  })();

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
  const doc = await readBackup(createBackup(store).chunks);
  const { schemaVersion, ...rest } = doc;
  const reordered = JSON.stringify({ ...rest, schemaVersion });
  expect(
    (
      await readBackup(
        (async function* () {
          await Promise.resolve();
          yield reordered;
        })(),
      )
    ).instagramContext?.[0]?.replies,
  ).toEqual(replies);
  await store.close();
});

// REPLY-SET-2 (version 13). Generated entries only.
const entry = (index: number, source?: 'shown' | 'answer-only') => ({
  account: `generated_reply_${index}`,
  text: `Generated reply ${index}`,
  createdAt: null,
  likes: { count: null, source: null },
  ...(source ? { source } : {}),
});
const complete = {
  entries: [entry(0, 'shown'), entry(1, 'answer-only')],
  moreCount: 0,
  capped: false,
  set: { state: 'complete' as const },
};
const incomplete = {
  entries: [entry(0, 'shown'), entry(1, 'shown')],
  moreCount: 2,
  capped: false,
  set: { state: 'incomplete' as const, declaredTotal: 4, hiddenCount: 2 },
};
test('REPLY-SET-2 a marked set names every source and counts every declared reply', () => {
  for (const value of [complete, incomplete])
    expect(InstagramRepliesSchema.safeParse(value).success).toBe(true);
  for (const value of [
    { ...complete, set: undefined },
    { ...complete, entries: [entry(0, 'shown'), entry(1)] },
    { ...complete, entries: [entry(0, 'shown'), entry(1, 'shown')] },
    { ...complete, entries: [entry(0, 'answer-only')] },
    { ...complete, moreCount: 1 },
    { ...complete, capped: true },
    { ...incomplete, moreCount: 1 },
    { ...incomplete, set: { ...incomplete.set, declaredTotal: 5 } },
    { ...incomplete, set: { ...incomplete.set, hiddenCount: 0 } },
    { ...incomplete, set: { state: 'partial' } },
  ])
    expect(InstagramRepliesSchema.safeParse(value).success).toBe(false);
  expect(repliesObserved(undefined)).toBe(false);
  expect(repliesObserved(complete)).toBe(true);
  expect(repliesObserved(incomplete)).toBe(false);
  expect(
    repliesObserved({ entries: [entry(0)], moreCount: 0, capped: false }),
  ).toBe(true);
});
test.each([
  ['complete', complete],
  ['incomplete', incomplete],
] as const)(
  'REPLY-SET-2 a %s set round-trips at version 13 and is refused in a version 12 workspace or backup',
  async (_name, value) => {
    const store = createMemoryStore();
    try {
      const prior = await writeInstagramContextContract(store);
      const next = { ...prior, replies: value };
      await store.write((tx) => tx.instagramContext.fillReplies(next));
      const doc = await readBackup(createBackup(store).chunks);
      expect(doc.schemaVersion).toBe(13);
      expect(doc.instagramContext?.[0]?.replies).toEqual(value);
      const target = createMemoryStore();
      try {
        await restoreBackup(target, chunks(JSON.stringify(doc)));
        expect(
          (await target.read((tx) => tx.instagramContext.get(prior.itemId)))
            ?.replies,
        ).toEqual(value);
      } finally {
        await target.close();
      }
      const old = { ...doc, schemaVersion: 12 };
      expect(() => validateWorkspace(old)).toThrow('INVALID_WORKSPACE');
      const refused = createMemoryStore();
      try {
        await expect(
          restoreBackup(refused, chunks(JSON.stringify(old))),
        ).rejects.toMatchObject({ code: 'BACKUP_INVALID_SCHEMA' });
      } finally {
        await refused.close();
      }
      // An unmarked v12 observation stays admissible at version 12.
      const plain = {
        ...old,
        instagramContext: old.instagramContext!.map((record) => ({
          ...record,
          replies: { entries: [entry(0)], moreCount: 0, capped: false },
        })),
      };
      expect(validateWorkspace(plain).schemaVersion).toBe(12);
    } finally {
      await store.close();
    }
  },
);
