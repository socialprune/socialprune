import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { InstagramContextWriter } from '@socialprune/core/workspace/instagram-context-writer';
import { instagramContractRecord } from '@socialprune/core/workspace/store-contract';
import {
  instagramFixture,
  IG_FIXTURE,
} from '../../e2e/fake-instagram/fixture.ts';
import { SQLiteStore } from './sqlite-store.ts';

async function auditFixture(confirmed = 5, skipped = 10, extra = 0, mode = '') {
  const directory = await mkdtemp(join(tmpdir(), 'sp-c8-audit-')),
    fixture = await instagramFixture(confirmed + skipped + extra),
    store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
      initial: fixture.workspace,
    }),
    writer = new InstagramContextWriter(store),
    journal = store.browserOutcomeWriter(),
    runId = 'generated-c8-audit';
  const profileReport = {
    accountBefore: fixture.items[0]!.account.handle,
    accountAfter: fixture.items[0]!.account.handle,
    extensionsBefore: 0,
    extensionsAfter: 0,
    changedFiles: [],
    unexpectedRequests: [],
  };
  await writer.startRun({
    runId,
    accountKey: fixture.items[0]!.account.key,
    planHash: 'a'.repeat(64),
    startedAt: IG_FIXTURE.now,
  });
  await journal.recordContextOrder(runId, 'b'.repeat(64));
  const itemIds: string[] = [];
  for (const [index, item] of fixture.items.entries()) {
    const attemptId = `generated-c8-send-${index}`;
    await writer.sending({
      runId,
      attemptId,
      itemId: item.id,
      at: IG_FIXTURE.now,
    });
    if (index < skipped)
      await writer.settle({
        attemptId,
        at: IG_FIXTURE.now,
        state:
          mode === 'failed' && index === 0
            ? 'failed'
            : index % 2
              ? 'unavailable'
              : 'unconfirmed',
        code: index === 0 && mode ? mode : index % 2 ? null : 'not-shown',
      });
    else if (index < skipped + confirmed) {
      const record = instagramContractRecord(item);
      await writer.confirm({
        ...record,
        runId,
        attemptId,
        confirmedAt: IG_FIXTURE.now,
        comment: {
          ...record.comment,
          id: String(910001 + index),
          createdAt: item.createdAt,
        },
      });
      itemIds.push(item.id);
    }
  }
  const counts = {
    commentsConfirmed: confirmed,
    fields: Object.fromEntries(
      ['owner', 'time', 'caption', 'image'].map((field) => [
        field,
        { compared: confirmed, agreed: confirmed },
      ]),
    ),
    imagesMatched: confirmed,
    screenshotsStored: confirmed,
    unexpectedActions: 0,
    extensionIdsAdded: 0,
    extensionIdsRemoved: 0,
  };
  return {
    store,
    fixture,
    counts,
    itemIds,
    profileReport,
    runId,
    accept: () =>
      journal.recordContextAudit(runId, counts, undefined, true, {
        at: IG_FIXTURE.now,
        itemIds,
        profileReport,
      }),
    async close() {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('C8 journal atomically accepts five checked records after ten skips, with counts only', async () => {
  const h = await auditFixture();
  try {
    await h.accept();
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(run).toMatchObject({
      canaryAcceptedAt: IG_FIXTURE.now,
      acceptedBy: 'automatic-check',
      endReason: 'canary',
      canaryCounts: h.counts,
    });
    const text = JSON.stringify(run);
    for (const value of Object.values(IG_FIXTURE.other))
      expect(text).not.toContain(value);
    expect(text).not.toContain(h.fixture.items[0]!.text);
    await expect(h.accept()).rejects.toMatchObject({
      code: 'CANARY_CHECK_FAILED',
    });
  } finally {
    await h.close();
  }
});

test.each([
  ['four confirmed and eleven skipped', 4, 11, 0, ''],
  ['sixteen sends', 5, 11, 0, ''],
  ['sending', 5, 9, 1, ''],
  ['failed', 5, 10, 0, 'failed'],
  ['owner', 5, 10, 0, 'owner'],
  ['time', 5, 10, 0, 'time'],
  ['text', 5, 10, 0, 'text'],
  ['several', 5, 10, 0, 'several'],
  ['short sample', 4, 0, 0, ''],
] as const)(
  'C8 journal refuses %s and rolls back acceptance',
  async (_name, confirmed, skipped, extra, mode) => {
    const h = await auditFixture(confirmed, skipped, extra, mode);
    try {
      const before = await h.store.browserJournal();
      await expect(h.accept()).rejects.toMatchObject({
        code: 'CANARY_CHECK_FAILED',
      });
      expect(await h.store.browserJournal()).toEqual(before);
      expect(before.runs[0]!.canaryAcceptedAt).toBeNull();
      expect(before.runs[0]!.acceptedBy).toBeUndefined();
    } finally {
      await h.close();
    }
  },
);

test.each([
  'missing-record',
  'missing-check',
  'bad-check',
  'image',
  'screenshot',
] as const)(
  'C8 journal refuses %s even with five confirmed settlements',
  async (mode) => {
    const h = await auditFixture(5, 0);
    try {
      if (mode === 'missing-record') {
        const original = h.store.write.bind(h.store);
        h.store.write = (operation) =>
          original((tx) =>
            operation({
              ...tx,
              instagramContext: {
                ...tx.instagramContext,
                get: (id) =>
                  id === h.itemIds[0]
                    ? Promise.resolve(undefined)
                    : tx.instagramContext.get(id),
              },
            }),
          );
      } else if (mode === 'missing-check') h.itemIds.pop();
      else if (mode === 'bad-check') h.counts.fields.owner!.agreed--;
      else if (mode === 'image') h.counts.imagesMatched--;
      else h.counts.screenshotsStored--;
      await expect(h.accept()).rejects.toMatchObject({
        code: 'CANARY_CHECK_FAILED',
      });
      expect((await h.store.browserJournal()).runs[0]).toMatchObject({
        endedAt: null,
        canaryAcceptedAt: null,
      });
    } finally {
      await h.close();
    }
  },
);
