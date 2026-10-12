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
import { finalNotice, finalNoticeText } from './final-notice.ts';
const at = FIXTURE.now;

// Public X notice wording, not a real export. Observed on 2026-10-12:
// https://github.com/prinsss/twitter-web-exporter/blob/ddf2b0c823680b904daae166f3eb05b81950ce7e/src/types/tweet.ts#L44-L47
const noticeFixture = {
  rows: [
    { id: '910', text: 'This Post was deleted by the Post author. Learn more' },
    { id: '911', text: 'This Post is from a suspended account. Learn more' },
    {
      id: '912',
      text: 'This Post is from an account that no longer exists. Learn more',
    },
    {
      id: '913',
      text: 'You’re unable to view this Post because this account owner limits who can view their Posts. Learn more',
    },
    { id: '914', text: '' },
    { id: '915', text: undefined },
  ],
  planned: ['915', '914', '913'],
  included: ['915', '914', '913', '912', '911', '910'],
  finalNotices: { deleted: 1, suspended: 1, accountGone: 1 },
};

function noticeWorkspace() {
  const data = fixtureWorkspace();
  data.items.forEach((item, index) => {
    item.reference.replyToId = noticeFixture.rows[index]!.id;
  });
  data.originals = noticeFixture.rows.map(({ id, text }) =>
    migrateOriginal({
      id,
      status: 'tombstone',
      fetchedAt: at,
      text: null,
      authorName: null,
      authorHandle: null,
      photos: [],
      quotedId: null,
      parentId: null,
      raw: {
        __typename: 'TweetTombstone',
        tombstone: { text: text === undefined ? {} : { text } },
      },
      textCompleteness: 'unknown',
      video: null,
    }),
  );
  data.counts.originals = data.originals.length;
  return data;
}

test('final tombstone notices skip all three kinds, retain unknown/empty/missing, and --include forces each back', async () => {
  const store = createMemoryStore(new MemoryStoreBacking(noticeWorkspace()));
  try {
    const plan = await planFill(store, FIXTURE.account.key);
    expect(plan.rows.map((row) => row.id)).toEqual(noticeFixture.planned);
    expect(fillSummary(plan)).toMatchObject({
      planned: 3,
      finalNotices: noticeFixture.finalNotices,
      reasons: { unseen: 3, 'long-text': 0, media: 0 },
    });
    const included = await planFill(
      store,
      FIXTURE.account.key,
      new Set(['910', '911', '912']),
    );
    expect(included.rows.map((row) => row.id)).toEqual(noticeFixture.included);
    expect(fillSummary(included)).toMatchObject({
      planned: 6,
      finalNotices: { deleted: 0, suspended: 0, accountGone: 0 },
    });
    await store.write(async (tx) => {
      const value = (await tx.originals.get('910'))!;
      await tx.originals.put({
        ...value,
        raw: {
          __typename: 'TweetTombstone',
          tombstone: { text: { text: noticeFixture.rows[1]!.text } },
        },
      });
    });
    expect((await planFill(store, FIXTURE.account.key)).hash).toBe(plan.hash);
  } finally {
    await store.close();
  }
});

test('final notice recognition matches whole public English sentences, case-insensitively, and never guesses a changed notice', () => {
  for (const [index, expected] of [
    'deleted',
    'suspended',
    'accountGone',
  ].entries()) {
    const text = noticeFixture.rows[index]!.text!;
    const body = {
      __typename: 'TweetTombstone',
      tombstone: { text: { text } },
    };
    expect(finalNotice(body)).toBe(expected);
    expect(
      finalNotice({
        ...body,
        tombstone: { text: { text: text.toUpperCase() } },
      }),
    ).toBe(expected);
    expect(
      finalNotice({
        ...body,
        tombstone: { richText: { text: text.replace('. Learn more', '.') } },
      }),
    ).toBe(expected);
    expect(
      finalNotice({
        ...body,
        tombstone: { text: { text: text.replace('. Learn more', '') } },
      }),
    ).toBe(expected);
    expect(
      finalNotice({
        ...body,
        tombstone: { text: { text: `Generated example: ${text}` } },
      }),
    ).toBeNull();
    expect(
      finalNotice({
        ...body,
        tombstone: { text: { text: `${text} Try again later.` } },
      }),
    ).toBeNull();
    expect(finalNotice({ ...body, __typename: 'Tweet', text })).toBeNull();
  }
  for (const text of [
    '',
    ' ',
    'This Post is unavailable.',
    'This post has not been deleted by the author.',
    'This Post is from an account that is not suspended.',
    'This Post is from an account that no longer exists temporarily.',
    noticeFixture.rows[3]!.text,
  ])
    expect(
      finalNotice({
        __typename: 'TweetTombstone',
        tombstone: { text: { text } },
      }),
    ).toBeNull();
  for (const answer of [
    null,
    {},
    { __typename: 'TweetTombstone' },
    { __typename: 'TweetTombstone', tombstone: { text: { text: 42 } } },
  ])
    expect(finalNotice(answer)).toBeNull();
});

