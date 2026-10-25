import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import * as profileReports from './profile.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { fixtureWorkspace, FIXTURE } from '../../e2e/fake-x/fixture.ts';
import { createProfile } from './profile.ts';
import { runWithDependencies, dailyCount } from './runner.ts';
import { planDeletion } from './plan.ts';
import { CliError } from '../cli/errors.ts';
import { RunControls } from './run-controls.ts';
import type { RunSession } from './run-session.ts';
import { cleanDeletions } from './x/delete-pace.ts';

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'sp-d2-runner-'));
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: fixtureWorkspace(['1001', '1002']),
  });
  const profile = join(directory, 'profile');
  await createProfile(profile);
  const notices: string[] = [],
    waits: number[] = [],
    results: string[] = [];
  let now = Date.parse(FIXTURE.now);
  const controller = new AbortController();
  const account = vi.fn(() => Promise.resolve(FIXTURE.account.handle));
  const session: RunSession = {
    controls: new RunControls(
      () => new Date(now),
      () => {},
    ),
    browser() {},
    failed() {},
    before() {},
    entry() {},
    progress() {},
    update() {},
    waiting() {},
    instagram() {},
    finish() {},
    confirmation: () =>
      Promise.resolve({
        url: 'app://socialprune/',
        launchUrl: 'app://socialprune/',
        stopped: false,
        update(value) {
          if (value.result) results.push(value.result);
        },
        wait: () => Promise.resolve(true),
        onStop() {},
        close: () => Promise.resolve(),
      }),
  };
  return {
    store,
    profile,
    notices,
    waits,
    results,
    session,
    account,
    stop: () => controller.abort(),
    setNow(value: string) {
      now = Date.parse(value);
    },
    async run(verify = false, fail: boolean | Error = false, present = false) {
      return runWithDependencies(
        {
          store,
          profile,
          plan: await planDeletion(
            store,
            FIXTURE.account.key,
            new Set(),
            new Date(now),
          ),
          executablePath: 'generated',
          verify,
          list: '',
          lang: 'en',
          signal: controller.signal,
          now: () => new Date(now),
          notice: (text) => notices.push(text),
          session,
        },
        {
          pace: {
            intervalMs: 30000,
            batchSize: 20,
            pauseMs: 900000,
            perDay: 200,
          },
          confirmationPort: 0,
          sleep(ms) {
            waits.push(ms);
            now += ms;
            return Promise.resolve();
          },
          driver: () =>
            Promise.resolve({
              showConfirmation: () => Promise.resolve(),
              account,
              inspect: () => {
                if (fail instanceof Error) throw fail;
                if (fail)
                  throw new CliError(
                    'PLATFORM_CHECK',
                    undefined,
                    undefined,
                    'marker-login',
                  );
                return Promise.resolve(
                  present ? ('present' as const) : ('gone' as const),
                );
              },
              delete: () =>
                Promise.resolve({
                  state: 'deleted' as const,
                  code: null,
                  receipt: {
                    method: 'POST',
                    path: '/i/api/graphql/generated/DeleteTweet',
                    status: 200,
                    shape: ['data'],
                  },
                }),
              flush: () => Promise.resolve(),
              close: () => Promise.resolve(),
            }),
        },
      );
    },
    async close() {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('Stop during the pre-account profile read-back never starts account navigation afterwards', async () => {
  const h = await harness();
  const snapshot = profileReports.profileSnapshot;
  let reads = 0;
  let reached!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi
    .spyOn(profileReports, 'profileSnapshot')
    .mockImplementation(async (directory) => {
      if (++reads === 2) {
        reached();
        await blocked;
      }
      return snapshot(directory);
    });
  const task = h.run();
  try {
    await Promise.race([
      entered,
      task.then(() => {
        throw new Error('RUN_FINISHED_BEFORE_PROFILE_READBACK');
      }),
    ]);
    h.stop();
    release();
    await expect(task).resolves.toMatchObject({
      endReason: 'stopped-by-person',
    });
    expect(h.account).not.toHaveBeenCalled();
    expect((await h.store.browserJournal()).runs.at(-1)).toMatchObject({
      endReason: 'stopped-by-person',
    });
  } finally {
    release();
    await task.catch(() => undefined);
    spy.mockRestore();
    await h.close();
  }
});

test.each([false, true])(
  'D2 runner terminal and report preserve closed stop category, verify=%s',
  async (verify) => {
    const h = await harness();
    try {
      if (verify) {
        const writer = h.store.browserOutcomeWriter(),
          plan = await planDeletion(h.store, FIXTURE.account.key);
        const run = {
          runId: 'generated-verify',
          platform: 'x' as const,
          accountKey: FIXTURE.account.key,
          mode: 'delete' as const,
          planHash: plan.hash,
          startedAt: FIXTURE.now,
          endedAt: null,
          endReason: null,
          bodyShapes: {},
          profileReport: null,
        };
        await writer.begin(run);
        const sending = (await writer.check(
          plan.rows[0]!,
          run.runId,
          FIXTURE.now,
          true,
        ))!;
        await writer.settle({
          attemptId: 'ambiguous-prior',
          runId: run.runId,
          itemId: 'x:1001',
          action: 'delete-post',
          state: 'ambiguous',
          settles: sending.attemptId,
          at: FIXTURE.now,
          code: 'RESPONSE_UNKNOWN',
        });
        await writer.finish({
          ...run,
          endedAt: FIXTURE.now,
          endReason: 'error',
        });
      }
      await expect(h.run(verify, true)).rejects.toMatchObject({
        code: 'PLATFORM_CHECK',
        reason: 'marker-login',
      });
      expect(h.notices).toContain('Stop detail: marker-login\n');
      expect(h.results.at(-1)).toContain(
        'X shows a sign-in, account check, lock or limit page.',
      );
      const run = (await h.store.browserJournal()).runs.at(-1)!;
      expect(
        JSON.parse(
          await readFile(
            join(
              h.profile,
              `socialprune-${verify ? 'verify' : 'delete'}-${run.runId}.json`,
            ),
            'utf8',
          ),
        ),
      ).toMatchObject({
        stop: { code: 'PLATFORM_CHECK', reason: 'marker-login' },
      });
    } finally {
      await h.close();
    }
  },
);

test('D6 point 1 not-found starts do not fill the confirmed-deletion batch', async () => {
  const h = await harness();
  try {
    const writer = h.store.browserOutcomeWriter(),
      at = new Date(Date.parse(FIXTURE.now) - 1000).toISOString();
    const run = {
      runId: 'prior-batch',
      platform: 'x' as const,
      accountKey: FIXTURE.account.key,
      mode: 'delete' as const,
      planHash: 'a'.repeat(64),
      startedAt: at,
      endedAt: null,
      endReason: null,
      bodyShapes: {},
      profileReport: null,
    };
    await writer.begin(run);
    for (let i = 0; i < 19; i++)
      await writer.record({
        attemptId: `prior-${i}`,
        runId: run.runId,
        itemId: 'x:1005',
        action: 'delete-post',
        state: 'not-found',
        settles: null,
        at,
        code: null,
      });
    await writer.finish({ ...run, endedAt: at, endReason: 'done' });
    expect(await h.run()).toMatchObject({ endReason: 'done' });
    expect(h.waits).toEqual([29000, 30000]);
  } finally {
    await h.close();
  }
});

test('D6 point 4 shared fill delete and verify page counts use the workspace day boundary', async () => {
  const h = await harness();
  try {
    for (const [index, mode] of ['fill', 'delete', 'verify'].entries()) {
      const at = '2026-10-10T23:30:00.000Z';
      await h.store.write((tx) =>
        tx.browserRuns.add({
          runId: `zone-${mode}`,
          platform: 'x',
          accountKey: FIXTURE.account.key,
          mode: mode as 'fill' | 'delete' | 'verify',
          planHash: null,
          startedAt: at,
          endedAt: at,
          endReason: 'done',
          bodyShapes: {},
          profileReport: null,
          pageOpens: index + 1,
          lastPageOpenedAt: at,
        }),
      );
    }
    expect(
      await dailyCount(
        h.store,
        FIXTURE.account.key,
        'delete',
        '2026-10-11',
        'UTC',
      ),
    ).toBe(0);
    expect(
      await dailyCount(
        h.store,
        FIXTURE.account.key,
        'delete',
        '2026-10-11',
        'Europe/Berlin',
      ),
    ).toBe(6);
  } finally {
    await h.close();
  }
});

test.each(['report', 'final-view', 'close'] as const)(
  'D6 point 2 a late %s error durably resets the clean hundred',
  async (fault) => {
    const h = await harness();
    try {
      if (fault === 'report')
        vi.spyOn(profileReports, 'writeExtensionReport').mockRejectedValueOnce(
          new Error('Generated report fault'),
        );
      if (fault === 'final-view')
        h.session.finish = () => {
          throw new Error('Generated view fault');
        };
      if (fault === 'close') {
        h.session.confirmation = () =>
          Promise.resolve({
            url: 'app://socialprune/',
            launchUrl: 'app://socialprune/',
            stopped: false,
            update() {},
            wait: () => Promise.resolve(true),
            onStop() {},
            close: () => Promise.reject(new Error('Generated close fault')),
          });
      }
      await expect(h.run(false, false, true)).rejects.toBeDefined();
      const journal = await h.store.browserJournal();
      expect(journal.runs.at(-1)).toMatchObject({
        endReason: 'error',
      });
      expect(typeof journal.runs.at(-1)!.endedAt).toBe('string');
      expect(cleanDeletions(journal, FIXTURE.account.key)).toBe(0);
    } finally {
      vi.restoreAllMocks();
      await h.close();
    }
  },
);

test('D6 point 3 a warning refuses the next deletion before browser confirmation on the same day and requires a card the next day', async () => {
  const h = await harness();
  try {
    await expect(
      h.run(
        false,
        new CliError(
          'PLATFORM_CHECK',
          undefined,
          undefined,
          'marker-rate-limit',
        ),
      ),
    ).rejects.toMatchObject({ code: 'PLATFORM_CHECK' });
    const warned = (await h.store.browserJournal()).runs.at(-1)!;
    h.session.confirmation = () => {
      throw new Error('Must refuse before confirmation');
    };
    await expect(h.run()).rejects.toMatchObject({ code: 'X_WARNING_DAY' });
    h.setNow('2026-10-12T12:00:00.000Z');
    await expect(h.run()).rejects.toMatchObject({
      code: 'X_WARNING_CARD_REQUIRED',
    });
    expect(h.notices.join('')).toContain(warned.runId);
  } finally {
    await h.close();
  }
});

test.each([
  'focal-count',
  'render-timeout',
  'extensions-changed',
  'marker-login',
  'marker-challenge',
])(
  'D7 A non-warning stop %s permits a same-day deletion start',
  async (reason) => {
    const h = await harness();
    try {
      await expect(
        h.run(
          false,
          new CliError('PLATFORM_CHECK', undefined, undefined, reason),
        ),
      ).rejects.toMatchObject({ code: 'PLATFORM_CHECK' });
      expect(
        await h.store.browserOutcomeWriter().xWarning(FIXTURE.account.key),
      ).toBeNull();
      const confirmation = vi.fn(h.session.confirmation.bind(h.session));
      h.session.confirmation = confirmation;
      await expect(h.run()).resolves.toMatchObject({ endReason: 'done' });
      expect(confirmation).toHaveBeenCalledOnce();
    } finally {
      await h.close();
    }
  },
);

test.each(['ACCOUNT_MISMATCH', 'PAGE_LANGUAGE', 'PROFILE_INVALID'] as const)(
  'D7 A %s stops without a warning-day gate',
  async (code) => {
    const h = await harness();
    try {
      await expect(h.run(false, new CliError(code))).rejects.toBeDefined();
      expect(
        await h.store.browserOutcomeWriter().xWarning(FIXTURE.account.key),
      ).toBeNull();
      await expect(h.run()).resolves.toMatchObject({ endReason: 'done' });
    } finally {
      await h.close();
    }
  },
);

test.each([FIXTURE.now, '2026-10-11T22:00:00.000Z'])(
  'D6 point 1 nineteen confirmed deletions carry across runs at %s, but verification does not fill their batch',
  async (now) => {
    const h = await harness();
    h.setNow(now);
    const writer = h.store.browserOutcomeWriter();
    const at = new Date(Date.parse(now) - 1000).toISOString();
    const run = {
      runId: 'confirmed-batch',
      platform: 'x' as const,
      accountKey: FIXTURE.account.key,
      mode: 'delete' as const,
      planHash: 'a'.repeat(64),
      startedAt: at,
      endedAt: null,
      endReason: null,
      bodyShapes: {},
      profileReport: null,
    };
    try {
      await writer.begin(run);
      for (let i = 0; i < 19; i++) {
        const sending = {
          attemptId: `batch-send-${i}`,
          runId: run.runId,
          itemId: 'x:1005',
          action: 'delete-post' as const,
          state: 'sending' as const,
          settles: null,
          at,
          code: null,
        };
        await h.store.write(async (tx) => {
          let seq = 1;
          for await (const attempt of tx.browserAttempts.iterate())
            seq = Math.max(seq, attempt.seq + 1);
          await tx.browserAttempts.add({ ...sending, seq });
        });
        await writer.settle({
          ...sending,
          attemptId: `batch-done-${i}`,
          state: 'deleted',
          settles: sending.attemptId,
          receipt: {
            method: 'POST',
            path: '/i/api/graphql/generated/DeleteTweet',
            status: 200,
            shape: ['data'],
          },
        });
      }
      await writer.finish({ ...run, endedAt: at, endReason: 'done' });
      await writer.begin({
        ...run,
        runId: 'batch-verify',
        mode: 'verify',
        planHash: null,
      });
      await writer.record({
        attemptId: 'verify-batch-decoy',
        runId: 'batch-verify',
        itemId: 'x:1005',
        action: 'verify',
        state: 'still-gone',
        settles: null,
        at,
        code: null,
      });
      await writer.finish({
        ...run,
        runId: 'batch-verify',
        mode: 'verify',
        planHash: null,
        endedAt: at,
        endReason: 'done',
      });
      expect(await h.run(false, false, true)).toMatchObject({
        completed: 2,
        endReason: 'done',
      });
      expect(h.waits).toEqual([29000, 900000]);
    } finally {
      await h.close();
    }
  },
);

test('D2 unknown error values never enter stop detail or its durable structure report', async () => {
  const h = await harness();
  const privateValue = 'generated private account and path';
  try {
    await expect(h.run(false, new Error(privateValue))).rejects.toMatchObject({
      code: 'RUN_STOPPED',
    });
    expect(h.notices).toContain('Stop detail: other\n');
    expect(h.notices.join('')).not.toContain(privateValue);
    const run = (await h.store.browserJournal()).runs.at(-1)!;
    const report = await readFile(
      join(h.profile, `socialprune-delete-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(report)).toMatchObject({ stop: { code: 'other' } });
    expect(report).not.toContain(privateValue);
  } finally {
    await h.close();
  }
});
