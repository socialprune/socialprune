import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test, vi } from 'vitest';
import {
  instagramFixture,
  IG_FIXTURE,
} from '../../../e2e/fake-instagram/fixture.ts';
import { SQLiteStore } from '../../workspace/sqlite-store.ts';
import {
  planContext,
  normalize,
  canaryRows,
  contextSummary,
  contextList,
} from './plan.ts';
import { InstagramContextWriter } from '@socialprune/core/workspace/instagram-context-writer';
import { writeInstagramContextContract } from '@socialprune/core/workspace/store-contract';
import { executeCli } from '../../cli/adapter.ts';
import { createNodeContext } from '../../cli/node-context.ts';
import * as profiles from '../profile.ts';
import * as runner from './run.ts';

async function excludeFixture() {
  const fixture = await instagramFixture(6);
  const directory = await mkdtemp(join(tmpdir(), 'sp-ig-exclude-'));
  const path = join(directory, 'socialprune.sqlite');
  const store = await SQLiteStore.open(path, { initial: fixture.workspace });
  return {
    fixture,
    directory,
    path,
    store,
    accountKey: fixture.items[0]!.account.key,
    close: async () => {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function invokeContext(args: string[]) {
  const stdout: string[] = [],
    stderr: string[] = [];
  const context = {
    ...createNodeContext(
      { write: (text) => stdout.push(text) },
      { write: (text) => stderr.push(text) },
    ),
    stdoutIsTerminal: true,
  };
  const code = await executeCli(['context', 'instagram', ...args], context);
  return { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

test('REPLIES-1 refresh plan excludes observed empty replies and binds the CLI mode', async () => {
  const h = await excludeFixture();
  try {
    const record = await writeInstagramContextContract(
      h.store,
      h.fixture.items[0],
    );
    const plan = await planContext(
      h.store,
      h.accountKey,
      new Set(),
      new Set(),
      false,
      true,
    );
    expect(plan.rows.map((row) => row.item.id)).toEqual([record.itemId]);
    expect(plan.refreshReplies).toBe(true);
    expect(plan.canary).toBe(false);
    expect(plan.hash).not.toBe(
      (await planContext(h.store, h.accountKey, new Set(), new Set(), true))
        .hash,
    );
    await h.store.write((tx) =>
      tx.instagramContext.fillReplies({
        ...record,
        replies: { entries: [], moreCount: 0, capped: false },
      }),
    );
    expect(
      (
        await planContext(
          h.store,
          h.accountKey,
          new Set(),
          new Set(),
          false,
          true,
        )
      ).rows,
    ).toHaveLength(0);
    const result = await invokeContext([
      '--workspace',
      h.directory,
      '--account',
      h.accountKey,
      '--refresh-replies',
      '--dry-run',
      '--json',
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).data).toMatchObject({
      refreshReplies: true,
      planned: 0,
    });
  } finally {
    await h.close();
  }
});

test('IG-LIKES refresh plan binds only post records with absent observations and has its own mode hash', async () => {
  const h = await excludeFixture();
  try {
    const record = await writeInstagramContextContract(
      h.store,
      h.fixture.items[0],
    );
    const baseline = await planContext(h.store, h.accountKey);
    const plan = await planContext(
      h.store,
      h.accountKey,
      new Set(),
      new Set(),
      true,
    );
    expect(plan.refreshLikes).toBe(true);
    expect(plan.rows.map((row) => row.item.id)).toEqual([record.itemId]);
    expect(plan.hash).not.toBe(baseline.hash);
    expect(contextSummary(plan).refreshLikes).toBe(true);
    expect(plan.canary).toBe(false);
    await h.store.write((tx) =>
      tx.instagramContext.fillLikes({
        ...record,
        likes: { count: null, source: null },
      }),
    );
    expect(
      (await planContext(h.store, h.accountKey, new Set(), new Set(), true))
        .rows,
    ).toHaveLength(0);
  } finally {
    await h.close();
  }
});

test.each([
  { refresh: false, field: undefined, ok: true },
  { refresh: false, field: false, ok: true },
  { refresh: false, field: true, ok: false },
  { refresh: true, field: undefined, ok: true },
  { refresh: true, field: true, ok: true },
  { refresh: true, field: false, ok: false },
])(
  'F2 the command binds the order refreshLikes field to its mode, refresh=$refresh field=$field',
  async ({ refresh, field, ok }) => {
    const h = await excludeFixture();
    try {
      await writeInstagramContextContract(h.store, h.fixture.items[0]);
      const plan = await planContext(
        h.store,
        h.accountKey,
        new Set(),
        new Set(),
        refresh,
      );
      const order = join(h.directory, 'order.json');
      await writeFile(
        order,
        JSON.stringify({
          scope: 'context-instagram',
          account: plan.handle,
          givenAt: '2026-10-26T00:00:00Z',
          words: 'Generated reading order',
          acceptCanary: true,
          ...(field === undefined ? {} : { refreshLikes: field }),
        }),
      );
      const result = await invokeContext([
        '--workspace',
        h.directory,
        '--account',
        h.accountKey,
        ...(refresh ? ['--refresh-likes'] : []),
        '--order',
        order,
        '--plan',
        plan.hash,
        '--dry-run',
        '--json',
      ]);
      if (ok) {
        expect(result.code, result.stdout + result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          data: { planHash: plan.hash },
        });
      } else {
        expect(result.code).toBe(2);
        expect(JSON.parse(result.stdout)).toMatchObject({
          error: { code: 'CONTEXT_ORDER_INVALID' },
        });
      }
    } finally {
      await h.close();
    }
  },
);

test.each(['post-unavailable', 'comment-not-shown'])(
  'F4 settled refresh %s stays out until explicitly included',
  async (code) => {
    const h = await excludeFixture();
    try {
      const record = await writeInstagramContextContract(
        h.store,
        h.fixture.items[0],
      );
      const writer = new InstagramContextWriter(h.store),
        at = '2026-10-26T00:00:00.000Z';
      await writer.startRun({
        runId: 'generated-failed-refresh',
        accountKey: h.accountKey,
        planHash: 'a'.repeat(64),
        startedAt: at,
      });
      await writer.sending({
        attemptId: 'generated-failed-refresh-send',
        runId: 'generated-failed-refresh',
        itemId: record.itemId,
        at,
        refreshLikes: true,
      });
      await writer.settle({
        attemptId: 'generated-failed-refresh-send',
        state: 'failed',
        code,
        at,
      });
      expect(
        (await planContext(h.store, h.accountKey, new Set(), new Set(), true))
          .rows,
      ).toHaveLength(0);
      expect(
        (
          await planContext(
            h.store,
            h.accountKey,
            new Set([record.itemId]),
            new Set(),
            true,
          )
        ).rows.map((row) => row.item.id),
      ).toEqual([record.itemId]);
      expect(
        await h.store.read((tx) => tx.instagramContext.get(record.itemId)),
      ).toEqual(record);
    } finally {
      await h.close();
    }
  },
);
test('C18 exclude removes exactly named planned and manual entries before canary selection and counts unmatched IDs', async () => {
  const h = await excludeFixture();
  const manual = h.fixture.items[4]!;
  await h.store.write(async (tx) => {
    const stored = (await tx.items.get(manual.id))!;
    await tx.items.put({ ...stored, item: { ...stored.item, text: ' ' } });
  });
  const unknown = (await instagramFixture(7)).items[6]!.id;
  const exclude = new Set([h.fixture.items[0]!.id, manual.id, unknown]);
  try {
    const baseline = await planContext(h.store, h.accountKey);
    const plan = await planContext(h.store, h.accountKey, new Set(), exclude);
    expect(plan.rows.map((row) => row.item.id)).toEqual(
      h.fixture.items
        .filter((_, index) => index !== 0 && index !== 4)
        .map((item) => item.id),
    );
    expect(plan).toMatchObject({
      personExcluded: 2,
      excludeUnmatched: 1,
      manual: { emptyText: 0, noOwner: 0, closeTwin: 0 },
    });
    expect(canaryRows(plan).map((row) => row.item.id)).not.toContain(
      h.fixture.items[0]!.id,
    );
    expect(canaryRows(plan)).toHaveLength(4);
    const summary = JSON.stringify(contextSummary(plan)),
      list = contextList(plan);
    for (const item of h.fixture.items) expect(summary).not.toContain(item.id);
    expect(summary).not.toContain(unknown);
    expect(list.split('\n').map((line) => line.split('\t')[0])).not.toContain(
      h.fixture.items[0]!.id,
    );
    expect(plan.hash).not.toBe(baseline.hash);
    expect(
      (
        await planContext(
          h.store,
          h.accountKey,
          new Set(),
          new Set([...exclude].reverse()),
        )
      ).hash,
    ).toBe(plan.hash);
    expect(
      (await planContext(h.store, h.accountKey, new Set(), new Set([unknown])))
        .hash,
    ).not.toBe(baseline.hash);
  } finally {
    await h.close();
  }
});
test('C18 planner refuses overlap even when the shared ID is unknown', async () => {
  const h = await excludeFixture();
  try {
    const id = (await instagramFixture(7)).items[6]!.id;
    await expect(
      planContext(h.store, h.accountKey, new Set([id]), new Set([id])),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
  } finally {
    await h.close();
  }
});
test('C18 a changed manual-only exclusion changes the hash and earlier or confirmed entries keep their original buckets', async () => {
  const h = await excludeFixture();
  try {
    const writer = new InstagramContextWriter(h.store);
    const plan = await planContext(h.store, h.accountKey);
    await writer.startRun({
      runId: 'generated-exclude-earlier',
      accountKey: h.accountKey,
      planHash: plan.hash,
      startedAt: '2026-10-21T00:00:00Z',
    });
    await writer.sending({
      runId: 'generated-exclude-earlier',
      attemptId: 'generated-exclude-attempt',
      itemId: h.fixture.items[0]!.id,
      at: '2026-10-21T00:00:00Z',
    });
    await writer.settle({
      attemptId: 'generated-exclude-attempt',
      state: 'not-listed',
      code: 'no-row',
      at: '2026-10-21T00:00:00Z',
    });
    await h.store.write(async (tx) => {
      const stored = (await tx.items.get(h.fixture.items[1]!.id))!;
      await tx.items.put({ ...stored, item: { ...stored.item, text: ' ' } });
    });
    const baseline = await planContext(h.store, h.accountKey);
    const manual = await planContext(
      h.store,
      h.accountKey,
      new Set(),
      new Set([h.fixture.items[1]!.id]),
    );
    expect(manual.rows).toEqual(baseline.rows);
    expect(manual.hash).not.toBe(baseline.hash);
    expect(manual).toMatchObject({
      personExcluded: 1,
      excludeUnmatched: 0,
      manual: { emptyText: 0 },
    });
    const earlier = await planContext(
      h.store,
      h.accountKey,
      new Set(),
      new Set([h.fixture.items[0]!.id]),
    );
    expect(earlier).toMatchObject({
      personExcluded: 0,
      excludeUnmatched: 1,
      excluded: { 'not-listed': 1 },
    });
    const confirmedItem = {
      ...h.fixture.items[2]!,
      createdAt: '2025-07-31T00:00:00.000Z',
    };
    await h.store.write(async (tx) => {
      const stored = (await tx.items.get(confirmedItem.id))!;
      await tx.items.put({ ...stored, item: confirmedItem });
    });
    await writeInstagramContextContract(h.store, confirmedItem);
    const confirmed = await planContext(
      h.store,
      h.accountKey,
      new Set(),
      new Set([h.fixture.items[2]!.id]),
    );
    expect(confirmed).toMatchObject({
      personExcluded: 0,
      excludeUnmatched: 1,
      confirmed: 1,
    });
  } finally {
    await h.close();
  }
});
test('C18 an empty exclude set preserves the old plan hash and an all-excluded plan has no canary', async () => {
  const h = await excludeFixture();
  try {
    const before = await planContext(h.store, h.accountKey);
    expect(
      (await planContext(h.store, h.accountKey, new Set(), new Set())).hash,
    ).toBe(before.hash);
    const excluded = await planContext(
      h.store,
      h.accountKey,
      new Set(),
      new Set(h.fixture.items.map((item) => item.id)),
    );
    expect(excluded).toMatchObject({
      personExcluded: 6,
      excludeUnmatched: 0,
      rows: [],
    });
    expect(canaryRows(excluded)).toEqual([]);
    expect(contextSummary(excluded)).toMatchObject({ planned: 0, steps: 0 });
  } finally {
    await h.close();
  }
});
test('C18 command dry-run JSON accepts CRLF blank duplicates and unknown IDs with counts only and no workspace writes', async () => {
  const h = await excludeFixture();
  const unknown = (await instagramFixture(7)).items[6]!.id;
  try {
    const file = join(h.directory, 'exclude.txt');
    await writeFile(
      file,
      ` \r\n ${h.fixture.items[0]!.id} \r\n${unknown}\r\n${h.fixture.items[0]!.id}\r\n`,
    );
    await h.store.close();
    const before = await readFile(h.path);
    const result = await invokeContext([
      '--workspace',
      h.directory,
      '--account',
      h.accountKey,
      '--exclude',
      file,
      '--dry-run',
      '--json',
    ]);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'ok',
      data: { planned: 5, personExcluded: 1, excludeUnmatched: 1 },
    });
    for (const value of [
      unknown,
      ...h.fixture.items.flatMap((item) => [
        item.id,
        item.text,
        item.account.handle!,
        item.reference.ownerHandle!,
      ]),
    ])
      expect(result.stdout + result.stderr).not.toContain(value);
    expect(await readFile(h.path)).toEqual(before);
  } finally {
    await h.close();
  }
});
test.each(['overlap', 'invalid'] as const)(
  'C18 command %s refuses before workspace access without echoing file values',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'sp-ig-exclude-usage-'));
    const id = (await instagramFixture()).items[0]!.id;
    try {
      const exclude = join(directory, 'exclude.txt'),
        include = join(directory, 'include.txt');
      await writeFile(
        exclude,
        mode === 'overlap' ? id : 'Generated private text, not an item ID',
      );
      await writeFile(include, id);
      const result = await invokeContext([
        '--workspace',
        join(directory, 'missing'),
        '--account',
        'generated',
        '--exclude',
        exclude,
        ...(mode === 'overlap' ? ['--include', include] : []),
        '--dry-run',
        '--json',
      ]);
      expect(result.code).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: 'INVALID_ARGUMENTS' },
      });
      expect(result.stdout + result.stderr).not.toContain(id);
      expect(result.stdout + result.stderr).not.toContain(
        'Generated private text',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
test('C18 order and exclude use the fresh reduced hash while order and include stay forbidden', async () => {
  const h = await excludeFixture();
  try {
    const exclude = join(h.directory, 'exclude.txt'),
      include = join(h.directory, 'include.txt'),
      order = join(h.directory, 'order.json');
    await writeFile(exclude, h.fixture.items[0]!.id);
    await writeFile(include, h.fixture.items[1]!.id);
    const reduced = await planContext(
      h.store,
      h.accountKey,
      new Set(),
      new Set([h.fixture.items[0]!.id]),
    );
    const original = await planContext(h.store, h.accountKey);
    await writeFile(
      order,
      JSON.stringify({
        scope: 'context-instagram',
        account: reduced.handle,
        givenAt: '2026-10-21T10:27:13Z',
        words: 'Generated reading order',
        acceptCanary: true,
      }),
    );
    const args = [
      '--workspace',
      h.directory,
      '--account',
      h.accountKey,
      '--exclude',
      exclude,
      '--order',
      order,
      '--dry-run',
      '--json',
    ];
    const fresh = await invokeContext([...args, '--plan', reduced.hash]);
    expect(fresh.code, fresh.stdout + fresh.stderr).toBe(0);
    expect(JSON.parse(fresh.stdout)).toMatchObject({
      data: { planned: 5, personExcluded: 1, planHash: reduced.hash },
    });
    const stale = await invokeContext([...args, '--plan', original.hash]);
    expect(stale.code).toBe(1);
    expect(JSON.parse(stale.stdout)).toMatchObject({
      error: { code: 'STALE_PLAN' },
    });
    const included = await invokeContext([
      ...args,
      '--plan',
      reduced.hash,
      '--include',
      include,
    ]);
    expect(included.code).toBe(2);
    expect(JSON.parse(included.stdout)).toMatchObject({
      error: { code: 'INVALID_ARGUMENTS' },
    });
  } finally {
    await h.close();
  }
});
test('C18 disjoint include and exclude restore only the named earlier result', async () => {
  const h = await excludeFixture();
  try {
    const plan = await planContext(h.store, h.accountKey),
      writer = new InstagramContextWriter(h.store);
    await writer.startRun({
      runId: 'generated-disjoint',
      accountKey: h.accountKey,
      planHash: plan.hash,
      startedAt: '2026-10-21T00:00:00Z',
    });
    await writer.sending({
      runId: 'generated-disjoint',
      attemptId: 'generated-disjoint-attempt',
      itemId: h.fixture.items[0]!.id,
      at: '2026-10-21T00:00:00Z',
    });
    await writer.settle({
      attemptId: 'generated-disjoint-attempt',
      state: 'unavailable',
      code: null,
      at: '2026-10-21T00:00:00Z',
    });
    const include = join(h.directory, 'include.txt'),
      exclude = join(h.directory, 'exclude.txt');
    await writeFile(include, h.fixture.items[0]!.id);
    await writeFile(exclude, h.fixture.items[1]!.id);
    const expected = await planContext(
      h.store,
      h.accountKey,
      new Set([h.fixture.items[0]!.id]),
      new Set([h.fixture.items[1]!.id]),
    );
    const result = await invokeContext([
      '--workspace',
      h.directory,
      '--account',
      h.accountKey,
      '--include',
      include,
      '--exclude',
      exclude,
      '--dry-run',
      '--json',
    ]);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      data: {
        planned: 5,
        personExcluded: 1,
        excludeUnmatched: 0,
        excluded: { unavailable: 0 },
        planHash: expected.hash,
      },
    });
  } finally {
    await h.close();
  }
});
test.each(['list-image-only', 'no-row'] as const)(
  'IG-list explicit include restores a %s exclusion without rewriting its evidence',
  async (code) => {
    const h = await excludeFixture();
    try {
      const plan = await planContext(h.store, h.accountKey);
      const writer = new InstagramContextWriter(h.store);
      await writer.startRun({
        runId: 'generated-list-recovery',
        accountKey: h.accountKey,
        planHash: plan.hash,
        startedAt: IG_FIXTURE.now,
      });
      await writer.sending({
        runId: 'generated-list-recovery',
        attemptId: 'generated-list-recovery-send',
        itemId: h.fixture.items[0]!.id,
        at: IG_FIXTURE.now,
      });
      await writer.settle({
        attemptId: 'generated-list-recovery-send',
        state: 'not-listed',
        code,
        at: IG_FIXTURE.now,
      });
      const before = await h.store.browserJournal();
      expect(
        (await planContext(h.store, h.accountKey)).excluded['not-listed'],
      ).toBe(1);
      const include = join(h.directory, 'include.txt');
      await writeFile(include, h.fixture.items[0]!.id + '\n');
      const result = await invokeContext([
        '--workspace',
        h.directory,
        '--account',
        h.accountKey,
        '--include',
        include,
        '--dry-run',
        '--json',
      ]);
      expect(result.code, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        data: {
          planned: 6,
          excluded: { 'not-listed': 0 },
          planHash: plan.hash,
        },
      });
      expect(await h.store.browserJournal()).toEqual(before);
    } finally {
      await h.close();
    }
  },
);
test('C18 run command passes the same exclusion set to the runner without contacting a browser', async () => {
  const h = await excludeFixture();
  const validate = vi
    .spyOn(profiles, 'validateProfile')
    .mockResolvedValue(undefined);
  const installed = vi
    .spyOn(profiles, 'installedBrowser')
    .mockResolvedValue('generated-browser');
  const run = vi.spyOn(runner, 'runContext').mockResolvedValue({
    completed: 0,
    steps: 0,
    runId: '00000000-0000-4000-8000-000000000018',
    endReason: 'done',
  });
  try {
    const exclude = join(h.directory, 'exclude.txt');
    await writeFile(exclude, h.fixture.items[0]!.id);
    const reduced = await planContext(
      h.store,
      h.accountKey,
      new Set(),
      new Set([h.fixture.items[0]!.id]),
    );
    const result = await invokeContext([
      '--workspace',
      h.directory,
      '--account',
      h.accountKey,
      '--exclude',
      exclude,
      '--profile',
      join(h.directory, 'generated-profile'),
      '--plan',
      reduced.hash,
    ]);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toMatchObject({
      exclude: new Set([h.fixture.items[0]!.id]),
      plan: { hash: reduced.hash },
    });
  } finally {
    run.mockRestore();
    installed.mockRestore();
    validate.mockRestore();
    await h.close();
  }
});

