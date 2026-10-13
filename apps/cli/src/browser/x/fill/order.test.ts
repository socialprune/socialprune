import { expect, test } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as orderModule from './order.ts';
import { executeCli } from '../../../cli/adapter.ts';
import { createNodeContext } from '../../../cli/node-context.ts';
import { SQLiteStore } from '../../../workspace/sqlite-store.ts';
import { fixtureWorkspace, FIXTURE } from '../../../../e2e/fake-x/fixture.ts';
import { planFill } from './plan.ts';
import { networkRecorder } from '../../../cli/test/network-recorder.ts';
import { OriginalsFillWriter } from '@socialprune/core/workspace/store';
import { migrateOriginal } from '@socialprune/core';
const generated = {
  scope: 'originals-fill-x',
  account: 'generated_account',
  givenAt: '2026-10-13T12:00:00.000Z',
  words:
    'Read the originals of my replies and quotes in this dedicated profile.',
  maxPages: 5,
};
test('written order validates exact scope effective account and unchanged plan before any browser launch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-order-'));
  try {
    const file = join(directory, 'order.json');
    await writeFile(file, JSON.stringify(generated));
    const read = await orderModule.readOrder(
      file,
      'GENERATED_ACCOUNT',
      'a'.repeat(64),
      'a'.repeat(64),
    );
    expect(read.value).toEqual(generated);
    expect(read.sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const defect of [
      { ...generated, scope: 'delete-x' },
      { ...generated, account: 'foreign_account' },
      { ...generated, givenAt: 'invalid' },
      { ...generated, maxPages: 201 },
      { ...generated, words: '' },
      { ...generated, extra: true },
    ]) {
      await writeFile(file, JSON.stringify(defect));
      await expect(
        orderModule.readOrder(
          file,
          'generated_account',
          'a'.repeat(64),
          'a'.repeat(64),
        ),
      ).rejects.toMatchObject({ code: 'ORDER_INVALID' });
    }
    await writeFile(file, JSON.stringify(generated));
    await expect(
      orderModule.readOrder(
        file,
        'generated_account',
        'a'.repeat(64),
        'b'.repeat(64),
      ),
    ).rejects.toMatchObject({ code: 'STALE_PLAN' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('CLI refuses a wrong order scope or account and stale plan before profile or browser access even with piped stdout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-order-cli-')),
    store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
      initial: fixtureWorkspace(['1001']),
    });
  const plan = await planFill(store, FIXTURE.account.key);
  await store.close();
  const file = join(directory, 'order.json'),
    record = networkRecorder();
  try {
    for (const [value, hash, expected] of [
      [{ ...generated, scope: 'delete-x' }, plan.hash, 'ORDER_INVALID'],
      [
        { ...generated, account: 'foreign_account' },
        plan.hash,
        'ORDER_INVALID',
      ],
      [
        { ...generated, account: FIXTURE.account.handle },
        'b'.repeat(64),
        'STALE_PLAN',
      ],
    ] as const) {
      await writeFile(file, JSON.stringify(value));
      const output: string[] = [];
      const code = await executeCli(
        [
          'originals',
          'fill',
          'x',
          '--workspace',
          directory,
          '--account',
          FIXTURE.account.key,
          '--profile',
          join(directory, 'never-open-profile'),
          '--plan',
          hash,
          '--order',
          file,
          '--json',
        ],
        createNodeContext(
          { write: (text) => output.push(text) },
          { write: () => {} },
        ),
      );
      expect(code).toBe(expected === 'STALE_PLAN' ? 1 : 2);
      expect(output.join('')).toContain(expected);
    }
    expect(record.calls).toEqual([]);
  } finally {
    record.restore();
    await rm(directory, { recursive: true, force: true });
  }
});
test('automatic acceptance is atomic with its CLI order audit and rejects unmatched counts without touching human decisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-order-audit-')),
    workspace = fixtureWorkspace(['1001']);
  workspace.originals = [
    migrateOriginal({
      id: '910',
      status: 'fetched',
      fetchedAt: FIXTURE.now,
      text: 'Generated',
      authorName: null,
      authorHandle: null,
      photos: [],
      quotedId: null,
      parentId: null,
      raw: null,
      textCompleteness: 'unknown',
      video: null,
    }),
  ];
  workspace.counts.originals = 1;
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: workspace,
  });
  try {
    const writer = new OriginalsFillWriter(store),
      audit = store.browserOutcomeWriter();
    await writer.startRun({
      runId: 'generated-ordered',
      accountKey: FIXTURE.account.key,
      planHash: 'a'.repeat(64),
      canary: true,
      startedAt: FIXTURE.now,
    });
    await audit.recordOrder('generated-ordered', 'c'.repeat(64));
    await writer.sending({
      attemptId: 'generated-read',
      runId: 'generated-ordered',
      originalId: '910',
      at: FIXTURE.now,
    });
    await writer.settle(
      {
        attemptId: 'generated-read',
        state: 'not-found',
        at: FIXTURE.now,
        code: null,
      },
      [
        {
          ...workspace.originals[0]!,
          signedIn: {
            status: 'not-found',
            at: FIXTURE.now,
            runId: 'generated-ordered',
            attemptId: 'generated-read',
            reason: null,
          },
        },
      ],
    );
    await writer.endRun({
      runId: 'generated-ordered',
      endedAt: FIXTURE.now,
      endReason: 'canary',
      bodyShapes: {},
      profileReport: {
        accountBefore: FIXTURE.account.handle,
        accountAfter: FIXTURE.account.handle,
        extensionsBefore: 0,
        extensionsAfter: 0,
        changedFiles: [],
        unexpectedRequests: [],
      },
    });
    const counts = {
      stored: { textLength: 0, photos: 0, videos: 0 },
      shown: { textLength: 1, photos: 0, videos: 0 },
      matches: false,
    };
    await expect(
      audit.recordAutomaticAcceptance('generated-ordered', FIXTURE.now, [
        counts,
      ]),
    ).rejects.toMatchObject({ code: 'CANARY_MISMATCH' });
    expect((await store.browserJournal()).runs[0]).toMatchObject({
      canaryAcceptedAt: null,
      startedBy: 'agent-on-order',
      orderSha256: 'c'.repeat(64),
    });
    await audit.recordAutomaticAcceptance('generated-ordered', FIXTURE.now, [
      { ...counts, shown: { ...counts.stored }, matches: true },
    ]);
    expect((await store.browserJournal()).runs[0]).toMatchObject({
      canaryAcceptedAt: FIXTURE.now,
      acceptedBy: 'automatic-check',
    });
    await writer.startRun({
      runId: 'generated-next',
      accountKey: FIXTURE.account.key,
      planHash: 'd'.repeat(64),
      canary: false,
      startedAt: FIXTURE.now,
    });
    expect(
      (await store.browserJournal()).runs.find(
        (run) => run.runId === 'generated-ordered',
      ),
    ).toMatchObject({
      startedBy: 'agent-on-order',
      acceptedBy: 'automatic-check',
    });
    await expect(
      audit.recordAutomaticAcceptance('generated-ordered', FIXTURE.now, [
        { ...counts, shown: { ...counts.stored }, matches: true },
      ]),
    ).rejects.toThrow();
    expect(
      await store.read(async (tx) => {
        const entries = [];
        for await (const event of tx.decisionEvents.iterate())
          entries.push(event);
        return entries;
      }),
    ).toEqual(workspace.decisionEvents);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
