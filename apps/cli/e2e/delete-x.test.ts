import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, expect, test, vi } from 'vitest';
import * as profileReports from '../src/browser/profile.ts';
import { acknowledgeWarningCard } from '../src/commands/delete.ts';
import { chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { SQLiteStore } from '../src/workspace/sqlite-store.ts';
import { createProfile, profileInUse } from '../src/browser/profile.ts';
import { planDeletion } from '../src/browser/plan.ts';
import { runWithDependencies } from '../src/browser/runner.ts';
import { pageDriver } from '../src/browser/x/driver.ts';
import { fixtureWorkspace, FIXTURE } from './fake-x/fixture.ts';
import { fakeX } from './fake-x/server.ts';
import { TEST_PORTS, TEST_ORIGINS } from '../playwright.ports.config.ts';
import { DatabaseSync } from 'node:sqlite';
import {
  createBackup,
  restoreBackup,
} from '@socialprune/core/workspace/backup';
import {
  createWorkspace,
  OriginalsFillWriter,
  records,
} from '@socialprune/core/workspace/store';
import { migrateOriginal, WORKSPACE_SCHEMA_VERSION } from '@socialprune/core';
import type { InstagramContext, Item, WorkspaceV2 } from '@socialprune/core';
import {
  writeInstagramContextContract,
  STORE_CONTRACT_CHECKS,
} from '@socialprune/core/workspace/store-contract';
import { InstagramContextWriter } from '@socialprune/core/workspace/instagram-context-writer';

let fake: Awaited<ReturnType<typeof fakeX>>;
beforeAll(async () => {
  fake = await fakeX();
});
afterAll(async () => {
  await fake.close();
});

async function harness(
  ids: readonly string[] = ['1001', '1002', '1003', '1004'],
  missingAccount = false,
) {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-fake-x-'));
  const profile = join(directory, 'profile');
  await mkdir(profile);
  await createProfile(profile);
  const preinstalledId = 'a'.repeat(32);
  await mkdir(join(profile, 'Default', 'Extensions', preinstalledId, '1.0'), {
    recursive: true,
  });
  await writeFile(
    join(
      profile,
      'Default',
      'Extensions',
      preinstalledId,
      '1.0',
      'manifest.json',
    ),
    'Generated contents that must never be read',
  );
  const workspace = fixtureWorkspace(ids);
  if (missingAccount) {
    const expected = JSON.parse(
      await readFile(
        fileURLToPath(
          new URL(
            '../../../fixtures/synthetic/x/missing-account/expected.json',
            import.meta.url,
          ),
        ),
        'utf8',
      ),
    ) as { items: { account: { key: string; handle: null } }[] };
    workspace.items.forEach((item) => {
      item.account = { ...expected.items[0]!.account };
    });
    workspace.imports[0]!.accounts = [{ ...expected.items[0]!.account }];
  }
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: workspace,
  });
  let context: BrowserContext | undefined;
  let now = new Date(FIXTURE.now).getTime();
  const waits: number[] = [];
  const notices: string[] = [];
  const network: string[] = [];
  const launchUrls: string[] = [];
  let changeBeforeSend = false;
  let extensionAfterInspect = false;
  let mutateBeforeSend = false;
  let removePreinstalled = false,
    holdClose = false,
    closeWaiting = false;
  let finishClose: () => void = () => {};
  const closeGate = new Promise<void>((resolve) => {
    finishClose = resolve;
  });
  fake.variants.clear();
  fake.gone.clear();
  fake.requests.length = 0;
  fake.rateHeaders.clear();
  fake.setHandle(FIXTURE.account.handle);
  fake.setLanguage(false);
  fake.setAccessibleOnly(false);
  fake.renderOptions({});
  const plan = await planDeletion(
    store,
    workspace.items[0]!.account.key,
    new Set(),
    new Date(now),
  );
  let started!: () => void;
  let virtualWaits = false;
  let shown = new Promise<void>((resolve) => {
    started = resolve;
  });
  const controller = new AbortController();
  const active = new Set<Promise<unknown>>();
  const launch = (
    verify = false,
    pace = { intervalMs: 100, batchSize: 20, pauseMs: 100, perDay: 200 },
    handle?: string,
    lang: 'en' | 'de' = 'en',
  ) => {
    shown = new Promise<void>((resolve) => {
      started = resolve;
    });
    const running = runWithDependencies(
      {
        store,
        plan: handle === undefined ? plan : { ...plan, handle },
        profile,
        executablePath: chromium.executablePath(),
        verify,
        list: 'generated full list',
        lang,
        signal: controller.signal,
        now: () => new Date(now),
        notice: (text) => notices.push(text),
      },
      {
        pace,
        confirmationPort: TEST_PORTS.confirmation,
        async sleep(ms, signal) {
          waits.push(ms);
          if (signal.aborted) throw new Error('Aborted');
          await new Promise((resolve) =>
            setTimeout(resolve, virtualWaits ? 1 : ms),
          );
          now += ms;
        },
        async driver(options) {
          await context?.close();
          context = await chromium.launchPersistentContext(profile, {
            executablePath: chromium.executablePath(),
            headless: true,
            chromiumSandbox: true,
            args: ['--enable-automation'],
            ignoreDefaultArgs: ['--disable-infobars'],
            serviceWorkers: 'block',
          });
          if (removePreinstalled)
            await rm(join(profile, 'Default', 'Extensions'), {
              recursive: true,
              force: true,
            });
          expect(await profileInUse(profile)).toBe(true);
          const probe = await context.newCDPSession(context.pages()[0]!);
          const command = await probe.send('Browser.getBrowserCommandLine');
          expect(command.arguments).not.toContain('--no-sandbox');
          expect(command.arguments).toContain('--disable-extensions');
          expect(command.arguments).not.toContain('--disable-infobars');
          expect(command.arguments).toContain('--enable-automation');
          expect(command.arguments).toContain('--remote-debugging-pipe');
          expect(
            await context.pages()[0]!.evaluate(() => navigator.webdriver),
          ).toBe(true);
          await probe.detach();
          context.on('request', (request) => network.push(request.url()));
          const driver = await pageDriver({
            context,
            origin: fake.origin,
            allowedOrigins: [fake.origin],
            confirmationOrigin: options.confirmationOrigin,
            responseTimeoutMs: 5_000,
            signal: options.signal,
            record: (request) => options.record(request),
            now: options.now,
            onRateLimit: options.onRateLimit,
            onWindow: options.onWindow,
          });
          return {
            ...driver,
            // The harness owns context teardown after awaited human clicks.
            // Production waits for the person to close the visible window.
            async close() {
              closeWaiting = true;
              if (holdClose) await closeGate;
            },
            async inspect(id) {
              const result = await driver.inspect(id);
              if (extensionAfterInspect) {
                extensionAfterInspect = false;
                await mkdir(
                  join(profile, 'Default', 'Extensions', 'b'.repeat(32), '1.0'),
                  { recursive: true },
                );
              }
              if (changeBeforeSend) {
                changeBeforeSend = false;
                await store.write(async (tx) => {
                  const state = (await tx.state.get(`x:${id}`))!,
                    runtime = await tx.runtime.get();
                  await tx.decisionEvents.append([
                    {
                      eventId: 'fixture-withdrawn',
                      seq: runtime.lastEventSeq + 1,
                      itemId: `x:${id}`,
                      value: 'keep',
                      previous: 'delete',
                      decidedAt: FIXTURE.now,
                      source: { kind: 'human', via: 'local-review' },
                      action: {
                        id: 'fixture-withdraw-action',
                        kind: 'single',
                        size: 1,
                        reverts: null,
                      },
                    },
                  ]);
                  await tx.state.put({ ...state, decision: 'keep' });
                  await tx.runtime.set({ revision: runtime.revision + 1 });
                });
              }
              if (mutateBeforeSend) {
                mutateBeforeSend = false;
                await store.write(async (tx) => {
                  const item = (await tx.items.get(`x:${id}`))!;
                  await tx.items.put({
                    ...item,
                    item: { ...item.item, text: 'Changed generated plan text' },
                  });
                });
              }
              return result;
            },
            async showConfirmation(url) {
              launchUrls.push(url);
              await driver.showConfirmation(url);
              started();
            },
          };
        },
      },
    );
    active.add(running);
    void running.then(
      () => active.delete(running),
      () => active.delete(running),
    );
    return running;
  };
  const local = async (): Promise<Page> => {
    await shown;
    return context!
      .pages()
      .find((page) => page.url().startsWith(TEST_ORIGINS.confirmation))!;
  };
  const click = async (name: 'Start' | 'Continue' | 'Stop') => {
    const page = await local();
    const button = page.getByRole('button', { name, exact: true });
    await button.waitFor({ state: 'visible' });
    await button.click();
  };
  return {
    directory,
    profile,
    store,
    plan,
    waits,
    virtualWaits() {
      virtualWaits = true;
    },
    notices,
    network,
    launchUrls,
    launch,
    local,
    click,
    async removeExtensionsOnLaunch() {
      await mkdir(
        join(profile, 'Default', 'Extensions', 'b'.repeat(32), '1.0'),
        { recursive: true },
      );
      removePreinstalled = true;
    },
    holdWindowOpen() {
      holdClose = true;
    },
    get waitingForClose() {
      return closeWaiting;
    },
    finishWindow() {
      finishClose();
    },
    changeBeforeSend() {
      changeBeforeSend = true;
    },
    extensionAfterInspect() {
      extensionAfterInspect = true;
    },
    mutateBeforeSend() {
      mutateBeforeSend = true;
    },
    abort() {
      controller.abort();
    },
    setNow(value: string) {
      now = Date.parse(value);
    },
    async close() {
      finishClose();
      controller.abort();
      await context?.close();
      await Promise.allSettled([...active]);
      try {
        await expect
          .poll(() => profileInUse(profile), { timeout: 10000 })
          .toBe(false);
      } finally {
        await store.close();
        await rm(directory, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      }
    },
  };
}

