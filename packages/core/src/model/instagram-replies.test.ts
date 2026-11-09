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
import { InstagramContextWriter } from '../workspace/instagram-context-writer.ts';

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
const entry = (
  index: number,
  source?: 'shown' | 'answer-only',
  createdAt: string | null = source === 'answer-only'
    ? `2026-10-0${index + 1}T12:00:00.000Z`
    : null,
) => ({
  account: `generated_reply_${index}`,
  text: `Generated reply ${index}`,
  createdAt,
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
    // G1 revision: an answer-only reply is a full entry with its time.
    {
      ...complete,
      entries: [entry(0, 'shown'), entry(1, 'answer-only', null)],
    },
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

// G1 revision, invariant 3: one replacement of an incomplete set, only by a
// complete read that keeps every stored reply with author, time and text.
const replacement = {
  entries: [
    entry(0, 'shown'),
    entry(1, 'shown'),
    entry(2, 'answer-only'),
    entry(3, 'answer-only'),
  ],
  moreCount: 0,
  capped: false,
  set: { state: 'complete' as const },
};
test('REPLY-SET-2 an incomplete set is replaced once by a complete read that keeps every stored reply', async () => {
  const store = createMemoryStore();
  try {
    const prior = await writeInstagramContextContract(store);
    await store.write((tx) =>
      tx.instagramContext.fillReplies({ ...prior, replies: incomplete }),
    );
    const stored = { ...prior, replies: incomplete };
    expect(() =>
      validateInstagramRepliesFill(stored, { ...prior, replies: replacement }),
    ).not.toThrow();
    // An unmarked full read (every reply shown) is complete too.
    expect(() =>
      validateInstagramRepliesFill(stored, {
        ...prior,
        replies: {
          entries: [0, 1, 2, 3].map((index) => entry(index)),
          moreCount: 0,
          capped: false,
        },
      }),
    ).not.toThrow();
    for (const replies of [
      incomplete,
      { ...replacement, entries: replacement.entries.slice(1) },
      {
        ...replacement,
        entries: [
          { ...entry(0, 'shown'), text: 'Generated changed text' },
          ...replacement.entries.slice(1),
        ],
      },
      {
        ...replacement,
        entries: [
          { ...entry(0, 'shown'), account: 'generated_other' },
          ...replacement.entries.slice(1),
        ],
      },
      {
        ...replacement,
        entries: [
          entry(0, 'shown', '2026-10-09T12:00:00.000Z'),
          ...replacement.entries.slice(1),
        ],
      },
      { entries: [entry(0), entry(1)], moreCount: 1, capped: false },
      { entries: [entry(0), entry(1)], moreCount: 0, capped: true },
    ])
      expect(() =>
        validateInstagramRepliesFill(stored, { ...prior, replies }),
      ).toThrow('REPLY_SET_CONFLICT');
    // Nothing else in the record may change with the replacement.
    expect(() =>
      validateInstagramRepliesFill(stored, {
        ...prior,
        runId: 'generated-other-run',
        replies: replacement,
      }),
    ).toThrow('CONTEXT_WRITE_ONCE');
    await store.write((tx) =>
      tx.instagramContext.fillReplies({ ...prior, replies: replacement }),
    );
    expect(
      (await store.read((tx) => tx.instagramContext.get(prior.itemId)))
        ?.replies,
    ).toEqual(replacement);
    // Exactly once: a complete set, like every observation, is write-once.
    await expect(
      store.write((tx) =>
        tx.instagramContext.fillReplies({ ...prior, replies: replacement }),
      ),
    ).rejects.toThrow('CONTEXT_WRITE_ONCE');
    expect(() =>
      validateInstagramRepliesFill(
        { ...prior, replies: complete },
        { ...prior, replies: replacement },
      ),
    ).toThrow('CONTEXT_WRITE_ONCE');
  } finally {
    await store.close();
  }
});

// G1 revision, invariant 6: an incomplete read confirms nothing for a canary.
test.each([false, true])(
  'REPLY-SET-2 a refresh canary of one incomplete read is not accepted (checked=%s), a complete one is',
  async (checked) => {
    for (const replies of [incomplete, complete]) {
      const store = createMemoryStore();
      try {
        const prior = await writeInstagramContextContract(store);
        const writer = new InstagramContextWriter(store),
          runId = `generated-canary-${String(checked)}`,
          at = prior.confirmedAt,
          attemptId = `${runId}-attempt`;
        await writer.startRun({
          runId,
          accountKey: prior.accountKey,
          planHash: 'a'.repeat(64),
          startedAt: at,
        });
        await writer.sending({
          runId,
          attemptId,
          itemId: prior.itemId,
          at,
          refreshReplies: true,
        });
        expect(await writer.fillReplies(attemptId, replies, at)).toBe('read');
        await writer.endRun({
          runId,
          endedAt: at,
          endReason: 'canary',
          bodyShapes: {},
          profileReport: {
            accountBefore: prior.accountKey.slice('instagram:'.length),
            accountAfter: prior.accountKey.slice('instagram:'.length),
            extensionsBefore: 0,
            extensionsAfter: 0,
            changedFiles: [],
            unexpectedRequests: [],
          },
        });
        const accept = writer.acceptCanary(
          runId,
          at,
          checked ? [prior.itemId] : undefined,
        );
        if (replies === incomplete || checked)
          await expect(accept).rejects.toThrow('INVALID_CANARY');
        else await expect(accept).resolves.toBeUndefined();
      } finally {
        await store.close();
      }
    }
  },
);
test('REPLY-SET-2 a re-read that would drop a stored reply settles as reply-set-conflict and keeps the incomplete set', async () => {
  const store = createMemoryStore();
  try {
    const prior = await writeInstagramContextContract(store);
    await store.write((tx) =>
      tx.instagramContext.fillReplies({ ...prior, replies: incomplete }),
    );
    const writer = new InstagramContextWriter(store),
      runId = 'generated-conflict',
      at = prior.confirmedAt,
      attemptId = `${runId}-attempt`;
    await writer.startRun({
      runId,
      accountKey: prior.accountKey,
      planHash: 'b'.repeat(64),
      startedAt: at,
    });
    await writer.sending({
      runId,
      attemptId,
      itemId: prior.itemId,
      at,
      refreshReplies: true,
    });
    expect(
      await writer.fillReplies(
        attemptId,
        { ...replacement, entries: replacement.entries.slice(1) },
        at,
      ),
    ).toBe('reply-set-conflict');
    expect(
      (await store.read((tx) => tx.instagramContext.get(prior.itemId)))
        ?.replies,
    ).toEqual(incomplete);
    const settled = [] as { state: string; code: string | null }[];
    await store.read(async (tx) => {
      for await (const attempt of tx.browserAttempts.iterate())
        if (attempt.settles === attemptId) settled.push(attempt);
    });
    expect(settled).toMatchObject([
      { state: 'failed', code: 'reply-set-conflict' },
    ]);
  } finally {
    await store.close();
  }
});
