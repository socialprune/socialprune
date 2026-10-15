import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { instagramFixture } from '../../../e2e/fake-instagram/fixture.ts';
import { SQLiteStore } from '../../workspace/sqlite-store.ts';
import { planContext, normalize, canaryRows } from './plan.ts';
import { InstagramContextWriter } from '@socialprune/core/workspace/instagram-context-writer';

test('manual reasons and include cannot plan empty, ownerless or close twins; marked status changes the canonical hash', async () => {
  const fixture = await instagramFixture(6),
    directory = await mkdtemp(join(tmpdir(), 'sp-ig-plan-'));
  fixture.workspace.items[1]!.text = ' \n ';
  fixture.workspace.items[2]!.reference.ownerHandle = null;
  fixture.workspace.items[3]!.text = fixture.workspace.items[0]!.text;
  fixture.workspace.items[3]!.createdAt = new Date(
    Date.parse(fixture.workspace.items[0]!.createdAt) + 120000,
  ).toISOString();
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: fixture.workspace,
  });
  try {
    const plan = await planContext(
      store,
      fixture.items[0]!.account.key,
      new Set(fixture.items.map((item) => item.id)),
    );
    expect(plan.manual).toEqual({ emptyText: 1, noOwner: 1, closeTwin: 2 });
    expect(plan.rows.map(({ item }) => item.id)).toEqual(
      fixture.items.slice(4).map((item) => item.id),
    );
    const before = plan.hash,
      itemId = fixture.items[5]!.id;
    await store.write(async (tx) => {
      const runtime = await tx.runtime.get(),
        state = (await tx.state.get(itemId))!;
      await tx.decisionEvents.append([
        {
          eventId: 'generated-human-mark',
          seq: runtime.lastEventSeq + 1,
          itemId,
          value: 'delete',
          previous: 'undecided',
          decidedAt: '2026-10-15T12:00:00.000Z',
          source: { kind: 'human', via: 'local-review' },
          action: {
            id: 'generated-mark',
            kind: 'single',
            size: 1,
            reverts: null,
          },
        },
      ]);
      await tx.state.put({ ...state, decision: 'delete' });
      await tx.runtime.set({
        ...runtime,
        revision: runtime.revision + 1,
        lastEventSeq: runtime.lastEventSeq + 1,
      });
    });
    const after = await planContext(store, plan.accountKey);
    expect(after.hash).not.toBe(before);
    expect(after.rows[0]!.item.id).toBe(itemId);
    expect(canaryRows(after)[0]!.item.id).toBe(fixture.items[4]!.id);
    expect(normalize('e\u0301 \n moss')).toBe('é moss');
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('earlier results require explicit include; include cannot restore confirmed records or manual entries', async () => {
  const fixture = await instagramFixture(4),
    directory = await mkdtemp(join(tmpdir(), 'sp-ig-include-'));
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: fixture.workspace,
  });
  try {
    const plan = await planContext(store, fixture.items[0]!.account.key),
      writer = new InstagramContextWriter(store);
    await writer.startRun({
      runId: 'generated-results',
      accountKey: plan.accountKey,
      planHash: plan.hash,
      startedAt: '2026-10-14T12:00:00.000Z',
    });
    for (const [index, state] of (
      ['unconfirmed', 'not-listed', 'unavailable'] as const
    ).entries()) {
      await writer.sending({
        runId: 'generated-results',
        attemptId: `generated-attempt-${index}`,
        itemId: fixture.items[index]!.id,
        at: '2026-10-14T12:00:00.000Z',
      });
      await writer.settle({
        attemptId: `generated-attempt-${index}`,
        state,
        code:
          state === 'unconfirmed'
            ? 'time'
            : state === 'not-listed'
              ? 'no-row'
              : null,
        at: '2026-10-14T12:00:00.000Z',
      });
    }
    await writer.endRun({
      runId: 'generated-results',
      endedAt: '2026-10-14T12:00:00.000Z',
      endReason: 'canary',
      bodyShapes: {},
      profileReport: {
        accountBefore: plan.handle,
        accountAfter: plan.handle,
        extensionsBefore: 0,
        extensionsAfter: 0,
        changedFiles: [],
        unexpectedRequests: [],
      },
    });
    const excluded = await planContext(store, plan.accountKey);
    expect(excluded.excluded).toEqual({
      unconfirmed: 1,
      'not-listed': 1,
      unavailable: 1,
    });
    expect(excluded.rows).toHaveLength(1);
    const restored = await planContext(
      store,
      plan.accountKey,
      new Set(fixture.items.map((item) => item.id)),
    );
    expect(restored.rows).toHaveLength(4);
    expect(restored.excluded).toEqual({
      unconfirmed: 0,
      'not-listed': 0,
      unavailable: 0,
    });
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