test('C29 nonempty ownerless comments enter the plan and respect the person skip file', async () => {
  const h = await excludeFixture();
  try {
    await h.store.write(async (tx) => {
      const stored = (await tx.items.get(h.fixture.items[0]!.id))!;
      await tx.items.put({
        ...stored,
        item: {
          ...stored.item,
          reference: { ...stored.item.reference, ownerHandle: null },
        },
      });
    });
    const plan = await planContext(h.store, h.accountKey);
    expect(plan.rows).toHaveLength(6);
    expect(plan.manual.noOwner).toBe(0);
    const skipped = await planContext(
      h.store,
      h.accountKey,
      new Set(),
      new Set([h.fixture.items[0]!.id]),
    );
    expect(skipped.rows).toHaveLength(5);
    expect(skipped.personExcluded).toBe(1);
    expect(skipped.hash).not.toBe(plan.hash);
    const writer = new InstagramContextWriter(h.store);
    await writer.startRun({
      runId: 'generated-ownerless-include',
      accountKey: h.accountKey,
      planHash: plan.hash,
      startedAt: IG_FIXTURE.now,
    });
    await writer.sending({
      runId: 'generated-ownerless-include',
      attemptId: 'generated-ownerless-send',
      itemId: h.fixture.items[0]!.id,
      at: IG_FIXTURE.now,
    });
    await writer.settle({
      attemptId: 'generated-ownerless-send',
      state: 'not-listed',
      code: 'no-row',
      at: IG_FIXTURE.now,
    });
    expect(
      (await planContext(h.store, h.accountKey)).excluded['not-listed'],
    ).toBe(1);
    const restored = await planContext(
      h.store,
      h.accountKey,
      new Set([h.fixture.items[0]!.id]),
    );
    expect(
      restored.rows.some(({ item }) => item.id === h.fixture.items[0]!.id),
    ).toBe(true);
  } finally {
    await h.close();
  }
});
test('C29 an ownerless text-time twin cannot become a plan row even beside an owner-bearing export', async () => {
  const h = await excludeFixture();
  try {
    await h.store.write(async (tx) => {
      const first = (await tx.items.get(h.fixture.items[0]!.id))!;
      const second = (await tx.items.get(h.fixture.items[1]!.id))!;
      second.item = {
        ...second.item,
        text: first.item.text,
        createdAt: new Date(
          Date.parse(first.item.createdAt) + 120_000,
        ).toISOString(),
        reference: { ...second.item.reference, ownerHandle: null },
      };
      await tx.items.put(second);
    });
    const plan = await planContext(h.store, h.accountKey);
    expect(plan.manual).toEqual({ emptyText: 0, noOwner: 0, closeTwin: 2 });
    expect(plan.rows).toHaveLength(4);
  } finally {
    await h.close();
  }
});
test('manual reasons exclude empty and close twins but plan ownerless comments; marked status changes the canonical hash', async () => {
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
    expect(plan.manual).toEqual({ emptyText: 1, noOwner: 0, closeTwin: 2 });
    expect(plan.rows.map(({ item }) => item.id)).toEqual(
      [fixture.items[2]!, ...fixture.items.slice(4)].map((item) => item.id),
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
    expect(canaryRows(after)[0]!.item.id).toBe(fixture.items[2]!.id);
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

test('C8 canary takes at most fifteen in plan order with the oldest first and no duplicate', async () => {
  const fixture = await instagramFixture(17),
    directory = await mkdtemp(join(tmpdir(), 'sp-ig-canary-plan-'));
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: fixture.workspace,
  });
  try {
    const plan = await planContext(store, fixture.items[0]!.account.key);
    // A marked-first plan need not begin with its oldest exported comment.
    plan.rows = [...plan.rows.slice(7), ...plan.rows.slice(0, 7)];
    const ids = canaryRows(plan).map(({ item }) => item.id);
    expect(ids).toEqual([
      fixture.items[0]!.id,
      ...fixture.items.slice(7).map((item) => item.id),
      ...fixture.items.slice(1, 5).map((item) => item.id),
    ]);
    expect(new Set(ids).size).toBe(15);
    expect(canaryRows({ ...plan, rows: [] })).toEqual([]);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
