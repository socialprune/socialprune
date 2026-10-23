import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { fixtureWorkspace, FIXTURE } from '../../e2e/fake-x/fixture.ts';
import { createProfile } from './profile.ts';
import { runWithDependencies } from './runner.ts';
import { planDeletion } from './plan.ts';
import { CliError } from '../cli/errors.ts';
import { RunControls } from './run-controls.ts';
import type { RunSession } from './run-session.ts';

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
    async run(verify = false, fail: boolean | Error = false) {
      return runWithDependencies(
        {
          store,
          profile,
          plan: await planDeletion(store, FIXTURE.account.key),
          executablePath: 'generated',
          verify,
          list: '',
          lang: 'en',
          signal: new AbortController().signal,
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
              account: () => Promise.resolve(FIXTURE.account.handle),
              inspect: () => {
                if (fail instanceof Error) throw fail;
                if (fail)
                  throw new CliError(
                    'PLATFORM_CHECK',
                    undefined,
                    undefined,
                    'marker-login',
                  );
                return Promise.resolve('gone' as const);
              },
              delete: () => Promise.reject(new Error('Must not delete')),
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

test('D2 runner carries nineteen earlier entry starts into the twentieth and pauses before twenty-one', async () => {
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
    expect(h.waits).toEqual([29000, 900000]);
  } finally {
    await h.close();
  }
});

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