test('foundation: real fake pages, human clicks, durable journal and outcome; no platform traffic', async () => {
  const h = await harness(['1001']);
  try {
    const running = h.launch();
    await h.local();
    await expect
      .poll(async () => (await h.local()).locator('#account').textContent())
      .toBe(`Expected X account: @${FIXTURE.account.handle}`);
    expect(fake.requests).toEqual([]);
    expect((await h.store.browserJournal()).runs).toEqual([]);
    await h.click('Start');
    expect(new URL((await h.local()).url()).hash).toBe('');
    await h.click('Continue');
    expect(await running).toMatchObject({ completed: 1, endReason: 'done' });
    const journal = await h.store.browserJournal();
    expect(journal.attempts.map((a) => a.state)).toEqual(
      FIXTURE.expected.oneSuccessStates,
    );
    expect(journal.runs).toHaveLength(1);
    const report = JSON.parse(
      await readFile(
        join(
          h.directory,
          'profile',
          `socialprune-readback-${journal.runs[0]!.runId}.json`,
        ),
        'utf8',
      ),
    ) as {
      extensionIdsBefore: string[];
      extensionIdsAfter: string[];
      extensionsDisabled: boolean;
    };
    expect(report).toMatchObject({
      extensionIdsBefore: ['a'.repeat(32)],
      extensionIdsAfter: ['a'.repeat(32)],
      extensionsDisabled: true,
    });
    expect(journal.runs[0]!.profileReport?.accountAfter).toBe(
      FIXTURE.account.handle,
    );
    expect(await h.store.read((tx) => tx.state.get('x:1001'))).toMatchObject({
      outcome: 'deleted-via-browser',
      decision: 'delete',
    });
    expect(
      fake.requests.filter((r) => r.method === 'POST').map((r) => r.path),
    ).toEqual(['/i/api/graphql/generated/DeleteTweet']);
    expect(
      h.network.every((url) =>
        [TEST_ORIGINS.x, TEST_ORIGINS.confirmation].includes(
          new URL(url).origin,
        ),
      ),
    ).toBe(true);
    const token = h.launchUrls[0]!.split('#bootstrap=')[1]!;
    expect(h.notices.join('')).not.toContain(token);
  } finally {
    await h.close();
  }
});

test.each([
  [26, 120, null],
  [25, 120, 125000],
  [24, 960, 965000],
  [24, 961, 'long'],
] as const)(
  'DEL-1 deletion windows reserve half (%s remaining, reset %s seconds)',
  async (remaining, seconds, expectedWait) => {
    const h = await harness(['1001', '1002']);
    h.virtualWaits();
    fake.rateHeaders.set('1001', {
      'x-rate-limit-limit': '50',
      'x-rate-limit-remaining': String(remaining),
      'x-rate-limit-reset': String(Date.parse(FIXTURE.now) / 1000 + seconds),
    });
    try {
      const running = h.launch(false, {
        intervalMs: 0,
        perDay: 200,
        pauseMs: 0,
        batchSize: 20,
      });
      await h.click('Start');
      await h.click('Continue');
      expect(await running).toMatchObject({
        completed: expectedWait === 'long' ? 1 : 2,
        endReason: expectedWait === 'long' ? 'daily-cap' : 'done',
      });
      expect(
        fake.requests.filter((r) => r.method === 'POST').map((r) => r.id),
      ).toEqual(expectedWait === 'long' ? ['1001'] : ['1001', '1002']);
      if (typeof expectedWait === 'number')
        expect(h.waits).toContain(expectedWait);
      else expect(h.waits).toEqual([]);
      if (expectedWait === 'long')
        expect(h.notices).toContain('Stop detail: x-window-long\n');
      const run = (await h.store.browserJournal()).runs[0]!;
      const report = JSON.parse(
        await readFile(
          join(h.directory, 'profile', `socialprune-delete-${run.runId}.json`),
          'utf8',
        ),
      ) as { xWindows: unknown[]; stop: unknown };
      expect(report.xWindows).toContainEqual({
        operation: 'DeleteTweet',
        limit: 50,
        lowestRemaining: remaining,
        responses: 1,
        longestResetSeconds: seconds,
      });
    } finally {
      await h.close();
    }
  },
);

test.each(['429', 'side-429', 'unconfirmed'] as const)(
  'DEL-1 first %s stops with a closed detail and no second request',
  async (variant) => {
    const h = await harness(['1001', '1002']);
    fake.variants.set('1001', variant);
    try {
      const running = h.launch().catch((error: unknown) => error);
      await h.click('Start');
      expect(await running).toMatchObject(
        variant === 'unconfirmed'
          ? { code: 'DELETE_FAILED' }
          : { code: 'PLATFORM_CHECK', reason: 'http-429' },
      );
      const journal = await h.store.browserJournal();
      expect(fake.requests.some((r) => r.id === '1002')).toBe(false);
      expect(journal.attempts.map((a) => a.state)).toEqual(
        variant === 'side-429' ? [] : ['sending', 'ambiguous'],
      );
      expect(journal.runs[0]!.endReason).toBe(
        variant === 'unconfirmed' ? 'error' : 'platform-check',
      );
      expect(h.notices).toContain(
        `Stop detail: ${variant === 'unconfirmed' ? 'DELETE_FAILED' : 'http-429'}\n`,
      );
    } finally {
      await h.close();
    }
  },
);

test.each(['unconfirmed', 'after-click-limit'] as const)(
  'D2 after final click %s is ambiguous, blocks resend and is settled only by verify',
  async (variant) => {
    const h = await harness(['1001', '1002']);
    fake.variants.set('1001', variant);
    try {
      const running = h.launch().catch((error: unknown) => error);
      await h.click('Start');
      expect(await running).toMatchObject(
        variant === 'unconfirmed'
          ? { code: 'DELETE_FAILED' }
          : { code: 'PLATFORM_CHECK', reason: 'marker-rate-limit' },
      );
      expect(
        (await h.store.browserJournal()).attempts.map(
          (attempt) => attempt.state,
        ),
      ).toEqual(['sending', 'ambiguous']);
      expect(
        (
          await planDeletion(h.store, FIXTURE.account.key, new Set(['x:1001']))
        ).rows.map((row) => row.item.id),
      ).toEqual(['x:1002']);
      expect(
        fake.requests.filter((request) => request.method === 'POST'),
      ).toHaveLength(1);
      fake.variants.clear();
      const verify = h.launch(true);
      await h.click('Start');
      expect(await verify).toMatchObject({ completed: 1, endReason: 'done' });
      expect(
        (await h.store.browserJournal()).attempts
          .slice(-2)
          .map((attempt) => attempt.state),
      ).toEqual(
        variant === 'unconfirmed'
          ? ['not-deleted', 'not-deleted']
          : ['still-gone', 'deleted'],
      );
      expect(
        fake.requests.filter((request) => request.method === 'POST'),
      ).toHaveLength(1);
    } finally {
      await h.close();
    }
  },
);

