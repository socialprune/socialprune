import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, expect, test } from 'vitest';
import { chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { SQLiteStore } from '../src/workspace/sqlite-store.ts';
import { createProfile, profileInUse } from '../src/browser/profile.ts';
import { planDeletion } from '../src/browser/plan.ts';
import { runWithDependencies } from '../src/browser/runner.ts';
import { pageDriver } from '../src/browser/x/driver.ts';
import { fixtureWorkspace, FIXTURE } from './fake-x/fixture.ts';
import { fakeX } from './fake-x/server.ts';
import { DatabaseSync } from 'node:sqlite';
import {
  createBackup,
  restoreBackup,
} from '@socialprune/core/workspace/backup';
import {
  createWorkspace,
  OriginalsFillWriter,
} from '@socialprune/core/workspace/store';
import { migrateOriginal } from '@socialprune/core';

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
  fake.setHandle(FIXTURE.account.handle);
  fake.setLanguage(false);
  fake.setAccessibleOnly(false);
  fake.renderOptions({});
  const plan = await planDeletion(store, workspace.items[0]!.account.key);
  let started!: () => void;
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
        confirmationPort: 4232,
        async sleep(ms, signal) {
          waits.push(ms);
          if (signal.aborted) throw new Error('Aborted');
          await new Promise((resolve) => setTimeout(resolve, ms));
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
      .find((page) => page.url().startsWith('http://127.0.0.1:4232'))!;
  };
  const click = async (name: 'Start' | 'Continue' | 'Stop') => {
    const page = await local();
    const button = page.getByRole('button', { name, exact: true });
    await button.waitFor({ state: 'visible' });
    await button.click();
  };
  return {
    directory,
    store,
    plan,
    waits,
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
    ).toEqual(['/graphql/generated/DeleteTweet']);
    expect(
      h.network.every((url) =>
        ['http://127.0.0.1:4231', 'http://127.0.0.1:4232'].includes(
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
    expect(h.notices.join('')).toContain('Die Seite wurde nicht erkannt');
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
      .toContain('The page was not recognized');
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
        variant === 'ambiguous'
          ? FIXTURE.expected.ambiguousStates
          : FIXTURE.expected.failureStates,
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
      'failed',
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
    const first = h.launch(false, {
      intervalMs: 100,
      batchSize: 20,
      pauseMs: 100,
      perDay: 1,
    });
    await h.click('Start');
    await h.click('Continue');
    expect(await first).toMatchObject({ completed: 1, endReason: 'daily-cap' });
    const refreshed = await planDeletion(h.store, FIXTURE.account.key);
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
    decoy.listen(4239, '127.0.0.1', resolve),
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
    expect(report.abortedHosts['127.0.0.1:4239']).toBe(2);
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
    const remaining = await planDeletion(h.store, FIXTURE.account.key);
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
    '--origin=http://127.0.0.1:4231',
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
    const before = await h.store.browserJournal();
    const backup = createBackup(h.store, { batchSize: 1 });
    let text = '';
    for await (const chunk of backup.chunks)
      text += new TextDecoder().decode(chunk);
    expect((JSON.parse(text) as { schemaVersion: number }).schemaVersion).toBe(
      4,
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
    expect(upgraded).toMatchObject({ version: 4, originalPreserved: true });
    expect(upgraded.tables).toContain('browserRuns');
    expect(upgraded.tables).toContain('browserAttempts');
    const browserResult = await page.evaluate(async (backupText) => {
      return (
        globalThis as unknown as {
          roundTripJournal(value: string): Promise<{
            text: string;
            workspace: { browserAttempts: unknown[] };
          }>;
        }
      ).roundTripJournal(backupText);
    }, text);
    expect(browserResult.workspace.browserAttempts).toEqual(before.attempts);
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
    const preserved = await restored.read((tx) => tx.originals.get('910'));
    expect(preserved).toMatchObject({
      text: projection.text,
      textSource: 'signed-in',
      signedInRecord: projection,
      media: [{ status: 'failed', kind: 'video' }],
    });
    expect(
      (await restored.browserJournal()).runs.map((run) => run.mode).sort(),
    ).toEqual(['delete', 'fill']);
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