test('dry-run JSON and bilingual human reply count skipped notices without writes, and --include files restore them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-final-notices-'));
  const db = join(directory, 'socialprune.sqlite');
  const store = await SQLiteStore.open(db, { initial: noticeWorkspace() });
  await store.close();
  const digest = async () =>
    createHash('sha256')
      .update(await readFile(db))
      .digest('hex');
  const before = await digest();
  const recorder = networkRecorder();
  try {
    for (const lang of ['en', 'de'] as const) {
      const stdout: string[] = [];
      const context = createNodeContext(
        { write: (text) => stdout.push(text) },
        { write: () => {} },
      );
      const args = [
        'originals',
        'fill',
        'x',
        '--workspace',
        directory,
        '--account',
        FIXTURE.account.key,
        '--dry-run',
        '--lang',
        lang,
      ];
      expect(await executeCli([...args, '--json'], context)).toBe(0);
      const envelope = JSON.parse(stdout.join('')) as {
        data: {
          planned: number;
          finalNotices: typeof noticeFixture.finalNotices;
        };
      };
      expect(envelope.data).toMatchObject({
        planned: 3,
        finalNotices: noticeFixture.finalNotices,
      });
      stdout.length = 0;
      expect(await executeCli(args, context)).toBe(0);
      expect(stdout.join('')).toContain(
        finalNoticeText(noticeFixture.finalNotices, lang),
      );
      expect(stdout.join('')).not.toContain(noticeFixture.rows[0]!.text);
    }
    const includePath = join(directory, 'generated-include.txt');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(includePath, '910\n911\n912\n');
    const stdout: string[] = [];
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
          '--include',
          includePath,
        ],
        createNodeContext(
          { write: (text) => stdout.push(text) },
          { write: () => {} },
        ),
      ),
    ).toBe(0);
    const envelope = JSON.parse(stdout.join('')) as {
      data: {
        planned: number;
        finalNotices: typeof noticeFixture.finalNotices;
      };
    };
    expect(envelope.data).toMatchObject({
      planned: 6,
      finalNotices: { deleted: 0, suspended: 0, accountGone: 0 },
    });
    expect(recorder.calls).toEqual([]);
    expect(await digest()).toBe(before);
  } finally {
    recorder.restore();
    await rm(directory, { recursive: true, force: true });
  }
});

test('only the latest anonymous tombstone suppresses unseen; other gaps and status changes remain planned', async () => {
  const data = noticeWorkspace();
  data.originals![0]!.textCompleteness = 'truncated';
  data.originals![1]!.anonymous = { status: 'not-found', at };
  const store = createMemoryStore(new MemoryStoreBacking(data));
  try {
    const plan = await planFill(store, FIXTURE.account.key);
    expect(plan.rows.find((row) => row.id === '910')?.reasons).toEqual([
      'long-text',
    ]);
    expect(plan.rows.find((row) => row.id === '911')?.reasons).toEqual([
      'unseen',
    ]);
    expect(plan.finalNotices).toEqual({
      deleted: 0,
      suspended: 0,
      accountGone: 1,
    });
  } finally {
    await store.close();
  }
});
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
