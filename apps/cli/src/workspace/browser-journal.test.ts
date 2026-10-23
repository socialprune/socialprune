import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import {
  OriginalsFillWriter,
  records,
} from '@socialprune/core/workspace/store';
import { fixtureWorkspace, FIXTURE } from '../../e2e/fake-x/fixture.ts';
import { planDeletion } from '../browser/plan.ts';
import { migrateOriginal } from '@socialprune/core';
import { InstagramContextWriter } from '@socialprune/core/workspace/instagram-context-writer';
import { instagramContractRecord } from '@socialprune/core/workspace/store-contract';
import {
  instagramFixture,
  IG_FIXTURE,
} from '../../e2e/fake-instagram/fixture.ts';
import { SQLiteStore } from './sqlite-store.ts';

test.each(['delete', 'verify'] as const)(
  'D2 %s starts after a positively dead fill run and preserves the read identity',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'sp-d2-recovery-'));
    const store = await SQLiteStore.open(
      join(directory, 'socialprune.sqlite'),
      { initial: fixtureWorkspace(['1001']) },
    );
    const fill = new OriginalsFillWriter(store);
    await store.write((tx) =>
      tx.originals.put(
        migrateOriginal({
          id: '900001',
          status: 'not-found',
          fetchedAt: FIXTURE.now,
          text: null,
          authorName: null,
          authorHandle: null,
          photos: [],
          quotedId: null,
          parentId: null,
          raw: null,
          textCompleteness: 'unknown',
          video: null,
        }),
      ),
    );
    await fill.startRun({
      runId: 'dead-fill',
      accountKey: FIXTURE.account.key,
      planHash: 'a'.repeat(64),
      canary: false,
      startedAt: FIXTURE.now,
      ownerPid: 2147483647,
    });
    await fill.sending({
      runId: 'dead-fill',
      attemptId: 'dead-read',
      originalId: '900001',
      at: FIXTURE.now,
    });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Generated dead process'), {
        code: 'ESRCH',
      });
    });
    try {
      const writer = store.browserOutcomeWriter();
      await writer.begin({
        runId: `new-${mode}`,
        platform: 'x',
        accountKey: FIXTURE.account.key,
        mode,
        planHash: mode === 'verify' ? null : 'b'.repeat(64),
        startedAt: FIXTURE.now,
        endedAt: null,
        endReason: null,
        bodyShapes: {},
        profileReport: null,
        ownerPid: process.pid,
      });
      expect(kill).toHaveBeenCalledWith(2147483647, 0);
      expect(
        (await store.read((tx) => records(tx.browserRuns))).map((run) => ({
          id: run.runId,
          end: run.endReason,
        })),
      ).toEqual([
        { id: 'dead-fill', end: 'error' },
        { id: `new-${mode}`, end: null },
      ]);
      expect(
        (await store.read((tx) => records(tx.browserAttempts))).at(-1),
      ).toMatchObject({
        runId: 'dead-fill',
        originalId: '900001',
        itemId: null,
        action: 'read-post',
        state: 'failed',
        settles: 'dead-read',
        code: 'INTERRUPTED',
      });
    } finally {
      kill.mockRestore();
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('D2 dead deletion recovery remains ambiguous and blocks inclusion; a live owner remains busy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-d2-delete-recovery-'));
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: fixtureWorkspace(['1001']),
  });
  const writer = store.browserOutcomeWriter();
  const run = {
    runId: 'dead-delete',
    platform: 'x' as const,
    accountKey: FIXTURE.account.key,
    mode: 'delete' as const,
    planHash: 'a'.repeat(64),
    startedAt: FIXTURE.now,
    endedAt: null,
    endReason: null,
    bodyShapes: {},
    profileReport: null,
    ownerPid: 2147483647,
  };
  try {
    await writer.begin(run);
    await writer.check(
      (await planDeletion(store, FIXTURE.account.key)).rows[0]!,
      run.runId,
      FIXTURE.now,
      true,
    );
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Generated dead process'), {
        code: 'ESRCH',
      });
    });
    try {
      await writer.begin({
        ...run,
        runId: 'new-verify',
        mode: 'verify',
        planHash: null,
        ownerPid: process.pid,
      });
    } finally {
      kill.mockRestore();
    }
    expect((await store.browserJournal()).attempts.at(-1)).toMatchObject({
      action: 'delete-post',
      state: 'ambiguous',
      code: 'PROCESS_LOST',
    });
    expect(
      (await planDeletion(store, FIXTURE.account.key, new Set(['x:1001'])))
        .rows,
    ).toEqual([]);
    await expect(
      writer.begin({ ...run, runId: 'contender' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('D2 fill recovers a dead deletion through the shared guard without losing its ambiguous receipt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-d2-fill-recovery-'));
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: fixtureWorkspace(['1001']),
  });
  const journal = store.browserOutcomeWriter();
  const run = {
    runId: 'dead-delete',
    platform: 'x' as const,
    accountKey: FIXTURE.account.key,
    mode: 'delete' as const,
    planHash: 'a'.repeat(64),
    startedAt: FIXTURE.now,
    endedAt: null,
    endReason: null,
    bodyShapes: {},
    profileReport: null,
    ownerPid: 2147483647,
  };
  try {
    await journal.begin(run);
    await journal.check(
      (await planDeletion(store, FIXTURE.account.key)).rows[0]!,
      run.runId,
      FIXTURE.now,
      true,
    );
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Generated dead owner'), { code: 'ESRCH' });
    });
    try {
      await journal.recover(FIXTURE.account.key, FIXTURE.now);
    } finally {
      kill.mockRestore();
    }
    await new OriginalsFillWriter(store).startRun({
      runId: 'new-fill',
      accountKey: FIXTURE.account.key,
      planHash: 'b'.repeat(64),
      canary: false,
      startedAt: FIXTURE.now,
      ownerPid: process.pid,
    });
    expect(
      (await store.read((tx) => records(tx.browserRuns))).map((value) => [
        value.mode,
        value.endReason,
      ]),
    ).toEqual([
      ['delete', 'error'],
      ['fill', null],
    ]);
    expect(
      (await store.read((tx) => records(tx.browserAttempts))).at(-1),
    ).toMatchObject({
      action: 'delete-post',
      state: 'ambiguous',
      code: 'PROCESS_LOST',
    });
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(['missing-owner', 'unknown-owner'] as const)(
  'D2 recovery refuses %s and leaves the journal unchanged',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'sp-d2-owner-recovery-'));
    const store = await SQLiteStore.open(
      join(directory, 'socialprune.sqlite'),
      { initial: fixtureWorkspace(['1001']) },
    );
    const writer = store.browserOutcomeWriter();
    const run = {
      runId: 'unproven-owner',
      platform: 'x' as const,
      accountKey: FIXTURE.account.key,
      mode: 'delete' as const,
      planHash: 'a'.repeat(64),
      startedAt: FIXTURE.now,
      endedAt: null,
      endReason: null,
      bodyShapes: {},
      profileReport: null,
      ...(mode === 'unknown-owner' ? { ownerPid: 2147483647 } : {}),
    };
    try {
      await writer.begin(run);
      const before = await store.browserJournal();
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('Generated ownership query refused'), {
          code: 'EPERM',
        });
      });
      try {
        await expect(
          writer.recover(FIXTURE.account.key, FIXTURE.now),
        ).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
      } finally {
        kill.mockRestore();
      }
      expect(await store.browserJournal()).toEqual(before);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

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
            : mode === 'not-listed' && index === 0
              ? 'not-listed'
              : mode === 'unavailable' && index === 0
                ? 'unavailable'
                : index % 2
                  ? 'unavailable'
                  : 'unconfirmed',
        code:
          index === 0 && mode
            ? mode === 'not-listed'
              ? 'no-row'
              : mode === 'unavailable'
                ? null
                : mode
            : index % 2
              ? null
              : 'not-shown',
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
  'owner',
  'time',
  'text',
  'several',
  'not-listed',
  'not-shown',
  'unavailable',
])('C9 journal accepts five checked records after skipped %s', async (code) => {
  const h = await auditFixture(5, 10, 0, code);
  try {
    await h.accept();
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(run).toMatchObject({
      canaryAcceptedAt: IG_FIXTURE.now,
      acceptedBy: 'automatic-check',
      endReason: 'canary',
      canaryCounts: h.counts,
    });
    for (const value of [
      ...Object.values(IG_FIXTURE.other),
      ...h.fixture.items.map((item) => item.text),
    ])
      expect(JSON.stringify(run)).not.toContain(value);
  } finally {
    await h.close();
  }
});

