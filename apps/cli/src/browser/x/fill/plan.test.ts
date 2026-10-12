import { test, expect } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { migrateOriginal } from '@socialprune/core';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '@socialprune/core/workspace/memory-store';
import { fixtureWorkspace, FIXTURE } from '../../../../e2e/fake-x/fixture.ts';
import { planFill, fillSummary, fillList, FILL_WARNING } from './plan.ts';
import { fileURLToPath } from 'node:url';
import { executeCli } from '../../../cli/adapter.ts';
import { createNodeContext } from '../../../cli/node-context.ts';
import { SQLiteStore } from '../../../workspace/sqlite-store.ts';
import { planDeletion } from '../../plan.ts';
import { networkRecorder } from '../../../cli/test/network-recorder.ts';
import { FILL_PACE } from './run.ts';
const at = FIXTURE.now;
test('fill-specific warning exactly matches ADR-029 in both languages before a person starts reading', async () => {
  const text = await readFile(
    fileURLToPath(
      new URL(
        '../../../../../../docs/architecture/adrs/ADR-029-signed-in-originals-pass.md',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  for (const warning of Object.values(FILL_WARNING))
    expect(text).toContain('> ' + warning);
});
test('production signed-in page pace is pinned and has no CLI or environment override', () => {
  expect(FILL_PACE).toEqual({
    intervalMs: 30000,
    batch: 20,
    pauseMs: 900000,
    perDay: 200,
  });
  expect(Object.isFrozen(FILL_PACE)).toBe(true);
});
test('fill plan uses two human-independent reasons and media gap, ID order and canonical hash; readonly CLI has no network or writes', async () => {
  const data = fixtureWorkspace(['1001', '1002', '1003']);
  const refs = ['910', '911', '912'];
  data.items.forEach((item, i) => {
    item.reference.replyToId = refs[i]!;
  });
  data.originals = refs.map((id, index) =>
    migrateOriginal({
      id,
      status: index === 0 ? 'not-found' : 'fetched',
      fetchedAt: at,
      text: index === 0 ? null : 'Generated beginnings',
      authorName: null,
      authorHandle: null,
      photos: [],
      quotedId: null,
      parentId: null,
      raw: index === 1 ? { note_tweet: {} } : null,
      textCompleteness: 'unknown',
      video: index === 2 ? 'not-stored' : null,
    }),
  );
  data.counts.originals = 3;
  const store = createMemoryStore(new MemoryStoreBacking(data));
  try {
    const plan = await planFill(store, FIXTURE.account.key);
    expect(
      plan.rows.map((row) => ({ id: row.id, reasons: row.reasons })),
    ).toEqual([
      { id: '912', reasons: ['media'] },
      { id: '911', reasons: ['long-text'] },
      { id: '910', reasons: ['unseen'] },
    ]);
    expect(fillSummary(plan)).toMatchObject({
      planned: 3,
      unseenOnly: 1,
      reasons: { unseen: 1, 'long-text': 1, media: 1 },
    });
    expect(fillList(plan)).toContain('910\tunseen');
  } finally {
    await store.close();
  }
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-fill-plan-')),
    db = join(directory, 'socialprune.sqlite'),
    record = networkRecorder();
  try {
    const store = await SQLiteStore.open(db, { initial: data });
    await store.close();
    const digest = async () =>
        createHash('sha256')
          .update(await readFile(db))
          .digest('hex'),
      before = await digest();
    const stdout: string[] = [],
      stderr: string[] = [];
    expect(
      await executeCli(
        [
          'originals',
          'fill',
          'x',
          '--workspace',
          directory,
          '--account',
          FIXTURE.account.key,
          '--dry-run',
          '--json',
        ],
        createNodeContext(
          { write: (text) => stdout.push(text) },
          { write: (text) => stderr.push(text) },
        ),
      ),
    ).toBe(0);
    const value = JSON.parse(stdout.join('')) as { data: { planned: number } };
    expect(value.data.planned).toBe(3);
    expect(stdout.join('')).not.toContain('Generated beginnings');
    expect(record.calls).toEqual([]);
    expect(await digest()).toBe(before);
    stdout.length = 0;
    expect(
      await executeCli(
        [
          'originals',
          'fill',
          'x',
          '--workspace',
          directory,
          '--account',
          FIXTURE.account.key,
          '--profile',
          'generated-decoy',
          '--plan',
          'generated',
        ],
        createNodeContext(
          { write: (text) => stdout.push(text) },
          { write: () => {} },
        ),
      ),
    ).toBe(2);
    expect(stdout.join('')).toContain('NOT_INTERACTIVE');
    expect(record.calls).toEqual([]);
    expect(await digest()).toBe(before);
  } finally {
    record.restore();
    await rm(directory, { recursive: true, force: true });
  }
});
test('delete run rejects pending originals before browser lookup; explicit override reaches profile validation without a browser', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'socialprune-originals-pending-'),
  );
  const data = fixtureWorkspace(['1001']);
  data.items[0]!.kind = 'reply';
  data.items[0]!.reference.replyToId = '910';
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: data,
  });
  const plan = await planDeletion(store, FIXTURE.account.key);
  await store.close();
  try {
    for (const override of [false, true]) {
      const stdout: string[] = [];
      const context = createNodeContext(
        { write: (text) => stdout.push(text) },
        { write: () => {} },
      );
      const result = await executeCli(
        [
          'delete',
          'x',
          '--workspace',
          directory,
          '--account',
          FIXTURE.account.key,
          '--profile',
          join(directory, 'decoy'),
          '--plan',
          plan.hash,
          '--without-originals=' + String(override),
        ],
        { ...context, stdoutIsTerminal: true },
      );
      expect(result).toBe(2);
      expect(stdout.join('')).toContain(
        override ? 'PROFILE_INVALID' : 'ORIGINALS_PENDING',
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('accepted canary survives shuffled store order, shape drift returns to canary, failed anonymous and own posts are excluded', async () => {
  const data = fixtureWorkspace(['1001', '1002']);
  data.decisionEvents.forEach((event) => {
    event.action = {
      ...event.action,
      kind: 'single',
      size: 1,
      id: event.eventId,
    };
  });
  data.items[0]!.reference.replyToId = '910';
  data.items[1]!.reference.replyToId = '911';
  data.originals = ['910', '911'].map((id, i) =>
    migrateOriginal({
      id,
      status: i ? 'failed' : 'fetched',
      fetchedAt: at,
      text: 'Generated',
      authorName: null,
      authorHandle: null,
      photos: [],
      quotedId: null,
      parentId: null,
      raw: { note_tweet: {} },
      textCompleteness: 'truncated',
      video: null,
    }),
  );
  data.counts.originals = 2;
  const source = createMemoryStore(new MemoryStoreBacking(data));
  try {
    const run = {
      runId: 'z-accepted',
      platform: 'x' as const,
      accountKey: FIXTURE.account.key,
      mode: 'fill' as const,
      planHash: 'a'.repeat(64),
      startedAt: at,
      endedAt: at,
      endReason: 'canary' as const,
      bodyShapes: { 'read-post': ['generated-path'] },
      profileReport: null,
      canaryAcceptedAt: at,
    };
    await source.write(async (tx) => tx.browserRuns.add(run));
    expect(await planFill(source, FIXTURE.account.key)).toMatchObject({
      canary: false,
      bodyShapes: { 'read-post': ['generated-path'] },
    });
    expect(
      (await planFill(source, FIXTURE.account.key)).rows.map((row) => row.id),
    ).toEqual(['910']);
    await source.write(async (tx) =>
      tx.browserRuns.add({
        ...run,
        runId: 'a-later',
        startedAt: '2026-10-13T00:00:00.000Z',
        endedAt: '2026-10-13T00:00:00.000Z',
        endReason: 'shape-changed',
        canaryAcceptedAt: null,
      }),
    );
    expect((await planFill(source, FIXTURE.account.key)).canary).toBe(true);
  } finally {
    await source.close();
  }
});