test('D2 a repost status page bearing only the original timestamp stops with focal-count before any click', async () => {
  const h = await harness(['1004']);
  fake.variants.set('1004', 'repost-original-time');
  try {
    const running = h.launch().catch((error: unknown) => error);
    await h.click('Start');
    expect(await running).toMatchObject({
      code: 'PLATFORM_CHECK',
      reason: 'focal-count',
    });
    expect((await h.store.browserJournal()).attempts).toEqual([]);
    expect(
      fake.requests.filter((request) => request.method === 'POST'),
    ).toEqual([]);
    expect(h.notices).toContain('Stop detail: focal-count\n');
  } finally {
    await h.close();
  }
});

test.each([false, true])(
  'D2 delete/verify closed stop detail and final text preserve the marker category, verify=%s',
  async (verify) => {
    const h = await harness(['1001']);
    try {
      h.holdWindowOpen();
      if (verify) {
        const writer = h.store.browserOutcomeWriter();
        const run = {
          runId: 'verify-detail-prior',
          platform: 'x' as const,
          accountKey: FIXTURE.account.key,
          mode: 'delete' as const,
          planHash: h.plan.hash,
          startedAt: FIXTURE.now,
          endedAt: null,
          endReason: null,
          bodyShapes: {},
          profileReport: null,
        };
        await writer.begin(run);
        const sending = (await writer.check(
          h.plan.rows[0]!,
          run.runId,
          FIXTURE.now,
          true,
        ))!;
        await writer.settle({
          attemptId: 'verify-detail-ambiguous',
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
      fake.variants.set('1001', 'login');
      const running = h.launch(verify).catch((error: unknown) => error);
      await h.click('Start');
      await expect.poll(() => h.waitingForClose, { timeout: 10000 }).toBe(true);
      expect(h.notices).toContain('Stop detail: marker-login\n');
      expect(h.notices.join('')).toContain(
        'X shows a sign-in, account check, lock or limit page.',
      );
      await expect
        .poll(() =>
          h.local().then((page) => page.locator('#result').innerText()),
        )
        .toContain('X shows a sign-in, account check, lock or limit page.');
      const run = (await h.store.browserJournal()).runs.at(-1)!;
      const report = JSON.parse(
        await readFile(
          join(
            h.directory,
            'profile',
            `socialprune-${verify ? 'verify' : 'delete'}-${run.runId}.json`,
          ),
          'utf8',
        ),
      ) as { stop: unknown };
      expect(report.stop).toEqual({
        code: 'PLATFORM_CHECK',
        reason: 'marker-login',
      });
      h.finishWindow();
      expect(await running).toMatchObject({
        code: 'PLATFORM_CHECK',
        reason: 'marker-login',
      });
    } finally {
      await h.close();
    }
  },
);

test('D6 point 1 not-found starts in a prior run do not trigger the deletion pause', async () => {
  const h = await harness(['1001', '1002']);
  h.virtualWaits();
  try {
    const writer = h.store.browserOutcomeWriter();
    const oldAt = new Date(Date.parse(FIXTURE.now) - 1000).toISOString();
    const prior = {
      runId: 'prior-batch',
      platform: 'x' as const,
      accountKey: FIXTURE.account.key,
      mode: 'delete' as const,
      planHash: h.plan.hash,
      startedAt: oldAt,
      endedAt: null,
      endReason: null,
      bodyShapes: {},
      profileReport: null,
    };
    await writer.begin(prior);
    for (let index = 0; index < 19; index++)
      await writer.record({
        attemptId: `batch-${index}`,
        runId: prior.runId,
        itemId: 'x:1005',
        action: 'delete-post',
        state: 'not-found',
        settles: null,
        at: oldAt,
        code: null,
      });
    await writer.finish({ ...prior, endedAt: oldAt, endReason: 'done' });
    const running = h.launch(false, {
      intervalMs: 30000,
      batchSize: 20,
      pauseMs: 900000,
      perDay: 200,
    });
    await h.click('Start');
    await h.click('Continue');
    expect(await running).toMatchObject({ completed: 2, endReason: 'done' });
    expect(h.waits).toEqual([29000, 30000]);
  } finally {
    await h.close();
  }
});

test.each(['429', 'side-429', 'limit', 'after-click-limit'] as const)(
  'D6 point 3 fake X %s persists a next-day card gate before another browser launch',
  async (variant) => {
    const h = await harness(['1001', '1002']);
    try {
      h.virtualWaits();
      fake.variants.set('1001', variant);
      const first = h.launch().catch((error: unknown) => error);
      await h.click('Start');
      expect(await first).toMatchObject({ code: 'PLATFORM_CHECK' });
      const warning = await h.store
        .browserOutcomeWriter()
        .xWarning(FIXTURE.account.key);
      expect(warning).toMatchObject({ acknowledged: false });
      const opens = h.launchUrls.length;
      const requests = fake.requests.length;
      await expect(h.launch()).rejects.toMatchObject({ code: 'X_WARNING_DAY' });
      h.setNow('2026-10-12T12:00:00.000Z');
      await expect(h.launch()).rejects.toMatchObject({
        code: 'X_WARNING_CARD_REQUIRED',
      });
      expect(h.launchUrls).toHaveLength(opens);
      expect(fake.requests).toHaveLength(requests);
      expect(h.notices.join('')).toContain(warning!.runId);
      await acknowledgeWarningCard(
        h.store,
        FIXTURE.account.key,
        warning!.runId,
        '2026-10-12T12:00:00.000Z',
        h.plan.timeZone,
        'en',
        () => Promise.resolve(`I read the card for ${warning!.runId}`),
        h.profile,
      );
      fake.variants.clear();
      Object.assign(
        h.plan,
        await planDeletion(
          h.store,
          FIXTURE.account.key,
          new Set(),
          new Date('2026-10-12T12:00:00.000Z'),
        ),
      );
      const resumed = h.launch(false, {
        intervalMs: 30000,
        batchSize: 20,
        pauseMs: 900000,
        perDay: 200,
      });
      await h.click('Start');
      await h.click('Continue');
      expect(await resumed).toMatchObject({
        completed: variant === 'limit' || variant === 'side-429' ? 2 : 1,
        endReason: 'done',
      });
      expect(
        h.notices.some((text) => text.includes('at most 200 per calendar day')),
      ).toBe(true);
    } finally {
      await h.close();
    }
  },
);

test('D6 point 2 fake X confirmed deletion plus late report failure durably resets promotion', async () => {
  const h = await harness(['1001']);
  try {
    vi.spyOn(profileReports, 'writeExtensionReport').mockRejectedValueOnce(
      new Error('Generated report failure'),
    );
    const run = h.launch().catch((error: unknown) => error);
    await h.click('Start');
    await h.click('Continue');
    expect(await run).toMatchObject({ code: 'RUN_STOPPED' });
    expect((await h.store.browserJournal()).runs.at(-1)).toMatchObject({
      endReason: 'error',
    });
    expect((await h.store.browserJournal()).attempts.at(-1)).toMatchObject({
      state: 'deleted',
    });
  } finally {
    vi.restoreAllMocks();
    await h.close();
  }
});

test('D7 A focal-count stop does not set a warning gate and a same-day corrected plan can start', async () => {
  const h = await harness(['1004']);
  try {
    fake.variants.set('1004', 'repost-original-time');
    const stopped = h.launch().catch((error: unknown) => error);
    await h.click('Start');
    expect(await stopped).toMatchObject({ code: 'PLATFORM_CHECK' });
    expect(
      await h.store.browserOutcomeWriter().xWarning(FIXTURE.account.key),
    ).toBeNull();
    fake.variants.clear();
    const resumed = h.launch();
    await h.click('Start');
    await h.click('Continue');
    expect(await resumed).toMatchObject({ completed: 1, endReason: 'done' });
  } finally {
    await h.close();
  }
});

test('D7 D a yesterday deletion plan is STALE_PLAN before any X navigation', async () => {
  const h = await harness(['1001']);
  try {
    h.setNow('2026-10-12T12:00:00.000Z');
    const stopped = h.launch().catch((error: unknown) => error);
    await h.click('Start');
    expect(await stopped).toMatchObject({ code: 'STALE_PLAN' });
    expect(fake.requests).toHaveLength(0);
  } finally {
    await h.close();
  }
});

test.each([false, true])(
  'DEL-1 clean hundred promotes the next page to 15/300 or live-window 8/500, fast=%s',
  async (fast) => {
    const ids = Array.from({ length: 102 }, (_, index) => String(2000 + index));
    const h = await harness(ids);
    h.virtualWaits();
    try {
      const writer = h.store.browserOutcomeWriter();
      const run = {
        runId: 'generated-clean-99',
        platform: 'x' as const,
        accountKey: FIXTURE.account.key,
        mode: 'delete' as const,
        planHash: h.plan.hash,
        startedAt: FIXTURE.now,
        endedAt: null,
        endReason: null,
        bodyShapes: {},
        profileReport: null,
      };
      await writer.begin(run);
      for (const row of h.plan.rows.slice(0, 99)) {
        const sending = (await writer.check(
          row,
          run.runId,
          FIXTURE.now,
          true,
        ))!;
        await writer.settle(
          {
            attemptId: `confirmed-${row.item.id}`,
            runId: run.runId,
            itemId: row.item.id,
            action: row.action,
            state: 'deleted',
            settles: sending.attemptId,
            at: FIXTURE.now,
            code: null,
            receipt: {
              method: 'POST',
              path: '/i/api/graphql/generated/DeleteTweet',
              status: 200,
              shape: ['data'],
            },
          },
          'deleted-via-browser',
        );
      }
      if (fast)
        fake.rateHeaders.set(ids[99]!, {
          'x-rate-limit-limit': '1000',
          'x-rate-limit-remaining': '900',
          'x-rate-limit-reset': String(Date.parse(FIXTURE.now) / 1000 + 1800),
        });
      // Earlier signed-in page reads consume the shared day budget as well.
      for (let page = 0; page < 199; page++)
        await writer.pageOpen(run.runId, FIXTURE.now);
      await writer.finish({ ...run, endedAt: FIXTURE.now, endReason: 'done' });
      const plan = await planDeletion(
        h.store,
        FIXTURE.account.key,
        new Set(),
        new Date(FIXTURE.now),
      );
      h.plan.rows = plan.rows;
      h.plan.hash = plan.hash;
      const running = h.launch(false, {
        intervalMs: 30000,
        perDay: 200,
        pauseMs: 900000,
        batchSize: 20,
      });
      await h.click('Start');
      await h.click('Continue');
      expect(await running).toMatchObject({ completed: 3, endReason: 'done' });
      expect(h.waits).toEqual(
        fast ? [900000, 8000, 8000] : [900000, 15000, 15000],
      );
      expect(
        h.notices.some((text) =>
          text.includes(
            fast
              ? 'at most 500 per calendar day'
              : 'at most 300 per calendar day',
          ),
        ),
      ).toBe(true);
      expect(
        (await h.store.browserJournal()).attempts.filter(
          (a) => a.state === 'deleted',
        ),
      ).toHaveLength(102);
    } finally {
      await h.close();
    }
  },
);

test('a disabled browser can remove two preinstalled extension IDs and the run still reaches X', async () => {
  const h = await harness(['1001']);
  try {
    await h.removeExtensionsOnLaunch();
    const result = h.launch().then(
      (value) => value,
      (error) => error as unknown,
    );
    await h.click('Start');
    await expect
      .poll(
        async () => (await h.store.browserJournal()).attempts.at(-1)?.state,
        { timeout: 10000 },
      )
      .toBe('deleted');
    await h.click('Continue');
    expect(await result).toMatchObject({ completed: 1, endReason: 'done' });
    const run = (await h.store.browserJournal()).runs.at(-1)!;
    const report = JSON.parse(
      await readFile(
        join(h.directory, 'profile', `socialprune-readback-${run.runId}.json`),
        'utf8',
      ),
    ) as { extensionIdsRemoved: string[]; extensionIdsAdded: string[] };
    expect(report.extensionIdsRemoved).toEqual([
      'a'.repeat(32),
      'b'.repeat(32),
    ]);
    expect(report.extensionIdsAdded).toEqual([]);
  } finally {
    await h.close();
  }
});

test('German stop state remains served and terminal explains the end before waiting for window closure', async () => {
  const h = await harness(['1001']);
  try {
    h.holdWindowOpen();
    fake.variants.set('1001', 'login');
    const result = h.launch(false, undefined, undefined, 'de').then(
      (value) => value,
      (error) => error as unknown,
    );
    let returned = false;
    void result.then(() => {
      returned = true;
    });
    const page = await h.local();
    await expect
      .poll(() => page.locator('html').getAttribute('lang'))
      .toBe('de');
    expect(await page.locator('#start').innerText()).toBe('Start');
    expect(await page.locator('#continue').innerText()).toBe('Weiter');
    expect(await page.locator('#matches').innerText()).toBe('Passt');
    expect(await page.locator('#does-not-match').innerText()).toBe(
      'Passt nicht',
    );
    expect(await page.locator('#stop').innerText()).toBe('Stopp');
    expect(await page.locator('#account').innerText()).toBe(
      `Erwartetes X-Konto: @${FIXTURE.account.handle}`,
    );
    expect(await page.locator('#counts').innerText()).toContain('geplant');
    const screens = join(tmpdir(), 'socialprune-screens');
    await mkdir(screens, { recursive: true });
    await page.screenshot({
      path: join(screens, 'confirmation-de-start.png'),
      fullPage: true,
      caret: 'initial',
    });
    await page.locator('#start').click();
    await expect.poll(() => h.waitingForClose, { timeout: 10000 }).toBe(true);
    expect(returned).toBe(false);
    expect(h.notices.join('')).toContain('X zeigt eine Seite zum Anmelden');
    expect(h.notices.join('')).toContain('Schließe das X-Fenster');
    await expect
      .poll(() => page.locator('#result').innerText())
      .toContain('Beendet');
    expect(await page.locator('#result').innerText()).not.toContain(
      'Session ended',
    );
    const response = await page.request.get(page.url());
    expect(response.status()).toBe(200);
    await page.screenshot({
      path: join(screens, 'confirmation-de-ended.png'),
      fullPage: true,
      caret: 'initial',
    });
    h.finishWindow();
    expect(await result).toMatchObject({ code: 'PLATFORM_CHECK' });
  } finally {
    await h.close();
  }
});

test('English final state and stderr survive a platform stop until the person closes the context', async () => {
  const h = await harness(['1001']);
  try {
    h.holdWindowOpen();
    fake.variants.set('1001', 'login');
    const result = h.launch().then(
      (value) => value,
      (error) => error as unknown,
    );
    let returned = false;
    void result.then(() => {
      returned = true;
    });
    await h.click('Start');
    await expect.poll(() => h.waitingForClose, { timeout: 10000 }).toBe(true);
    expect(returned).toBe(false);
    expect(h.notices.join('')).toContain('Close the X window to finish.');
    const page = await h.local();
    await expect
      .poll(() => page.locator('#result').innerText())
      .toContain('X shows a sign-in, account check, lock or limit page.');
    expect((await page.request.get(page.url())).status()).toBe(200);
    h.finishWindow();
    expect(await result).toMatchObject({ code: 'PLATFORM_CHECK' });
  } finally {
    await h.close();
  }
});

for (const verify of [false, true])
  test(`flag account name mismatch stops ${verify ? 'verify' : 'delete'} before reading a post or deleting`, async () => {
    const h = await harness(['1001'], true);
    try {
      expect(h.plan.handle).toBe('');
      const expected = FIXTURE.account.handle;
      fake.setHandle(FIXTURE.rows[0].via.replace('-', '_'));
      const running = h
        .launch(verify, undefined, expected)
        .catch((error: unknown) => error);
      await h.local();
      await expect
        .poll(async () => (await h.local()).locator('#account').textContent(), {
          timeout: 10000,
        })
        .toBe(`Expected X account: @${expected}`);
      expect(fake.requests).toEqual([]);
      await h.click('Start');
      expect(await running).toMatchObject({ code: 'ACCOUNT_MISMATCH' });
      expect(
        fake.requests.filter((request) => request.path !== '/home'),
      ).toEqual([]);
      const journal = await h.store.browserJournal();
      expect(journal.attempts).toEqual([]);
      expect(journal.runs.at(-1)?.pageOpens ?? 0).toBe(0);
      expect(journal.runs.at(-1)?.endedAt).not.toBeNull();
    } finally {
      await h.close();
    }
  });

test('posts and reposts each require watched canaries, pace, batch pause and no duplicates on resume', async () => {
  const h = await harness();
  try {
    const running = h.launch(false, {
      intervalMs: 120,
      batchSize: 2,
      pauseMs: 180,
      perDay: 200,
    });
    await h.click('Start');
    await h.click('Continue');
    // Repost is the second canary, even though the other entries are older.
    await h.click('Continue');
    expect(await running).toMatchObject({
      completed: FIXTURE.expected.deleted,
      endReason: 'done',
    });
    const journal = await h.store.browserJournal();
    expect(journal.attempts.map((a) => a.state)).toEqual(
      FIXTURE.expected.successStates,
    );
    expect(
      journal.attempts
        .filter((a) => a.state === 'sending')
        .map((a) => a.itemId),
    ).toEqual(FIXTURE.expected.canaryOrder);
    const sends = journal.attempts.filter((a) => a.state === 'sending');
    for (let i = 1; i < sends.length; i++)
      expect(
        Date.parse(sends[i]!.at) - Date.parse(sends[i - 1]!.at),
      ).toBeGreaterThanOrEqual(120);
    const postRequests = fake.requests.filter((r) => r.method === 'POST');
    for (let i = 1; i < postRequests.length; i++)
      expect(
        postRequests[i]!.at - postRequests[i - 1]!.at,
      ).toBeGreaterThanOrEqual(100);
    expect(h.waits).toContain(180);
    expect(
      await h.store.read(async (tx) => {
        let count = 0;
        for await (const _event of tx.decisionEvents.iterate()) {
          void _event;
          count++;
        }
        return count;
      }),
    ).toBe(4);
    expect((await planDeletion(h.store, FIXTURE.account.key)).rows).toEqual([]);
    expect(
      fake.requests.filter((r) => r.path.endsWith('DeleteRetweet')),
    ).toHaveLength(1);
  } finally {
    await h.close();
  }
});

test('sending transaction withdraws a decision changed after navigating but before any click', async () => {
  const h = await harness(['1001']);
  try {
    const running = h.launch();
    h.changeBeforeSend();
    await h.click('Start');
    expect(await running).toMatchObject({ completed: 0, endReason: 'done' });
    expect(
      (await h.store.browserJournal()).attempts.map((a) => a.state),
    ).toEqual(FIXTURE.expected.withdrawnStates);
    expect(fake.requests.filter((r) => r.method === 'POST')).toEqual([]);
  } finally {
    await h.close();
  }
});

test.each([
  'login',
  'challenge',
  'lock',
  'limit',
  'unknown',
  'wrong-id',
] as const)(
  'PLATFORM_CHECK stops on generated %s decoy before any deletion request',
  async (variant) => {
    const h = await harness(['1001', '1002']);
    fake.variants.set('1001', variant);
    try {
      const running = h.launch().then(
        (value) => value,
        (error) => error as unknown,
      );
      await h.click('Start');
      expect(await running).toMatchObject({ code: 'PLATFORM_CHECK' });
      const journal = await h.store.browserJournal();
      expect(journal.runs[0]!.endReason).toBe('platform-check');
      expect(journal.attempts).toEqual([]);
      expect(fake.requests.filter((r) => r.method === 'POST')).toEqual([]);
      expect(fake.requests.some((r) => r.id === '1002')).toBe(false);
    } finally {
      await h.close();
    }
  },
);

test.each(['errors', '500', 'ambiguous'] as const)(
  'first %s response stops without sending another entry or automatic resend',
  async (variant) => {
    const h = await harness(['1001', '1002']);
    fake.variants.set('1001', variant);
    try {
      const running = h.launch().then(
        (value) => value,
        (error) => error as unknown,
      );
      await h.click('Start');
      expect(await running).toMatchObject({ code: 'RUN_STOPPED' });
      const journal = await h.store.browserJournal();
      expect(journal.attempts.map((a) => a.state)).toEqual(
        FIXTURE.expected.ambiguousStates,
      );
      expect(fake.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
      expect(fake.requests.some((r) => r.id === '1002')).toBe(false);
      const next = await planDeletion(
        h.store,
        FIXTURE.account.key,
        new Set(['x:1001']),
      );
      if (variant === 'ambiguous')
        expect(next.rows.map((row) => row.item.id)).toEqual(['x:1002']);
    } finally {
      await h.close();
    }
  },
);

test('shape lock stops a later success body with different keys', async () => {
  const h = await harness(['1001', '1002', '1003']);
  fake.variants.set('1002', 'shape');
  try {
    const running = h.launch().then(
      (value) => value,
      (error) => error as unknown,
    );
    await h.click('Start');
    await h.click('Continue');
    expect(await running).toMatchObject({ code: 'RUN_STOPPED' });
    const journal = await h.store.browserJournal();
    expect(journal.attempts.map((a) => a.state)).toEqual([
      'sending',
      'deleted',
      'sending',
      'ambiguous',
    ]);
    expect(journal.attempts.at(-1)!.code).toBe('SHAPE_CHANGED');
    expect(journal.runs[0]!.bodyShapes['delete-post']).toEqual([
      'data',
      'data.delete_result',
      'data.delete_result.id',
    ]);
    expect(fake.requests.some((r) => r.id === '1003')).toBe(false);
  } finally {
    await h.close();
  }
});

test.each([true, false])(
  'verify reads ambiguous attempt and settles gone=%s without any clicks',
  async (gone) => {
    const h = await harness(['1001']);
    fake.variants.set('1001', 'ambiguous');
    try {
      const failed = h.launch().then(
        (value) => value,
        (error) => error as unknown,
      );
      await h.click('Start');
      await failed;
      if (gone) fake.gone.add('1001');
      else fake.variants.delete('1001');
      const beforePosts = fake.requests.filter(
        (r) => r.method === 'POST',
      ).length;
      const verified = h.launch(true);
      await h.click('Start');
      expect(await verified).toMatchObject({ completed: 1, endReason: 'done' });
      expect(fake.requests.filter((r) => r.method === 'POST')).toHaveLength(
        beforePosts,
      );
      const journal = await h.store.browserJournal();
      expect(journal.attempts.map((a) => a.state)).toEqual(
        gone
          ? ['sending', 'ambiguous', 'still-gone', 'deleted']
          : ['sending', 'ambiguous', 'not-deleted', 'not-deleted'],
      );
      expect(journal.attempts.at(-1)!.settles).toBe(
        journal.attempts[1]!.attemptId,
      );
      expect(await h.store.read((tx) => tx.state.get('x:1001'))).toMatchObject({
        outcome: gone ? 'deleted-via-browser' : 'unknown',
      });
      expect(
        (await planDeletion(h.store, FIXTURE.account.key)).rows.map(
          (row) => row.item.id,
        ),
      ).toEqual(gone ? [] : ['x:1001']);
    } finally {
      await h.close();
    }
  },
);

test.each([true, false])(
  'seven-day verify records reappearance=%s; earlier passes do not inspect it',
  async (reappeared) => {
    const h = await harness(['1001']);
    try {
      const deleted = h.launch();
      await h.click('Start');
      await h.click('Continue');
      await deleted;
      h.setNow('2026-10-17T12:00:00.000Z');
      const tooSoon = h.launch(true);
      await h.click('Start');
      expect(await tooSoon).toMatchObject({ completed: 0 });
      const before = fake.requests.filter((r) =>
        r.path.includes('/status/'),
      ).length;
      h.setNow('2026-10-18T12:00:00.000Z');
      if (reappeared) fake.gone.delete('1001');
      const verified = h.launch(true);
      await h.click('Start');
      expect(await verified).toMatchObject({ completed: 1 });
      expect(
        fake.requests.filter((r) => r.path.includes('/status/')),
      ).toHaveLength(before + 1);
      expect((await h.store.browserJournal()).attempts.at(-1)!.state).toBe(
        reappeared ? 'reappeared' : 'still-gone',
      );
      expect(await h.store.read((tx) => tx.state.get('x:1001'))).toMatchObject({
        outcome: reappeared ? 'unknown' : 'deleted-via-browser',
      });
    } finally {
      await h.close();
    }
  },
);

test('daily cap counts earlier attempts in the workspace calendar day', async () => {
  const h = await harness(['1001', '1002']);
  try {
    const expected = JSON.parse(
      await readFile(
        new URL(
          '../../../fixtures/synthetic/instagram/current-minimal/expected.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as { items: Item[] };
    const context = await writeInstagramContextContract(
      h.store,
      expected.items[0],
      FIXTURE.now,
    );
    const writer = new InstagramContextWriter(h.store);
    await writer.startRun({
      runId: 'instagram-many-steps',
      accountKey: context.accountKey,
      planHash: 'f'.repeat(64),
      startedAt: FIXTURE.now,
    });
    for (let step = 0; step < 200; step++)
      await writer.step('instagram-many-steps', FIXTURE.now);
    await writer.endRun({
      runId: 'instagram-many-steps',
      endedAt: FIXTURE.now,
      endReason: 'daily-cap',
      bodyShapes: {},
      profileReport: {
        accountBefore: expected.items[0]!.account.handle,
        accountAfter: expected.items[0]!.account.handle,
        extensionsBefore: 0,
        extensionsAfter: 0,
        changedFiles: [],
        unexpectedRequests: [],
      },
    });
    const instagramBefore = (
      await h.store.read((tx) => records(tx.browserRuns))
    ).filter((run) => run.platform === 'instagram');
    const first = h.launch(false, {
      intervalMs: 100,
      batchSize: 20,
      pauseMs: 100,
      perDay: 1,
    });
    await h.click('Start');
    await h.click('Continue');
    expect(await first).toMatchObject({ completed: 1, endReason: 'daily-cap' });
    const refreshed = await planDeletion(
      h.store,
      FIXTURE.account.key,
      new Set(),
      new Date(FIXTURE.now),
    );
    h.plan.rows = refreshed.rows;
    h.plan.hash = refreshed.hash;
    const second = h.launch(false, {
      intervalMs: 100,
      batchSize: 20,
      pauseMs: 100,
      perDay: 1,
    });
    await h.click('Start');
    expect(await second).toMatchObject({
      completed: 0,
      endReason: 'daily-cap',
    });
    expect(fake.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    const instagramAfter = (
      await h.store.read((tx) => records(tx.browserRuns))
    ).filter((run) => run.platform === 'instagram');
    expect(instagramAfter).toEqual(instagramBefore);
    expect(
      instagramAfter.reduce((sum, run) => sum + (run.pageOpens ?? 0), 0),
    ).toBe(201);
  } finally {
    await h.close();
  }
});

test('German accessible names work without stable button attributes', async () => {
  const h = await harness(['1001', '1004']);
  fake.setLanguage(true);
  fake.setAccessibleOnly(true);
  try {
    const running = h.launch();
    await h.click('Start');
    await h.click('Continue');
    await h.click('Continue');
    expect(await running).toMatchObject({ completed: 2 });
  } finally {
    await h.close();
  }
});

test('person Stop and account mismatch never allow the next entry', async () => {
  const h = await harness(['1001', '1002']);
  try {
    const running = h.launch();
    await h.click('Start');
    await h.click('Stop');
    expect(await running).toMatchObject({ endReason: 'stopped-by-person' });
    expect(
      fake.requests.filter((r) => r.method === 'POST').length,
    ).toBeLessThanOrEqual(1);
  } finally {
    await h.close();
  }
  const other = await harness(['1001']);
  fake.setHandle('different_decoy');
  try {
    const running = other.launch().then(
      (value) => value,
      (error) => error as unknown,
    );
    await other.click('Start');
    expect(await running).toMatchObject({ code: 'ACCOUNT_MISMATCH' });
    expect(fake.requests.filter((r) => r.method === 'POST')).toEqual([]);
  } finally {
    await other.close();
  }
});

test('foreign-origin GET and POST are aborted and counted without stopping a planned delete', async () => {
  const { createServer } = await import('node:http');
  let hits = 0;
  const decoy = createServer((_request, response) => {
    hits++;
    response.end('generated');
  });
  await new Promise<void>((resolve) =>
    decoy.listen(TEST_PORTS.foreign, '127.0.0.1', resolve),
  );
  const h = await harness(['1001']);
  fake.variants.set('1001', 'external');
  try {
    const running = h.launch().then(
      (value) => value,
      (error) => error as unknown,
    );
    await h.click('Start');
    await h.click('Continue');
    expect(await running).toMatchObject({ completed: 1, endReason: 'done' });
    expect(hits).toBe(0);
    expect(fake.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    const run = (await h.store.browserJournal()).runs[0]!;
    const report = JSON.parse(
      await readFile(
        join(h.directory, 'profile', `socialprune-readback-${run.runId}.json`),
        'utf8',
      ),
    ) as { abortedHosts: Record<string, number> };
    expect(report.abortedHosts[`127.0.0.1:${TEST_PORTS.foreign}`]).toBe(2);
  } finally {
    await h.close();
    await new Promise<void>((resolve) => decoy.close(() => resolve()));
  }
});
test('script-rendered account navigation and fourteen articles delete only the focal post and read accountAfter without revisiting home', async () => {
  const h = await harness(['1001']);
  fake.renderOptions({ navDelay: 100, articleCount: 14 });
  try {
    const result = h.launch().then(
      (value) => value,
      (error) => error as unknown,
    );
    await h.click('Start');
    await expect
      .poll(
        async () => (await h.store.browserJournal()).attempts.at(-1)?.state,
        { timeout: 10000 },
      )
      .toBe('deleted');
    await h.click('Continue');
    expect(await result).toMatchObject({ completed: 1, endReason: 'done' });
    expect(
      fake.requests
        .filter((request) => request.method === 'POST')
        .map((request) => request.id),
    ).toEqual(['1001']);
    expect(
      fake.requests.filter((request) => request.path === '/home'),
    ).toHaveLength(1);
  } finally {
    await h.close();
  }
});
test('an unsolicited allowed-origin mutation still stops delete before any delete click', async () => {
  const h = await harness(['1001']);
  fake.variants.set('1001', 'mutation');
  try {
    const result = h.launch().then(
      (value) => value,
      (error) => error as unknown,
    );
    await h.click('Start');
    expect(await result).toMatchObject({ code: 'UNEXPECTED_ACTION' });
    expect(
      fake.requests.filter((request) => request.method === 'POST'),
    ).toEqual([]);
  } finally {
    await h.close();
  }
});

test('extension IDs added after opening a post stop before any delete click and survive the read-back report', async () => {
  const h = await harness(['1001']);
  try {
    h.extensionAfterInspect();
    const running = h.launch().then(
      (value) => value,
      (error) => error as unknown,
    );
    await h.click('Start');
    await expect
      .poll(async () => (await h.store.browserJournal()).runs[0]?.endReason, {
        timeout: 10000,
      })
      .toBe('platform-check');
    expect(await running).toMatchObject({ code: 'PLATFORM_CHECK' });
    expect(
      fake.requests.filter((request) => request.method === 'POST'),
    ).toEqual([]);
    const run = (await h.store.browserJournal()).runs[0]!;
    const report = JSON.parse(
      await readFile(
        join(h.directory, 'profile', `socialprune-readback-${run.runId}.json`),
        'utf8',
      ),
    ) as { extensionIdsBefore: string[]; extensionIdsAfter: string[] };
    expect(report.extensionIdsBefore).toEqual(['a'.repeat(32)]);
    expect(report.extensionIdsAfter).toEqual(['a'.repeat(32), 'b'.repeat(32)]);
  } finally {
    await h.close();
  }
});

test('not-found is journaled without deletion and excluded until explicitly included', async () => {
  const h = await harness(['1001']);
  fake.variants.set('1001', 'not-found');
  try {
    const running = h.launch();
    await h.click('Start');
    expect(await running).toMatchObject({ completed: 0, endReason: 'done' });
    expect(
      (await h.store.browserJournal()).attempts.map((a) => a.state),
    ).toEqual(['not-found']);
    expect((await planDeletion(h.store, FIXTURE.account.key)).rows).toEqual([]);
    expect(
      (
        await planDeletion(h.store, FIXTURE.account.key, new Set(['x:1001']))
      ).rows.map((r) => r.item.id),
    ).toEqual(['x:1001']);
    expect(fake.requests.filter((r) => r.method === 'POST')).toEqual([]);
  } finally {
    await h.close();
  }
});

test('changed plan at Start refuses before platform contact', async () => {
  const h = await harness(['1001']);
  try {
    const running = h.launch().then(
      (value) => value,
      (error) => error as unknown,
    );
    await h.local();
    await h.store.write(async (tx) => {
      const stored = (await tx.items.get('x:1001'))!;
      await tx.items.put({
        ...stored,
        item: { ...stored.item, text: 'Generated changed text' },
      });
    });
    await h.click('Start');
    expect(await running).toMatchObject({
      code: 'STALE_PLAN',
      message: 'The plan changed. Make a new dry run and use its plan hash.',
    });
    expect(fake.requests).toEqual([]);
    expect((await h.store.browserJournal()).runs).toEqual([]);
  } finally {
    await h.close();
  }
});

test('journal append-only guards, terminal finality and duplicate settlements reject planted decoys', async () => {
  const h = await harness(['1001']);
  try {
    const running = h.launch();
    await h.click('Start');
    await h.click('Continue');
    await running;
    const db = new DatabaseSync(join(h.directory, 'socialprune.sqlite'), {
      allowExtension: false,
    });
    try {
      for (const sql of [
        "UPDATE browser_attempts SET state='failed'",
        'DELETE FROM browser_attempts',
        'DELETE FROM browser_runs',
        "UPDATE browser_runs SET ended_at='2026-10-12T00:00:00.000Z'",
      ])
        expect(() => db.exec(sql)).toThrow();
      expect(
        db
          .prepare(
            "SELECT strict FROM pragma_table_list WHERE name='browser_attempts'",
          )
          .get()!.strict,
      ).toBe(1);
    } finally {
      db.close();
    }
    const journal = await h.store.browserJournal(),
      attempt = journal.attempts[0]!;
    const writer = h.store.browserOutcomeWriter();
    await expect(
      writer.settle(
        {
          attemptId: 'duplicate-decoy',
          runId: attempt.runId,
          itemId: attempt.itemId,
          action: attempt.action,
          state: 'deleted',
          settles: attempt.attemptId,
          at: FIXTURE.now,
          code: null,
        },
        'deleted-via-browser',
      ),
    ).rejects.toThrow();
    await expect(
      h.store.write(async (tx) => {
        const runtime = await tx.runtime.get();
        await tx.outcomeEvents.append([
          {
            eventId: 'decoy-finality',
            seq: runtime.lastEventSeq + 1,
            itemId: 'x:1001',
            value: 'unknown',
            previous: 'deleted-via-browser',
            recordedAt: FIXTURE.now,
            source: { kind: 'human', via: 'local-review' },
            action: {
              id: 'decoy-human',
              kind: 'single',
              size: 1,
              reverts: null,
            },
          },
        ]);
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_FINAL' });
    expect((await h.store.browserJournal()).attempts).toHaveLength(2);
  } finally {
    await h.close();
  }
});

test('same-day fresh-plan resume deletes only remaining entries, with no duplicate request', async () => {
  const h = await harness(['1001', '1002']);
  try {
    const first = h.launch(false, {
      intervalMs: 100,
      batchSize: 20,
      pauseMs: 100,
      perDay: 1,
    });
    await h.click('Start');
    await h.click('Continue');
    await first;
    const remaining = await planDeletion(
      h.store,
      FIXTURE.account.key,
      new Set(),
      new Date(FIXTURE.now),
    );
    expect(remaining.rows.map((r) => r.item.id)).toEqual(['x:1002']);
    h.plan.rows = remaining.rows;
    h.plan.hash = remaining.hash;
    const second = h.launch();
    await h.click('Start');
    await h.click('Continue');
    expect(await second).toMatchObject({ completed: 1, endReason: 'done' });
    expect(
      fake.requests.filter((r) => r.method === 'POST').map((r) => r.id),
    ).toEqual(['1001', '1002']);
  } finally {
    await h.close();
  }
});

test('production entry cannot select fake hosts, test pace or a hidden browser', async () => {
  const { executeCli } = await import('../src/cli/adapter.ts');
  const { createNodeContext } = await import('../src/cli/node-context.ts');
  for (const arg of [
    `--origin=${TEST_ORIGINS.x}`,
    '--interval-ms=1',
    '--response-timeout-ms=1',
    '--headless',
  ]) {
    const stdout: string[] = [],
      stderr: string[] = [];
    const context = createNodeContext(
      { write: (t) => stdout.push(t) },
      { write: (t) => stderr.push(t) },
    );
    expect(
      await executeCli(
        [
          'delete',
          'x',
          '--workspace',
          'generated-decoy',
          '--account',
          FIXTURE.account.key,
          '--dry-run',
          '--json',
          arg,
        ],
        context,
      ),
    ).toBe(2);
    expect(stdout.join('')).toContain('INVALID_ARGUMENTS');
  }
});

test('readonly verification uses its calendar cap with no POST to the fake platform', async () => {
  const h = await harness(['1001', '1002']);
  fake.variants.set('1001', 'ambiguous');
  try {
    const writer = h.store.browserOutcomeWriter();
    const run = {
      runId: 'generated-verify-prerequisite',
      platform: 'x' as const,
      accountKey: FIXTURE.account.key,
      mode: 'delete' as const,
      planHash: h.plan.hash,
      startedAt: FIXTURE.now,
      endedAt: null,
      endReason: null,
      bodyShapes: {},
      profileReport: null,
      ownerPid: process.pid,
    };
    await writer.begin(run);
    for (const row of h.plan.rows) {
      const sending = (await writer.check(row, run.runId, FIXTURE.now, true))!;
      await writer.settle({
        attemptId: `ambiguous-${row.item.id}`,
        runId: run.runId,
        itemId: row.item.id,
        action: row.action,
        state: 'ambiguous',
        settles: sending.attemptId,
        at: FIXTURE.now,
        code: 'GENERATED_DECOY',
      });
    }
    await writer.finish({ ...run, endedAt: FIXTURE.now, endReason: 'error' });
    fake.variants.clear();
    fake.gone.add('1001');
    h.setNow('2026-10-12T12:00:00.000Z');
    const verified = h.launch(true, {
      intervalMs: 100,
      batchSize: 100,
      pauseMs: 0,
      perDay: 1,
    });
    await h.click('Start');
    expect(await verified).toMatchObject({
      completed: 1,
      endReason: 'daily-cap',
    });
    expect(fake.requests.filter((r) => r.method === 'POST')).toEqual([]);
    expect(
      (await h.store.browserJournal()).attempts.filter(
        (a) => a.action === 'verify',
      ),
    ).toHaveLength(1);
  } finally {
    await h.close();
  }
});

test('a new extension ID appearing during a run stops with PLATFORM_CHECK even when the directory count is unchanged', async () => {
  const h = await harness(['1001']);
  try {
    const running = h.launch().then(
      (value) => value,
      (error) => error as unknown,
    );
    await h.local();
    await rm(
      join(h.directory, 'profile', 'Default', 'Extensions', 'a'.repeat(32)),
      { recursive: true },
    );
    await mkdir(
      join(
        h.directory,
        'profile',
        'Default',
        'Extensions',
        'generated-extension',
        '1.0',
      ),
      { recursive: true },
    );
    await writeFile(
      join(
        h.directory,
        'profile',
        'Default',
        'Extensions',
        'generated-extension',
        '1.0',
        'manifest.json',
      ),
      '{}',
    );
    await h.click('Start');
    expect(await running).toMatchObject({ code: 'PLATFORM_CHECK' });
    expect(h.launchUrls).toHaveLength(1);
    expect(fake.requests).toEqual([]);
    const runs = (await h.store.browserJournal()).runs;
    expect(runs[0]?.endReason).toBe('platform-check');
    expect(runs[0]?.profileReport).toMatchObject({
      extensionsBefore: 1,
      extensionsAfter: 1,
    });
  } finally {
    await h.close();
  }
});

test('CLI -> real IndexedDB -> CLI backup preserves ambiguous receipts and blocks resend after restore', async () => {
  const h = await harness(['1001']);
  fake.variants.set('1001', 'ambiguous');
  const restoredPath = join(h.directory, 'restored.sqlite');
  let restored: SQLiteStore | undefined,
    browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const failed = h.launch().then(
      (value) => value,
      (error) => error as unknown,
    );
    await h.click('Start');
    expect(await failed).toMatchObject({ code: 'RUN_STOPPED' });
    const original = migrateOriginal({
      id: '910',
      status: 'fetched',
      fetchedAt: FIXTURE.now,
      text: 'Generated anonymous beginning',
      authorName: 'Generated context',
      authorHandle: 'generated_context',
      photos: [],
      quotedId: null,
      parentId: null,
      raw: { note_tweet: {} },
      textCompleteness: 'truncated',
      video: null,
    });
    await h.store.write((tx) => tx.originals.put(original));
    const fill = new OriginalsFillWriter(h.store);
    await fill.startRun({
      runId: 'generated-fill-portable',
      accountKey: FIXTURE.account.key,
      planHash: 'a'.repeat(64),
      canary: true,
      startedAt: FIXTURE.now,
    });
    await fill.sending({
      attemptId: 'generated-read-portable',
      runId: 'generated-fill-portable',
      originalId: '910',
      at: FIXTURE.now,
    });
    const projection = {
      rest_id: '910',
      text: 'Generated full text through signed-in page',
    };
    await fill.settle(
      {
        attemptId: 'generated-read-portable',
        state: 'read',
        at: FIXTURE.now,
        code: null,
      },
      [
        {
          ...original,
          text: projection.text,
          textSource: 'signed-in',
          textCompleteness: 'full',
          signedInRecord: projection,
          signedIn: {
            status: 'read',
            at: FIXTURE.now,
            runId: 'generated-fill-portable',
            attemptId: 'generated-read-portable',
            reason: null,
          },
          media: [
            {
              n: 1,
              kind: 'video',
              source: 'signed-in',
              url: 'https://video.twimg.com/generated.mp4',
              file: null,
              poster: null,
              status: 'failed',
              bytes: null,
              durationMs: 1000,
              bitrateLabel: 832000,
              altText: null,
            },
          ],
        },
      ],
    );
    await fill.endRun({
      runId: 'generated-fill-portable',
      endedAt: FIXTURE.now,
      endReason: 'canary',
      bodyShapes: { 'read-post': ['generated-path'] },
      profileReport: {
        accountBefore: FIXTURE.account.handle,
        accountAfter: FIXTURE.account.handle,
        extensionsBefore: 0,
        extensionsAfter: 0,
        changedFiles: [],
        unexpectedRequests: [],
      },
    });
    await fill.acceptCanary('generated-fill-portable', FIXTURE.now);
    const instagramExpected = JSON.parse(
      await readFile(
        new URL(
          '../../../fixtures/synthetic/instagram/current-minimal/expected.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as { items: Item[] };
    const contextRecord = await writeInstagramContextContract(
      h.store,
      instagramExpected.items[0],
    );
    const before = await h.store.browserJournal();
    const backup = createBackup(h.store, { batchSize: 1 });
    let text = '';
    for await (const chunk of backup.chunks)
      text += new TextDecoder().decode(chunk);
    expect((JSON.parse(text) as { schemaVersion: number }).schemaVersion).toBe(
      WORKSPACE_SCHEMA_VERSION,
    );
    const { build } = await import('vite');
    const output = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        lib: {
          entry: fileURLToPath(
            new URL('./fake-x/portable-browser.ts', import.meta.url),
          ),
          formats: ['es'],
          fileName: 'portable-journal',
        },
        rolldownOptions: { output: { codeSplitting: false } },
      },
    });
    const result = Array.isArray(output) ? output[0] : output;
    if (!result || !('output' in result))
      throw new Error('Unexpected probe build');
    const code = result.output.find((chunk) => chunk.type === 'chunk');
    if (!code || code.type !== 'chunk')
      throw new Error('Missing browser journal probe');
    fake.scripts.set('/portable-journal.js', code.code);
    browser = await chromium.launch({
      executablePath: chromium.executablePath(),
      headless: true,
      chromiumSandbox: true,
      args: ['--enable-automation'],
      ignoreDefaultArgs: ['--disable-infobars'],
    });
    const page = await browser.newPage();
    await page.route('**/*', (route) =>
      new URL(route.request().url()).origin === fake.origin
        ? route.continue()
        : route.abort(),
    );
    await page.goto(fake.origin + '/home');
    await page.addScriptTag({
      url: fake.origin + '/portable-journal.js',
      type: 'module',
    });
    await page.waitForFunction(() => 'roundTripJournal' in globalThis);
    const upgraded = await page.evaluate(async () =>
      (
        globalThis as unknown as {
          upgradeJournalDecoy(): Promise<{
            version: number;
            originalPreserved: boolean;
            tables: string[];
          }>;
        }
      ).upgradeJournalDecoy(),
    );
    expect(upgraded).toMatchObject({
      version: WORKSPACE_SCHEMA_VERSION,
      originalPreserved: true,
    });
    expect(upgraded.tables).toContain('browserRuns');
    expect(upgraded.tables).toContain('browserAttempts');
    expect(upgraded.tables).toContain('instagramContext');
    const foundation = await page.evaluate(async () =>
      (
        globalThis as unknown as {
          contextFoundation(): Promise<{
            checks: string[];
            workspace: WorkspaceV2;
          }>;
        }
      ).contextFoundation(),
    );
    expect(foundation.checks).toEqual(
      STORE_CONTRACT_CHECKS.map(({ name }) => name),
    );
    expect(foundation.workspace.instagramContext).toEqual([contextRecord]);
    const browserResult = await page.evaluate(async (backupText) => {
      return (
        globalThis as unknown as {
          roundTripJournal(value: string): Promise<{
            text: string;
            workspace: {
              browserAttempts: unknown[];
              instagramContext: InstagramContext[];
            };
          }>;
        }
      ).roundTripJournal(backupText);
    }, text);
    expect(browserResult.workspace.browserAttempts).toEqual(before.attempts);
    expect(browserResult.workspace.instagramContext).toEqual([contextRecord]);
    restored = await SQLiteStore.open(restoredPath, {
      initial: createWorkspace(),
    });
    await restoreBackup(
      restored,
      (async function* () {
        await Promise.resolve();
        yield browserResult.text;
      })(),
      { batchSize: 1 },
    );
    expect((await restored.browserJournal()).attempts).toEqual(before.attempts);
    expect(
      await restored.read((tx) =>
        tx.instagramContext.get(contextRecord.itemId),
      ),
    ).toEqual(contextRecord);
    const v4 = JSON.parse(text) as WorkspaceV2;
    v4.schemaVersion = 4;
    delete v4.instagramContext;
    delete v4.counts.instagramContext;
    delete v4.reviewPlans;
    delete v4.counts.reviewPlans;
    delete v4.settings.criteria;
    delete v4.settings.keepRules;
    if (v4.settings.review) delete v4.settings.review.feed;
    for (const submission of v4.submissions) delete submission.criteria;
    v4.browserRuns = v4.browserRuns!.filter((run) => run.platform === 'x');
    v4.browserAttempts = v4.browserAttempts!.filter(
      (attempt) => attempt.action !== 'confirm-comment',
    );
    v4.counts.browserRuns = v4.browserRuns.length;
    v4.counts.browserAttempts = v4.browserAttempts.length;
    const oldBrowser = await page.evaluate(
      async (value) =>
        (
          globalThis as unknown as {
            roundTripJournal(
              text: string,
            ): Promise<{ text: string; workspace: WorkspaceV2 }>;
          }
        ).roundTripJournal(value),
      JSON.stringify(v4),
    );
    expect(oldBrowser.workspace.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
    expect(oldBrowser.workspace.instagramContext).toBeUndefined();
    expect(oldBrowser.workspace.browserRuns).toEqual(v4.browserRuns);
    expect(oldBrowser.workspace.browserAttempts).toEqual(v4.browserAttempts);
    const oldCli = await SQLiteStore.open(
      join(h.directory, 'restored-v4.sqlite'),
      { initial: createWorkspace() },
    );
    try {
      await restoreBackup(
        oldCli,
        (async function* () {
          await Promise.resolve();
          yield JSON.stringify(v4);
        })(),
      );
      const value = await oldCli.read(async (tx) => ({
        meta: await tx.meta.get(),
        contexts: await records(tx.instagramContext),
      }));
      expect(value.meta.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
      expect(value.contexts).toEqual([]);
    } finally {
      await oldCli.close();
    }
    const preserved = await restored.read((tx) => tx.originals.get('910'));
    expect(preserved).toMatchObject({
      text: projection.text,
      textSource: 'signed-in',
      signedInRecord: projection,
      media: [{ status: 'failed', kind: 'video' }],
    });
    expect(
      (await restored.browserJournal()).runs.map((run) => run.mode).sort(),
    ).toEqual(['context', 'delete', 'fill']);
    expect(
      (await planDeletion(restored, FIXTURE.account.key, new Set(['x:1001'])))
        .rows,
    ).toEqual([]);
    expect(fake.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  } finally {
    await browser?.close();
    await restored?.close();
    await h.close();
  }
});