test.each([
  ['four confirmed and eleven skipped', 4, 11, 0, ''],
  ['sixteen sends', 5, 11, 0, ''],
  ['sending', 5, 9, 1, ''],
  ['failed', 5, 10, 0, 'failed'],
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
  'ambiguous',
  'missing-record',
  'missing-check',
  'bad-check',
  'image',
  'screenshot',
] as const)(
  'C8 journal refuses %s even with five confirmed settlements',
  async (mode) => {
    const h = await auditFixture(5, mode === 'ambiguous' ? 10 : 0);
    try {
      if (mode === 'missing-record' || mode === 'ambiguous') {
        const original = h.store.write.bind(h.store);
        h.store.write = (operation) =>
          original((tx) =>
            operation({
              ...tx,
              instagramContext: {
                ...tx.instagramContext,
                get: (id) =>
                  mode === 'missing-record' && id === h.itemIds[0]
                    ? Promise.resolve(undefined)
                    : tx.instagramContext.get(id),
              },
              browserAttempts: {
                ...tx.browserAttempts,
                async *iterate() {
                  for await (const attempt of tx.browserAttempts.iterate())
                    yield mode === 'ambiguous' &&
                    attempt.settles !== null &&
                    attempt.itemId === h.fixture.items[0]!.id
                      ? { ...attempt, state: 'ambiguous' }
                      : attempt;
                },
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
