import { expect, test } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { instagramDeleteFixture } from '../../../e2e/fake-instagram/delete-fixture.ts';
import { SQLiteStore } from '../../workspace/sqlite-store.ts';
import {
  planInstagramDeletion,
  INSTAGRAM_DELETION_PROTOCOL,
  instagramDeleteSummary,
} from './delete-plan.ts';
import {
  instagramDeleteBudget,
  instagramDeletionState,
} from '../../workspace/instagram-delete-pace.ts';
import { acknowledgeWarningCard } from '../../commands/delete.ts';
import { createProfile } from '../profile.ts';
import {
  readXWarningFile,
  requireXWarningFileClear,
} from '../../workspace/x-warning-file.ts';
import { ContextStop } from './report.ts';
import { instagramWarningKind } from './warning.ts';
import {
  InstagramDeleteStop,
  checkInstagramDeletePage,
  instagramDeleteIdentity,
  clickInstagramDelete,
  instagramDeleteUiConfirmed,
  verifyInstagramComment,
  expandInstagramDeleteComment,
} from './delete-driver.ts';
import { executeCli } from '../../cli/adapter.ts';
import { createNodeContext } from '../../cli/node-context.ts';
import { networkRecorder } from '../../cli/test/network-recorder.ts';
import { verificationRows, runInstagramDeletion } from './delete-run.ts';
import { productionContext } from './driver.ts';
import type { ConfirmationView } from '../confirmation-state.ts';
import {
  createBackup,
  restoreBackup,
} from '@socialprune/core/workspace/backup';
import { createWorkspace } from '@socialprune/core/workspace/store';
import { restoreWorkspace } from '../../workspace/services.ts';
import { writeFile } from 'node:fs/promises';
import { restrictionSignal } from './signals.ts';

async function harness(count = 2) {
  const directory = await mkdtemp(join(tmpdir(), 'sp-d10-delete-'));
  const workspace = await instagramDeleteFixture(count);
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: workspace,
  });
  return {
    directory,
    store,
    workspace,
    account: workspace.items[0]!.account.key,
    close: async () => {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test('D10 plan binds post identity, human decisions, canary and workspace day without writes', async () => {
  const h = await harness();
  try {
    const before = await readFile(join(h.directory, 'socialprune.sqlite'));
    const a = await planInstagramDeletion(
      h.store,
      h.account,
      new Date('2026-10-25T12:00:00Z'),
    );
    expect(a.rows.map((r) => r.item.id)).toEqual(
      h.workspace.items.map((i) => i.id),
    );
    expect(a.canary).toBe(true);
    expect(instagramDeleteSummary(a, 'en')).toHaveProperty(
      'canaryItemId',
      a.rows[0]!.item.id,
    );
    expect(
      (
        await planInstagramDeletion(
          h.store,
          h.account,
          new Date('2026-10-26T12:00:00Z'),
        )
      ).hash,
    ).not.toBe(a.hash);
    expect(await readFile(join(h.directory, 'socialprune.sqlite'))).toEqual(
      before,
    );
  } finally {
    await h.close();
  }
});
test.each(['en', 'de'] as const)(
  'D12 E %s start page names the hash-bound watched comment before launch',
  async (lang) => {
    const h = await harness(2);
    let view: Omit<ConfirmationView, 'version'> | undefined;
    try {
      const profile = join(h.directory, 'profile');
      await createProfile(profile, 'instagram');
      const now = () => new Date('2026-10-25T12:00:00Z');
      const plan = await planInstagramDeletion(h.store, h.account, now());
      await runInstagramDeletion(
        {
          store: h.store,
          workspace: h.directory,
          plan,
          profile,
          executablePath: 'not-opened',
          lang,
          list: '',
          verify: false,
          now,
          signal: new AbortController().signal,
          notice: () => {},
        },
        {
          ...productionContext,
          checkPage: checkInstagramDeletePage,
          identity: instagramDeleteIdentity,
          click: clickInstagramDelete,
          uiConfirmed: instagramDeleteUiConfirmed,
          verify: verifyInstagramComment,
          expand: expandInstagramDeleteComment,
          confirmation: (initial) => {
            view = initial;
            return Promise.reject(new Error('Generated stop before launch'));
          },
        },
      );
      expect(view?.result).toContain(plan.rows[0]!.item.id);
      expect(view?.rows[0]).toMatchObject({
        itemId: plan.rows[0]!.item.id,
        watchedCanary: true,
      });
      expect(view?.rows[1]).toMatchObject({ watchedCanary: false });
    } finally {
      await h.close();
    }
  },
);
test('D10 list confirmations and owner-not-in-export never enter a deletion plan', async () => {
  const workspace = await instagramDeleteFixture(2);
  workspace.instagramContext![0] = {
    ...workspace.instagramContext![0]!,
    confirmedBy: 'list',
    comment: { id: null, createdAt: null, expandClicks: 0 },
  };
  workspace.instagramContext![1]!.ownerCheck = 'not-in-export';
  workspace.items[1]!.reference.ownerHandle = null;
  const directory = await mkdtemp(join(tmpdir(), 'sp-d10-manual-'));
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: workspace,
  });
  try {
    const plan = await planInstagramDeletion(
      store,
      workspace.items[0]!.account.key,
    );
    expect(plan.rows).toEqual([]);
    expect(plan.manual).toMatchObject({ list: 1, noOwner: 1 });
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('D10 attempts and the ten-attempt pause survive restart and Berlin midnight; later verification never counts', async () => {
  const h = await harness(10);
  let store = h.store;
  try {
    const writer = store.browserOutcomeWriter();
    const run = {
      runId: 'generated-delete',
      platform: 'instagram' as const,
      mode: 'delete' as const,
      accountKey: h.account,
      planHash: 'a'.repeat(64),
      startedAt: '2026-10-25T22:40:00.000Z',
      endedAt: null,
      endReason: null,
      bodyShapes: {},
      profileReport: null,
    };
    await writer.begin(run);
    const plan = await planInstagramDeletion(
      store,
      h.account,
      new Date(run.startedAt),
    );
    for (let i = 0; i < 10; i++) {
      const at = new Date(
        Date.parse('2026-10-25T22:54:30.000Z') + i * 30000,
      ).toISOString();
      const send = (await writer.check(plan.rows[i]!, run.runId, at, true))!;
      await writer.settle({
        ...send,
        attemptId: `failed-${i}`,
        settles: send.attemptId,
        state: 'failed',
        code: 'GENERATED',
        at,
      });
    }
    await writer.finish({
      ...run,
      endedAt: '2026-10-25T22:59:30.000Z',
      endReason: 'error',
    });
    await store.close();
    store = await SQLiteStore.open(join(h.directory, 'socialprune.sqlite'));
    expect(
      await instagramDeleteBudget(
        store,
        h.account,
        new Date('2026-10-25T23:00:00.000Z'),
        'Europe/Berlin',
      ),
    ).toMatchObject({ used: 0, batch: 10, wait: 840000 });
    expect(
      await instagramDeleteBudget(
        store,
        h.account,
        new Date('2026-10-25T22:59:30.000Z'),
        'Europe/Berlin',
      ),
    ).toMatchObject({ used: 10, batch: 10, wait: 870000 });
    expect(
      (
        await instagramDeleteBudget(
          store,
          h.account,
          new Date('2026-10-25T23:14:00.000Z'),
          'Europe/Berlin',
        )
      ).wait,
    ).toBe(0);
  } finally {
    await store.close();
    await rm(h.directory, { recursive: true, force: true });
  }
}, 30000);
test('D10 ambiguous journal blocks another plan and cannot be resent by a new run', async () => {
  const h = await harness();
  try {
    const at = '2026-10-25T12:00:00.000Z',
      plan = await planInstagramDeletion(h.store, h.account, new Date(at));
    const writer = h.store.browserOutcomeWriter();
    const run = {
      runId: 'generated-ambiguous',
      platform: 'instagram' as const,
      mode: 'delete' as const,
      accountKey: h.account,
      planHash: plan.hash,
      startedAt: at,
      endedAt: null,
      endReason: null,
      bodyShapes: {},
      profileReport: null,
    };
    await writer.begin(run);
    const send = (await writer.check(plan.rows[0]!, run.runId, at, true))!;
    await writer.settle({
      ...send,
      attemptId: 'ambiguous',
      settles: send.attemptId,
      state: 'ambiguous',
      code: 'TIMEOUT',
      at,
    });
    await writer.finish({ ...run, endedAt: at, endReason: 'error' });
    expect(
      (await planInstagramDeletion(h.store, h.account, new Date(at))).rows.map(
        (r) => r.item.id,
      ),
    ).not.toContain(plan.rows[0]!.item.id);
    await expect(
      writer.check(plan.rows[0]!, run.runId, at, true),
    ).rejects.toMatchObject({ code: 'RUN_STOPPED' });
  } finally {
    await h.close();
  }
});
test('D10 fifty attempts, including failed sending reservations, refuse the fifty-first across restart and a fresh day resets only the day count', async () => {
  const h = await harness(51);
  let store = h.store;
  try {
    const at = '2026-10-25T10:00:00.000Z';
    const writer = store.browserOutcomeWriter();
    const run = {
      runId: 'generated-fifty',
      platform: 'instagram' as const,
      mode: 'delete' as const,
      accountKey: h.account,
      planHash: 'a'.repeat(64),
      startedAt: at,
      endedAt: null,
      endReason: null,
      bodyShapes: {},
      profileReport: null,
    };
    await writer.begin(run);
    const plan = await planInstagramDeletion(store, h.account, new Date(at));
    let time = Date.parse(at);
    for (let index = 0; index < 50; index++) {
      if (index) time += index % 10 === 0 ? 900000 : 30000;
      const send = (await writer.check(
        plan.rows[index]!,
        run.runId,
        new Date(time).toISOString(),
        true,
      ))!;
      await writer.settle({
        ...send,
        attemptId: `fifty-failed-${index}`,
        state: 'failed',
        settles: send.attemptId,
        at: new Date(time).toISOString(),
        code: 'GENERATED',
      });
    }
    await expect(
      writer.check(
        plan.rows[50]!,
        run.runId,
        new Date(time + 900000).toISOString(),
        true,
      ),
    ).rejects.toMatchObject({ code: 'RUN_STOPPED' });
    await writer.finish({
      ...run,
      endedAt: new Date(time).toISOString(),
      endReason: 'error',
    });
    await store.close();
    store = await SQLiteStore.open(join(h.directory, 'socialprune.sqlite'));
    expect(
      (
        await instagramDeleteBudget(
          store,
          h.account,
          new Date(time),
          'Europe/Berlin',
        )
      ).used,
    ).toBe(50);
    expect(
      (
        await instagramDeleteBudget(
          store,
          h.account,
          new Date('2026-10-26T10:00:00Z'),
          'Europe/Berlin',
        )
      ).used,
    ).toBe(0);
  } finally {
    await store.close();
    await rm(h.directory, { recursive: true, force: true });
  }
}, 30000);
test.each(['http-429', 'limit-notice', 'warning-notice'] as const)(
  'D10 %s persists a deletion-only warning across workspace/profile copies and acknowledgement',
  async (kind) => {
    const h = await harness(1);
    const profile = join(h.directory, 'profile');
    try {
      await createProfile(profile, 'instagram');
      const at = '2026-10-25T12:00:00.000Z',
        writer = h.store.browserOutcomeWriter();
      writer.bindXWarningProfile(profile, 'instagram');
      const run = {
        runId: 'generated-warning',
        platform: 'instagram' as const,
        accountKey: h.account,
        mode: 'delete' as const,
        planHash: 'a'.repeat(64),
        startedAt: at,
        endedAt: null,
        endReason: null,
        bodyShapes: {},
        profileReport: null,
      };
      await writer.begin(run);
      await writer.recordXWarning(
        run.runId,
        at,
        'Europe/Berlin',
        kind,
        'instagram',
      );
      await writer.finish({
        ...run,
        endedAt: at,
        endReason: 'platform-check',
        instagramWarning: { kind, at, zone: 'Europe/Berlin' },
      });
      expect(await readXWarningFile(profile, 'instagram')).toMatchObject({
        runId: run.runId,
        kind,
      });
      expect(await readXWarningFile(profile)).toBeNull();
      await expect(
        writer.requireXWarningClear(
          h.account,
          at,
          'Europe/Berlin',
          'instagram',
        ),
      ).rejects.toMatchObject({ code: 'IG_WARNING_DAY' });
      await expect(
        requireXWarningFileClear(
          profile,
          '2026-10-26T12:00:00Z',
          'Europe/Berlin',
          'instagram',
        ),
      ).rejects.toMatchObject({ code: 'IG_WARNING_CARD_REQUIRED' });
      const stale = await SQLiteStore.open(join(h.directory, 'stale.sqlite'), {
        initial: h.workspace,
      });
      try {
        expect(
          await stale
            .browserOutcomeWriter()
            .xWarning(h.account, undefined, 'instagram'),
        ).toBeNull();
        await expect(
          requireXWarningFileClear(profile, at, 'Europe/Berlin', 'instagram'),
        ).rejects.toMatchObject({ code: 'IG_WARNING_DAY' });
      } finally {
        await stale.close();
      }
      const backupFile = join(h.directory, 'generated-empty-backup.json');
      await writeFile(backupFile, JSON.stringify(createWorkspace()));
      const restoreTarget = join(h.directory, 'restore-target');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(restoreTarget);
      const warnedCopy = await SQLiteStore.open(
        join(restoreTarget, 'socialprune.sqlite'),
        { initial: h.workspace },
      );
      // A separately generated warned target avoids holding the source handle
      // while Windows checks the replacement file's exclusive ownership.
      await warnedCopy
        .browserOutcomeWriter()
        .begin({ ...run, runId: 'generated-target-warning' });
      await warnedCopy
        .browserOutcomeWriter()
        .recordXWarning(
          'generated-target-warning',
          at,
          'Europe/Berlin',
          kind,
          'instagram',
        );
      await warnedCopy.browserOutcomeWriter().finish({
        ...run,
        runId: 'generated-target-warning',
        endedAt: at,
        endReason: 'platform-check',
        instagramWarning: { at, kind, zone: 'Europe/Berlin' },
      });
      await warnedCopy.close();
      await expect(
        restoreWorkspace({
          file: backupFile,
          workspace: restoreTarget,
          signal: new AbortController().signal,
          now: () => new Date(at),
        }),
      ).rejects.toMatchObject({ code: 'IG_WARNING_RESTORE_BLOCKED' });
      await expect(
        acknowledgeWarningCard(
          h.store,
          h.account,
          run.runId,
          '2026-10-26T12:00:00Z',
          'Europe/Berlin',
          'en',
          () => Promise.resolve('wrong'),
          profile,
          'instagram',
        ),
      ).rejects.toMatchObject({ code: 'IG_WARNING_CARD_REQUIRED' });
      await acknowledgeWarningCard(
        h.store,
        h.account,
        run.runId,
        '2026-10-26T12:00:00Z',
        'Europe/Berlin',
        'en',
        () => Promise.resolve(`I read the card for ${run.runId}`),
        profile,
        'instagram',
      );
      expect(await readXWarningFile(profile, 'instagram')).toBeNull();
      await expect(
        writer.requireXWarningClear(
          h.account,
          '2026-10-26T12:00:00Z',
          'Europe/Berlin',
          'instagram',
        ),
      ).resolves.toBeUndefined();
    } finally {
      await h.close();
    }
  },
);
test('D10 generic errors, login and checkpoint are not silently promoted to restriction warnings', () => {
  expect(instagramWarningKind(new InstagramDeleteStop('limit-notice'))).toBe(
    'limit-notice',
  );
  expect(
    instagramWarningKind(new ContextStop('PLATFORM_CHECK', 'http-429')),
  ).toBe('http-429');
  for (const token of [
    'login',
    'challenge',
    'checkpoint',
    'notice-error',
  ] as const)
    expect(
      instagramWarningKind(new ContextStop('PLATFORM_CHECK', token)),
    ).toBeUndefined();
});
test('D10 the fifteen-minute pause starts after the tenth attempt settles, not before its in-flight time', () => {
  const rows: import('@socialprune/core').BrowserAttempt[] = [];
  const start = Date.parse('2026-10-25T12:00:00Z');
  for (let i = 0; i < 10; i++) {
    const sending = {
      seq: i * 2 + 1,
      runId: 'generated',
      itemId: `instagram:${i}`,
      action: 'delete-comment' as const,
      state: 'sending' as const,
      attemptId: `sending-${i}`,
      settles: null,
      at: new Date(start + i * 30000).toISOString(),
      code: null,
    };
    rows.push(sending, {
      ...sending,
      seq: i * 2 + 2,
      attemptId: `settled-${i}`,
      state: 'failed',
      settles: sending.attemptId,
      at: new Date(start + i * 30000 + 20000).toISOString(),
    });
  }
  const lastEnd = start + 9 * 30000 + 20000;
  expect(instagramDeletionState(rows, new Date(lastEnd), 'UTC')).toMatchObject({
    batch: 10,
    used: 10,
    wait: 900000,
  });
  expect(
    instagramDeletionState(rows, new Date(lastEnd + 900000), 'UTC').wait,
  ).toBe(0);
});
test('D10 a positively dead warned owner retains its portable gate and recovers an interrupted click as ambiguous', async () => {
  const h = await harness(1);
  try {
    const at = '2026-10-25T12:00:00Z',
      writer = h.store.browserOutcomeWriter(),
      plan = await planInstagramDeletion(h.store, h.account, new Date(at));
    const run = {
      runId: 'generated-dead-owner',
      platform: 'instagram' as const,
      accountKey: h.account,
      mode: 'delete' as const,
      planHash: plan.hash,
      startedAt: at,
      endedAt: null,
      endReason: null,
      bodyShapes: {},
      profileReport: null,
      ownerPid: 2147483647,
    };
    await writer.begin(run);
    await writer.check(plan.rows[0]!, run.runId, at, true);
    await writer.recordXWarning(
      run.runId,
      at,
      'Europe/Berlin',
      'http-429',
      'instagram',
    );
    const { vi } = await import('vitest');
    const probe = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Generated dead owner'), { code: 'ESRCH' });
    });
    try {
      await writer.recover(h.account, '2026-10-25T12:01:00Z');
    } finally {
      probe.mockRestore();
    }
    expect(
      (await h.store.browserJournal()).runs.find((r) => r.runId === run.runId),
    ).toMatchObject({
      endReason: 'platform-check',
      instagramWarning: { kind: 'http-429' },
    });
    expect(
      (await h.store.browserJournal()).attempts
        .filter((a) => a.runId === run.runId)
        .map((a) => a.state),
    ).toEqual(['sending', 'ambiguous']);
    let text = '';
    for await (const chunk of createBackup(h.store).chunks)
      text += new TextDecoder().decode(chunk);
    expect(text).toContain('instagramWarning');
    expect(
      (await planInstagramDeletion(h.store, h.account, new Date(at))).manual
        .unresolved,
    ).toBe(1);
  } finally {
    await h.close();
  }
});

test('D10 withdrawal immediately before request never changes the human decision or allows a final click', async () => {
  const h = await harness(1);
  try {
    const plan = await planInstagramDeletion(h.store, h.account),
      row = plan.rows[0]!;
    await h.store.write(async (tx) => {
      const runtime = await tx.runtime.get();
      await tx.decisionEvents.append([
        {
          ...row.decision,
          eventId: 'generated-withdrawal',
          seq: (runtime.lastEventSeq ?? 1) + 1,
          previous: 'delete',
          value: 'keep',
          action: {
            id: 'generated-withdrawal',
            kind: 'single',
            size: 1,
            reverts: null,
          },
        },
      ]);
      const state = (await tx.state.get(row.item.id))!;
      await tx.state.put({ ...state, decision: 'keep' });
    });
    await expect(
      h.store.browserOutcomeWriter().requireInstagramDecision(row),
    ).rejects.toMatchObject({ code: 'RUN_STOPPED' });
    expect(
      (await h.store.read((tx) => tx.state.get(row.item.id)))?.decision,
    ).toBe('keep');
  } finally {
    await h.close();
  }
});
test.each(['feedback_required', 'please_wait', 'spam'] as const)(
  'D10 %s JSON signal classifies a restriction, while checkpoint alone does not',
  (token) => {
    expect(restrictionSignal({ nested: [{ status: token }] })).toBe(true);
    expect(restrictionSignal({ message: 'checkpoint_required' })).toBe(false);
    const error = new ContextStop('PLATFORM_CHECK', 'rate-signal');
    error.warningKind = 'warning-notice';
    expect(instagramWarningKind(error)).toBe('warning-notice');
  },
);
test('D10 real CLI dry run is network-free, leaves SQLite byte-identical and offers no decision or automatic Start', async () => {
  const h = await harness();
  await h.store.close();
  const file = join(h.directory, 'socialprune.sqlite');
  const before = await readFile(file),
    capture = networkRecorder();
  const output: string[] = [],
    errors: string[] = [];
  const context = createNodeContext(
    { write: (s) => output.push(s) },
    { write: (s) => errors.push(s) },
  );
  try {
    expect(
      await executeCli(
        [
          'delete',
          'instagram',
          '--workspace',
          h.directory,
          '--account',
          h.account,
          '--dry-run',
          '--json',
        ],
        context,
      ),
    ).toBe(0);
    expect(
      (JSON.parse(output.join('')) as { data: unknown }).data,
    ).toMatchObject({
      planned: 2,
      canary: true,
      attemptsPerDay: 50,
    });
    expect(output.join('')).not.toContain(h.workspace.items[0]!.text);
    expect(await readFile(file)).toEqual(before);
    expect(capture.calls).toEqual([]);
    output.length = 0;
    expect(
      await executeCli(
        [
          'delete',
          'instagram',
          '--workspace',
          h.directory,
          '--account',
          h.account,
          '--profile',
          'not-opened',
          '--plan',
          'a'.repeat(64),
          '--json',
        ],
        context,
      ),
    ).toBe(2);
    expect(output.join('')).toContain('NOT_INTERACTIVE');
  } finally {
    capture.restore();
    await rm(h.directory, { recursive: true, force: true });
  }
});

test('D10 watched canary accepts only one confirmed receipt and never selects another comment until a fresh plan', async () => {
  const h = await harness(2);
  try {
    const at = '2026-10-25T12:00:00.000Z',
      plan = await planInstagramDeletion(h.store, h.account, new Date(at));
    const writer = h.store.browserOutcomeWriter();
    const run = {
      runId: 'generated-canary',
      platform: 'instagram' as const,
      mode: 'delete' as const,
      accountKey: h.account,
      planHash: plan.hash,
      startedAt: at,
      endedAt: null,
      endReason: null,
      bodyShapes: { 'deletion-protocol': [INSTAGRAM_DELETION_PROTOCOL] },
      profileReport: null,
    };
    await writer.begin(run);
    const row = plan.rows[0]!,
      send = (await writer.check(row, run.runId, at, true))!;
    await expect(
      writer.acceptInstagramDeleteCanary(run.runId, at),
    ).rejects.toMatchObject({ code: 'CANARY_CHECK_FAILED' });
    await expect(
      writer.settle(
        {
          ...send,
          attemptId: 'invalid-no-receipt',
          state: 'deleted',
          settles: send.attemptId,
          code: null,
        },
        'deleted-via-browser',
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_INVALID' });
    await expect(
      writer.settle(
        {
          ...send,
          attemptId: 'generated-confirmed-delete',
          state: 'deleted',
          settles: send.attemptId,
          code: null,
          receipt: {
            method: 'POST',
            path: `/api/v1/web/comments/987/delete/${row.context.comment.id}/`,
            status: 200,
            shape: ['status'],
          },
        },
        'deleted-via-browser',
      ),
      'confirmed settlement',
    ).resolves.toBeDefined();
    await expect(
      writer.finish({ ...run, endedAt: at, endReason: 'canary' }),
      'canary end',
    ).resolves.toBeUndefined();
    expect(
      (await planInstagramDeletion(h.store, h.account, new Date(at))).canary,
    ).toBe(true);
    await expect(
      writer.acceptInstagramDeleteCanary(run.runId, at),
      'canary acceptance',
    ).resolves.toBeUndefined();
    const next = await planInstagramDeletion(h.store, h.account, new Date(at));
    expect(next.canary).toBe(false);
    expect(instagramDeleteSummary(next, 'en')).toHaveProperty(
      'canaryItemId',
      null,
    );
    expect(next.hash).not.toBe(plan.hash);
    expect(next.rows.map((r) => r.item.id)).toEqual([plan.rows[1]!.item.id]);
    expect(
      await verificationRows(
        h.store,
        h.account,
        new Date('2026-11-01T11:59:59.999Z'),
      ),
    ).toHaveLength(0);
    expect(
      await verificationRows(
        h.store,
        h.account,
        new Date('2026-11-01T12:00:00.000Z'),
      ),
    ).toHaveLength(1);
    const failureRun = {
      ...run,
      runId: 'generated-new-shape',
      startedAt: '2026-10-26T12:00:00Z',
    };
    await writer.begin(failureRun);
    await writer.finish({
      ...failureRun,
      endedAt: failureRun.startedAt,
      endReason: 'error',
      bodyShapes: { stop: ['INSTAGRAM_SHAPE_CHANGED'] },
    });
    expect(
      (
        await planInstagramDeletion(
          h.store,
          h.account,
          new Date('2026-10-26T12:00:00Z'),
        )
      ).canary,
    ).toBe(true);
  } finally {
    await h.close();
  }
});

test.each([['status', 'x'], ['status']] as const)(
  'D12 A unrecognized receipt/UI keeps the canary armed after verification until a later canary is accepted (%j)',
  async (...shape) => {
    const h = await harness(3);
    try {
      const at = '2026-10-25T12:00:00.000Z';
      const writer = h.store.browserOutcomeWriter();
      const plan = await planInstagramDeletion(
        h.store,
        h.account,
        new Date(at),
      );
      const run = {
        runId: 'accepted',
        platform: 'instagram' as const,
        mode: 'delete' as const,
        accountKey: h.account,
        planHash: plan.hash,
        startedAt: at,
        endedAt: null,
        endReason: null,
        bodyShapes: { 'deletion-protocol': [INSTAGRAM_DELETION_PROTOCOL] },
        profileReport: null,
      };
      await writer.begin(run);
      const first = (await writer.check(plan.rows[0]!, run.runId, at, true))!;
      await writer.settle(
        {
          ...first,
          attemptId: 'confirmed',
          settles: first.attemptId,
          state: 'deleted',
          code: null,
          receipt: {
            method: 'POST',
            path: `/api/v1/web/comments/987/delete/${plan.rows[0]!.context.comment.id}/`,
            status: 200,
            shape: ['status'],
          },
        },
        'deleted-via-browser',
      );
      await writer.finish({ ...run, endedAt: at, endReason: 'canary' });
      await writer.acceptInstagramDeleteCanary(run.runId, at);
      const main = await planInstagramDeletion(
        h.store,
        h.account,
        new Date('2026-10-25T12:01:00Z'),
      );
      expect(main.canary).toBe(false);
      const later = {
        ...run,
        runId: 'main-unconfirmed',
        planHash: main.hash,
        startedAt: '2026-10-25T12:01:00.000Z',
      };
      await writer.begin(later);
      const send = (await writer.check(
        main.rows[0]!,
        later.runId,
        later.startedAt,
        true,
      ))!;
      const ambiguous = await writer.settle({
        ...send,
        attemptId: 'unconfirmed',
        settles: send.attemptId,
        state: 'ambiguous',
        code: 'PLATFORM_CHECK',
        receipt: {
          method: 'POST',
          path: `/api/v1/web/comments/987/delete/${main.rows[0]!.context.comment.id}/`,
          status: 200,
          shape,
        },
      });
      await writer.finish({
        ...later,
        endedAt: later.startedAt,
        endReason: 'platform-check',
        bodyShapes: { stop: ['PLATFORM_CHECK'] },
      });
      const next = await planInstagramDeletion(
        h.store,
        h.account,
        new Date('2026-10-25T12:02:00Z'),
      );
      expect(next.rows).toHaveLength(1);
      expect(next.canary).toBe(true);
      const verifiedAt = '2026-10-25T12:03:00.000Z';
      const verify = {
        ...run,
        runId: 'verified-present',
        mode: 'verify' as const,
        planHash: next.hash,
        startedAt: verifiedAt,
      };
      await writer.begin(verify);
      await writer.record({
        attemptId: 'same-comment-present',
        runId: verify.runId,
        itemId: ambiguous.itemId,
        action: 'verify',
        state: 'not-deleted',
        settles: null,
        at: verifiedAt,
        code: null,
      });
      await writer.settle({
        ...ambiguous,
        attemptId: 'reconciled-present',
        state: 'not-deleted',
        settles: ambiguous.attemptId,
        at: verifiedAt,
        code: null,
      });
      await writer.finish({
        ...verify,
        endedAt: verifiedAt,
        endReason: 'done',
      });
      const watchedAt = '2026-10-25T12:04:00.000Z';
      const watched = await planInstagramDeletion(
        h.store,
        h.account,
        new Date(watchedAt),
      );
      expect(watched.canary).toBe(true);
      expect(watched.rows).toHaveLength(2);
      expect(watched.rows[0]!.item.id).toBe(ambiguous.itemId);
      expect(instagramDeleteSummary(watched, 'en').canaryItemId).toBe(
        ambiguous.itemId,
      );
      const canary = {
        ...run,
        runId: 'replacement-canary',
        planHash: watched.hash,
        startedAt: watchedAt,
      };
      await writer.begin(canary);
      const watchedSend = (await writer.check(
        watched.rows[0]!,
        canary.runId,
        watchedAt,
        true,
      ))!;
      await writer.settle(
        {
          ...watchedSend,
          attemptId: 'watched-deleted',
          settles: watchedSend.attemptId,
          state: 'deleted',
          code: null,
          receipt: {
            method: 'POST',
            path: `/api/v1/web/comments/987/delete/${watched.rows[0]!.context.comment.id}/`,
            status: 200,
            shape: ['status'],
          },
        },
        'deleted-via-browser',
      );
      await writer.finish({
        ...canary,
        endedAt: watchedAt,
        endReason: 'canary',
      });
      expect(
        (await planInstagramDeletion(h.store, h.account, new Date(watchedAt)))
          .canary,
      ).toBe(true);
      await writer.acceptInstagramDeleteCanary(
        canary.runId,
        '2026-10-25T12:05:00.000Z',
      );
      const resumed = await planInstagramDeletion(
        h.store,
        h.account,
        new Date('2026-10-25T12:06:00Z'),
      );
      expect(resumed.canary).toBe(false);
      expect(resumed.rows).toHaveLength(1);
      expect(resumed.rows[0]!.item.id).toBe(next.rows[0]!.item.id);
      expect(instagramDeleteSummary(resumed, 'en').canaryItemId).toBeNull();
    } finally {
      await h.close();
    }
  },
);

test('D10 ambiguous attempts survive portable restore and only read-only same-ID evidence can reconcile them', async () => {
  const h = await harness(1);
  const restoredPath = join(h.directory, 'restored.sqlite');
  let restored: SQLiteStore | undefined;
  try {
    const at = '2026-10-25T12:00:00.000Z',
      plan = await planInstagramDeletion(h.store, h.account, new Date(at));
    const writer = h.store.browserOutcomeWriter(),
      row = plan.rows[0]!;
    const run = {
      runId: 'generated-ambiguous-portable',
      platform: 'instagram' as const,
      mode: 'delete' as const,
      accountKey: h.account,
      planHash: plan.hash,
      startedAt: at,
      endedAt: null,
      endReason: null,
      bodyShapes: {},
      profileReport: null,
    };
    await writer.begin(run);
    const send = (await writer.check(row, run.runId, at, true))!;
    const ambiguous = await writer.settle({
      ...send,
      attemptId: 'generated-ambiguous-effect',
      state: 'ambiguous',
      settles: send.attemptId,
      at,
      code: 'DELETE_FAILED',
    });
    await writer.finish({ ...run, endedAt: at, endReason: 'error' });
    restored = await SQLiteStore.open(restoredPath, {
      initial: createWorkspace(),
    });
    await restoreBackup(restored, createBackup(h.store).chunks);
    expect(
      (await planInstagramDeletion(restored, h.account, new Date(at))).manual
        .unresolved,
    ).toBe(1);
    const copy = restored.browserOutcomeWriter();
    await expect(
      copy.settle({
        ...ambiguous,
        attemptId: 'forged-reconcile',
        state: 'not-deleted',
        settles: ambiguous.attemptId,
        code: null,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_INVALID' });
    const verify = {
      ...run,
      runId: 'generated-verify',
      mode: 'verify' as const,
    };
    await copy.begin(verify);
    await copy.record({
      attemptId: 'generated-present',
      runId: verify.runId,
      itemId: row.item.id,
      action: 'verify',
      state: 'not-deleted',
      settles: null,
      at,
      code: null,
    });
    await copy.settle({
      ...ambiguous,
      attemptId: 'generated-reconciled',
      state: 'not-deleted',
      settles: ambiguous.attemptId,
      code: null,
    });
    await copy.finish({ ...verify, endedAt: at, endReason: 'done' });
    expect(
      (await planInstagramDeletion(restored, h.account, new Date(at))).rows,
    ).toHaveLength(1);
  } finally {
    await restored?.close();
    await h.close();
  }
});
