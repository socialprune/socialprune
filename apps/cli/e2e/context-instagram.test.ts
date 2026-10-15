import { mkdtemp, mkdir, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { chromium } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { SQLiteStore } from '../src/workspace/sqlite-store.ts';
import { createProfile, profileInUse } from '../src/browser/profile.ts';
import { planContext } from '../src/browser/instagram/plan.ts';
import { runContextWithDependencies } from '../src/browser/instagram/run.ts';
import type { ContextOrder } from '../src/browser/instagram/order.ts';
import { fakeInstagram } from './fake-instagram/server.ts';
import { instagramFixture, IG_FIXTURE } from './fake-instagram/fixture.ts';
import type { Variant } from './fake-instagram/fixture.ts';
import { instagramContextDirectory } from '../src/workspace/context-files.ts';
import { instagramDailyCount } from '../src/browser/instagram/pace.ts';
import { InstagramContextWriter } from '@socialprune/core/workspace/instagram-context-writer';
import { records } from '@socialprune/core/workspace/store';
import { capturePost } from '../src/browser/instagram/capture.ts';
import { startConfirmation } from '../src/browser/confirmation.ts';
import { clickAllowed } from '../src/browser/instagram/selectors.ts';
import type { Click } from '../src/browser/instagram/selectors.ts';
import { createServer } from 'node:http';
import {
  fixtureWorkspace as xFixtureWorkspace,
  FIXTURE as X_FIXTURE,
} from './fake-x/fixture.ts';
import {
  DETAIL_FIXTURE,
  detailAnswer,
  detailPost,
} from '../src/originals/test/detail.ts';
import { migrateOriginal } from '@socialprune/core';
import { planFill } from '../src/browser/x/fill/plan.ts';
import { runFillWithDependencies } from '../src/browser/x/fill/run.ts';
import { SyndicationClient } from '../src/originals/syndication.ts';
import { productionMedia } from '../src/originals/video.ts';
import { BrowserOutcomeWriter } from '../src/workspace/browser-journal.ts';
import { CliError } from '../src/cli/errors.ts';
import { DatabaseSync } from 'node:sqlite';
import * as captureHelpers from '../src/browser/instagram/capture.ts';
import * as profileHelpers from '../src/browser/profile.ts';

async function harness(variant: Variant = 'success', count = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'sp-context-fake-')),
    profile = join(directory, 'profile');
  const fixture = await instagramFixture(count);
  const fake = await fakeInstagram(4401, fixture.items);
  fake.setVariant(variant);
  await createProfile(profile, 'instagram');
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: fixture.workspace,
  });
  const plan = await planContext(store, fixture.items[0]!.account.key),
    notices: string[] = [],
    waits: number[] = [];
  let context: BrowserContext | undefined,
    now = Date.parse(IG_FIXTURE.now),
    started!: () => void;
  let onSleep: ((ms: number) => Promise<void>) | undefined;
  let onLaunch: (() => Promise<void>) | undefined;
  let captureOverride: typeof capturePost | undefined;
  let limit = 200;
  let maxSteps: number | undefined;
  const shown = new Promise<void>((resolve) => {
    started = resolve;
  });
  let running: Promise<unknown> | undefined;
  const controller = new AbortController();
  const start = (
    order: boolean | 'no-canary' = false,
    lang: 'en' | 'de' = 'en',
  ) => {
    const written: ContextOrder | undefined = order
      ? {
          value: {
            scope: 'context-instagram',
            account: plan.handle,
            givenAt: IG_FIXTURE.now,
            words: 'Read these generated comments only.',
            acceptCanary: order !== 'no-canary',
            maxSteps,
          },
          sha256: 'a'.repeat(64),
        }
      : undefined;
    running = runContextWithDependencies(
      {
        store,
        plan,
        workspace: directory,
        profile,
        executablePath: chromium.executablePath(),
        list: 'generated-list',
        include: new Set(),
        limit,
        order: written,
        signal: controller.signal,
        lang,
        now: () => new Date(now),
        notice: (text) => notices.push(text),
      },
      {
        origin: fake.origin,
        port: 4402,
        responseMs: 1500,
        pace: {
          intervalMs: 30000,
          batch: 20,
          pauseMs: 900000,
          scrollMs: 2000,
          expandMs: 3000,
        },
        policy: {
          platform: (url) => new URL(url).origin === fake.origin,
          image: (url) =>
            new URL(url).origin === fake.origin &&
            new URL(url).pathname.startsWith('/media/'),
        },
        capture: captureOverride,
        async launch(path, executablePath) {
          context = await chromium.launchPersistentContext(path, {
            executablePath,
            headless: true,
            chromiumSandbox: true,
            args: ['--enable-automation'],
            ignoreDefaultArgs: ['--disable-infobars'],
            serviceWorkers: 'block',
          });
          const probe = await context.newCDPSession(context.pages()[0]!);
          const command = await probe.send('Browser.getBrowserCommandLine');
          expect(command.arguments).toContain('--disable-extensions');
          expect(command.arguments).toContain('--enable-automation');
          expect(command.arguments).not.toContain('--no-sandbox');
          expect(command.arguments).not.toContain('--disable-infobars');
          await probe.detach();
          await onLaunch?.();
          started();
          return context;
        },
        async sleep(ms) {
          waits.push(ms);
          now += ms;
          await onSleep?.(ms);
          await new Promise((resolve) => setTimeout(resolve, 30));
        },
        async close(_context, automatic) {
          if (automatic) await _context.close();
        },
      },
    ).catch((error: unknown) => error);
    return running;
  };
  const local = async () => {
    await shown;
    await expect
      .poll(
        () =>
          context!
            .pages()
            .some((page) => page.url().startsWith('http://127.0.0.1:4402')),
        { timeout: 30000 },
      )
      .toBe(true);
    const readyPage = context!
      .pages()
      .find((page) => page.url().startsWith('http://127.0.0.1:4402'))!;
    try {
      await readyPage
        .locator('.actions')
        .waitFor({ state: 'attached', timeout: 30000 });
    } catch (error) {
      throw new Error(
        `${String(error)}; local page=${await readyPage.locator('body').innerText()}; notices=${notices.join('')}`,
      );
    }
    return readyPage;
  };
  const click = async (name: string) => {
    const page = await local();
    try {
      await page
        .getByRole('button', { name, exact: true })
        .click({ timeout: variant === 'window-full' ? 45000 : 30000 });
    } catch (error) {
      throw new Error(`${String(error)}\nRun notices: ${notices.join('')}`);
    }
  };
  return {
    directory,
    profile,
    fixture,
    fake,
    store,
    plan,
    notices,
    waits,
    start,
    local,
    click,
    afterWait(callback: (ms: number) => Promise<void>) {
      onSleep = callback;
    },
    afterLaunch(callback: () => Promise<void>) {
      onLaunch = callback;
    },
    setCapture(value: typeof capturePost) {
      captureOverride = value;
    },
    setLimit(value: number) {
      limit = value;
    },
    setMaxSteps(value: number) {
      maxSteps = value;
    },
    advanceClock(ms: number) {
      now += ms;
    },
    get context() {
      return context;
    },
    refresh: async () => {
      Object.assign(plan, await planContext(store, plan.accountKey));
    },
    async close() {
      controller.abort();
      await context?.close();
      await running;
      await store.close();
      await fake.close();
      expect(await profileInUse(profile)).toBe(false);
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    },
  };
}
test.each(['limit', 'maxSteps'] as const)(
  'F1 second-candidate with %s 2 refuses the partial automatic canary',
  async (bound) => {
    const h = await harness('second-candidate', 2);
    if (bound === 'limit') h.setLimit(2);
    else h.setMaxSteps(2);
    try {
      const result = await h.start(true),
        journal = await h.store.browserJournal();
      expect(journal.runs[0]!.canaryAcceptedAt).toBeNull();
      expect(journal.runs[0]).toMatchObject({
        endReason: 'error',
        displayEndReason: 'CANARY_CHECK_FAILED',
      });
      expect(result).toMatchObject({ code: 'CANARY_CHECK_FAILED' });
      const attempts = await h.store.read((tx) => records(tx.browserAttempts));
      expect(attempts.map((attempt) => attempt.state)).toEqual([
        'sending',
        'confirmed',
        'sending',
        'unconfirmed',
      ]);
      expect(attempts.at(-1)!.code).toBe('time');
    } finally {
      await h.close();
    }
  },
);
test.each(['limit', 'maxSteps'] as const)(
  'F1 two planned comments with %s 1 cannot shorten automatic acceptance',
  async (bound) => {
    const h = await harness('success', 2);
    if (bound === 'limit') h.setLimit(1);
    else h.setMaxSteps(1);
    try {
      const result = await h.start(true),
        journal = await h.store.browserJournal();
      expect(journal.runs[0]!.canaryAcceptedAt).toBeNull();
      expect(result).toMatchObject({ code: 'CANARY_CHECK_FAILED' });
      expect(
        await h.store.read((tx) => records(tx.instagramContext)),
      ).toHaveLength(1);
      expect(journal.runs[0]!.endReason).toBe('error');
    } finally {
      await h.close();
    }
  },
);
test.each(['day-cap', 'day-change'] as const)(
  'F1 %s cannot accept or silently end a partial automatic canary',
  async (bound) => {
    const h = await harness('success', 2);
    if (bound === 'day-cap') {
      const writer = new InstagramContextWriter(h.store);
      await writer.startRun({
        runId: 'generated-nearly-cap',
        accountKey: h.plan.accountKey,
        planHash: h.plan.hash,
        startedAt: IG_FIXTURE.now,
      });
      for (let step = 0; step < 199; step++)
        await writer.step('generated-nearly-cap', IG_FIXTURE.now);
      await writer.endRun({
        runId: 'generated-nearly-cap',
        endedAt: IG_FIXTURE.now,
        endReason: 'daily-cap',
        bodyShapes: {},
        profileReport: {
          accountBefore: h.plan.handle,
          accountAfter: h.plan.handle,
          extensionsBefore: 0,
          extensionsAfter: 0,
          changedFiles: [],
          unexpectedRequests: [],
        },
      });
    } else {
      h.advanceClock(9 * 3600000 + 59 * 60000 + 30000);
    }
    try {
      const result = await h.start(true),
        run = (await h.store.browserJournal()).runs.at(-1)!;
      expect(result).toMatchObject({ code: 'CANARY_CHECK_FAILED' });
      expect(run.canaryAcceptedAt).toBeNull();
      expect(run.endReason).toBe('error');
    } finally {
      await h.close();
    }
  },
);
test('F1 audit refusal occurs before canary acceptance and preserves its first stop cause', async () => {
  const h = await harness();
  let refused = false;
  const audit = vi.spyOn(BrowserOutcomeWriter.prototype, 'recordContextAudit');
  const original = audit.getMockImplementation()!;
  audit.mockImplementation(async function (
    this: BrowserOutcomeWriter,
    ...args: Parameters<typeof original>
  ) {
    if (args[3]) {
      refused = true;
      throw new CliError('CANARY_CHECK_FAILED');
    }
    return original.apply(this, args);
  });
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CANARY_CHECK_FAILED' });
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(refused).toBe(true);
    expect(run.canaryAcceptedAt).toBeNull();
    expect(run.endReason).toBe('error');
    expect(run.acceptedBy).toBeUndefined();
  } finally {
    audit.mockRestore();
    await h.close();
  }
});
test('F1 audit transaction failure cannot leave canary acceptance behind', async () => {
  const h = await harness();
  const db = new DatabaseSync(join(h.directory, 'socialprune.sqlite'));
  db.exec(
    "CREATE TRIGGER generated_audit_refusal BEFORE UPDATE ON browser_order_audit WHEN NEW.accepted_by='automatic-check' BEGIN SELECT RAISE(ABORT,'generated refusal'); END",
  );
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CONTEXT_FAILED' });
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(run.canaryAcceptedAt).toBeNull();
    expect(run.endedAt).toBeTruthy();
    expect(run.endReason).toBe('error');
  } finally {
    db.close();
    await h.close();
  }
});
test.each(['post-decoy', 'post-decoy-foreign'] as const)(
  'F2 %s never supplies the last-list read-back account',
  async (variant) => {
    const h = await harness(variant);
    try {
      const result = await h.start(true),
        run = (await h.store.browserJournal()).runs[0]!;
      expect(run.endedAt).toBeTruthy();
      expect(result).toMatchObject({ completed: 1, endReason: 'canary' });
      expect(run.profileReport).toMatchObject({
        accountBefore: h.plan.handle,
        accountAfter: h.plan.handle,
      });
      expect(run.canaryAcceptedAt).toBeTruthy();
      expect(
        (await readdir(h.profile)).some(
          (file) => file === `socialprune-readback-${run.runId}.json`,
        ),
      ).toBe(true);
    } finally {
      await h.close();
    }
  },
);
test('F2 structure-report failure still snapshots the profile, writes extension report, closes the journal and audits', async () => {
  const h = await harness();
  const write = vi
    .spyOn(captureHelpers, 'writeStructure')
    .mockRejectedValue(new TypeError('Generated private write failure'));
  const snapshot = vi.spyOn(profileHelpers, 'profileSnapshot');
  try {
    const result = await h.start(true),
      run = (await h.store.browserJournal()).runs[0]!;
    expect(run.endedAt).toBeTruthy();
    expect(run.endReason).toBe('error');
    expect(run.canaryAcceptedAt).toBeNull();
    expect(result).toMatchObject({ code: 'CONTEXT_FAILED' });
    expect(run).toMatchObject({ displayEndReason: 'CONTEXT_FAILED' });
    expect(snapshot).toHaveBeenCalled();
    expect(
      (await readdir(h.profile)).some(
        (file) => file === `socialprune-readback-${run.runId}.json`,
      ),
    ).toBe(true);
    expect(h.notices.join('')).toContain('Stop detail: type-error');
    expect(h.notices.join('')).not.toContain('Generated private write failure');
  } finally {
    write.mockRestore();
    snapshot.mockRestore();
    await h.close();
  }
});
test('F2 extension-report failure still ends the run and records the failed audit', async () => {
  const h = await harness(),
    write = vi
      .spyOn(profileHelpers, 'writeExtensionReport')
      .mockRejectedValue(new TypeError('Generated private extension failure'));
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CONTEXT_FAILED' });
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(run.endedAt).toBeTruthy();
    expect(run.canaryAcceptedAt).toBeNull();
    expect(run).toMatchObject({
      endReason: 'error',
      displayEndReason: 'CONTEXT_FAILED',
    });
  } finally {
    write.mockRestore();
    await h.close();
  }
});
test('F2 snapshot failure remains unobserved, attempts the extension report and still ends and audits the run', async () => {
  const h = await harness();
  const original = profileHelpers.profileSnapshot;
  const snapshot = vi
    .spyOn(profileHelpers, 'profileSnapshot')
    .mockImplementation(async (path) => {
      if (
        await h.store.read((tx) =>
          tx.instagramContext.get(h.fixture.items[0]!.id),
        )
      )
        throw new TypeError('Generated private snapshot failure');
      return original(path);
    });
  const extension = vi.spyOn(profileHelpers, 'writeExtensionReport');
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CONTEXT_FAILED' });
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(run.endedAt).toBeTruthy();
    expect(run.endReason).toBe('error');
    expect(run.canaryAcceptedAt).toBeNull();
    expect(run).toMatchObject({ displayEndReason: 'CONTEXT_FAILED' });
    expect(extension).toHaveBeenCalledOnce();
    const report = JSON.parse(
      await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      ),
    ) as { readback: unknown; stop: unknown };
    expect(report.readback).toMatchObject({ profileObserved: false });
    expect(report.stop).toMatchObject({ token: 'type-error' });
  } finally {
    snapshot.mockRestore();
    extension.mockRestore();
    await h.close();
  }
});
test('F2 later reporting failures cannot replace the first platform stop cause', async () => {
  const h = await harness('de');
  const write = vi
    .spyOn(captureHelpers, 'writeStructure')
    .mockRejectedValue(new TypeError('Generated later private failure'));
  const extension = vi
    .spyOn(profileHelpers, 'writeExtensionReport')
    .mockRejectedValue(new Error('Generated later extension failure'));
  try {
    expect(await h.start(true)).toMatchObject({ code: 'PAGE_LANGUAGE' });
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(run).toMatchObject({
      endReason: 'error',
      displayEndReason: 'PAGE_LANGUAGE',
    });
    expect(run.endedAt).toBeTruthy();
    expect(h.notices.filter((line) => line.startsWith('Stop detail:'))).toEqual(
      ['Stop detail: page-language\n'],
    );
    expect(h.notices.join('')).not.toContain('Generated later');
  } finally {
    write.mockRestore();
    extension.mockRestore();
    await h.close();
  }
});
test('F3b a second matching candidate in a multi-permalink block stays several', async () => {
  const h = await harness('multi-permalink');
  try {
    const result = await h.start(true);
    expect(result).toMatchObject({ code: 'CANARY_CHECK_FAILED' });
    const attempts = await h.store.read((tx) => records(tx.browserAttempts));
    expect(attempts.at(-1)).toMatchObject({
      state: 'unconfirmed',
      code: 'several',
    });
    expect(await h.store.read((tx) => records(tx.instagramContext))).toEqual(
      [],
    );
  } finally {
    await h.close();
  }
});
test('foundation: Start gates navigation, sending commits first, four checks atomically confirm, Matches accepts; no input, foreign clicks, nodes or image re-fetch', async () => {
  const h = await harness();
  try {
    h.fake.beforeList(async () => {
      const sends = await h.store.read(async (tx) => {
        const result = [];
        for await (const attempt of tx.browserAttempts.iterate())
          result.push(attempt);
        return result;
      });
      expect(sends[0]?.state).toBe('sending');
    });
    const running = h.start();
    await h.local();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(h.fake.requests).toEqual([]);
    await h.click('Start');
    await h.click('Continue');
    await h.click('Matches');
    expect(await running).toMatchObject({
      completed: 1,
      steps: 1,
      endReason: 'canary',
    });
    const result = await h.store.read(async (tx) => {
      const attempts = [];
      for await (const attempt of tx.browserAttempts.iterate())
        attempts.push(attempt);
      return {
        attempts,
        record: await tx.instagramContext.get(h.fixture.items[0]!.id),
        state: await tx.state.get(h.fixture.items[0]!.id),
        runs: await (async () => {
          const values = [];
          for await (const run of tx.browserRuns.iterate()) values.push(run);
          return values;
        })(),
      };
    });
    expect(result.attempts.map((attempt) => attempt.state)).toEqual(
      IG_FIXTURE.expected.success,
    );
    expect(result.record).toMatchObject({
      post: {
        owner: h.fixture.items[0]!.reference.ownerHandle,
        caption: IG_FIXTURE.caption,
      },
      image: { status: 'stored' },
      screenshot: { status: 'stored' },
    });
    expect(result.record!.screenshot.bytes).toBeLessThanOrEqual(400000);
    expect(result.state?.decision).toBe('undecided');
    expect(result.state?.outcome).toBe('unknown');
    expect(result.runs[0]!.canaryAcceptedAt).toBeTruthy();
    expect(
      h.fake.requests.filter((request) => request.path.startsWith('/media/')),
    ).toHaveLength(1);
    for (const event of h.fake.events) {
      expect(event.inputs).toEqual([]);
      expect(event.added).toEqual([]);
      for (const click of event.clicks)
        expect(IG_FIXTURE.allowedClicks as readonly string[]).toContain(click);
    }
    const report = await readFile(
      join(
        h.directory,
        'context',
        'instagram',
        `canary-${result.runs[0]!.runId}.json`,
      ),
      'utf8',
    );
    for (const value of [
      h.fixture.items[0]!.text,
      h.fixture.items[0]!.account.handle!,
      h.fixture.items[0]!.reference.ownerHandle!,
      IG_FIXTURE.code,
      IG_FIXTURE.postAt,
      ...Object.values(IG_FIXTURE.other),
    ])
      expect(report).not.toContain(value);
    const localRecords = JSON.stringify({
      journal: await h.store.browserJournal(),
      records: await h.store.read((tx) => records(tx.instagramContext)),
    });
    for (const value of Object.values(IG_FIXTURE.other)) {
      expect(localRecords).not.toContain(value);
      expect(h.notices.join('')).not.toContain(value);
    }
  } finally {
    await h.close();
  }
});
test.each([
  'success',
  'hidden',
  'reel',
  'cut-caption',
  'collaboration',
  'empty-caption',
] as const)(
  'automatic canary %s compares every field with the page JSON, accepts once and never starts a full run',
  async (variant) => {
    const h = await harness(variant);
    try {
      const result = await h.start(true);
      expect(result).toMatchObject({ completed: 1, endReason: 'canary' });
      const runs = await h.store.browserJournal();
      expect(runs.runs[0]).toMatchObject({ acceptedBy: 'automatic-check' });
      expect(runs.runs[0]?.canaryAcceptedAt).toBeTruthy();
      if (variant === 'hidden')
        expect(h.waits.filter((value) => value === 3000)).toHaveLength(3);
    } finally {
      await h.close();
    }
  },
);
test.each([
  ['time', 'CANARY_CHECK_FAILED'],
  ['owner', 'CANARY_CHECK_FAILED'],
  ['several', 'CANARY_CHECK_FAILED'],
  ['edited', 'CANARY_CHECK_FAILED'],
  ['other-author', 'CANARY_CHECK_FAILED'],
  ['video', 'CANARY_CHECK_FAILED'],
  ['no-json', 'CANARY_NO_SECOND_SOURCE'],
  ['missing-owner', 'CANARY_NO_SECOND_SOURCE'],
  ['missing-time', 'CANARY_NO_SECOND_SOURCE'],
  ['missing-caption', 'CANARY_NO_SECOND_SOURCE'],
  ['missing-image', 'CANARY_NO_SECOND_SOURCE'],
  ['different-owner', 'CANARY_MISMATCH'],
  ['different-time', 'CANARY_MISMATCH'],
  ['different-caption', 'CANARY_MISMATCH'],
  ['different-image', 'CANARY_MISMATCH'],
  ['two-answers', 'CANARY_MISMATCH'],
  ['mutation', 'UNEXPECTED_ACTION'],
  ['write-segment', 'UNEXPECTED_ACTION'],
  ['de', 'PAGE_LANGUAGE'],
  ['limit', 'PLATFORM_CHECK'],
  ['error', 'PLATFORM_CHECK'],
  ['lock', 'PLATFORM_CHECK'],
  ['login', 'PLATFORM_CHECK'],
  ['challenge', 'PLATFORM_CHECK'],
  ['checkpoint', 'PLATFORM_CHECK'],
  ['429', 'PLATFORM_CHECK'],
  ['never', 'PLATFORM_CHECK'],
] as const)(
  'automatic canary %s refuses with %s without acceptance or another comment',
  async (variant, code) => {
    const h = await harness(variant);
    try {
      expect(await h.start(true)).toMatchObject({ code });
      const runs = await h.store.browserJournal();
      expect(runs.runs[0]?.canaryAcceptedAt).toBeNull();
      expect(
        await h.store.read((tx) =>
          tx.instagramContext.get(h.fixture.items[0]!.id),
        ),
      ).toBeUndefined();
      expect(h.notices.join('')).toContain('Stop detail:');
      expect(
        h.fake.requests.filter(
          (request) => request.path === '/your_activity/interactions/comments',
        ).length,
      ).toBeLessThanOrEqual(1);
    } finally {
      await h.close();
    }
  },
);
test('an order missing acceptCanary refuses before profile, browser and confirmation access', async () => {
  const h = await harness();
  try {
    expect(await h.start('no-canary')).toMatchObject({
      code: 'CANARY_REQUIRED',
    });
    expect(h.context).toBeUndefined();
    expect(h.fake.requests).toEqual([]);
    expect(await readdir(h.profile)).toEqual(['socialprune-profile.json']);
  } finally {
    await h.close();
  }
});
test.each([14, -12])(
  'click-only UTC window covers the filtered day at UTC%j',
  async (zone) => {
    const h = await harness();
    h.fake.setZone(zone);
    try {
      expect(await h.start(true)).toMatchObject({ completed: 1 });
      const files = await readdir(
        instagramContextDirectory(h.directory, IG_FIXTURE.code),
      );
      expect(files.sort()).toEqual(['image.png', 'shot.jpg']);
    } finally {
      await h.close();
    }
  },
);
test.each([
  ['time', 'time'],
  ['owner', 'owner'],
  ['several', 'several'],
  ['edited', 'text'],
  ['other-author', 'not-shown'],
  ['no-row', 'no-row'],
  ['window-full', 'window-full'],
  ['unavailable', null],
] as const)(
  'manual canary %s writes only the precise settling result %s, no record',
  async (variant, code) => {
    const h = await harness(variant);
    try {
      const result = h.start();
      await h.click('Start');
      await h.click('Continue');
      expect(await result).toMatchObject({ completed: 0, endReason: 'canary' });
      const attempts = await h.store.read((tx) => records(tx.browserAttempts));
      expect(attempts).toHaveLength(2);
      expect(attempts[1]!.code).toBe(code);
      expect(attempts[1]!.state).toBe(
        variant === 'unavailable'
          ? 'unavailable'
          : variant === 'no-row' || variant === 'window-full'
            ? 'not-listed'
            : 'unconfirmed',
      );
      expect(await h.store.read((tx) => records(tx.instagramContext))).toEqual(
        [],
      );
    } finally {
      await h.close();
    }
  },
);
test('Instagram daily counts ignore X runs, use workspace-zone days and leave X byte-for-byte unchanged', async () => {
  const h = await harness();
  try {
    await h.store.write((tx) =>
      tx.browserRuns.add({
        runId: 'generated-x-200',
        platform: 'x',
        accountKey: 'x:generated',
        mode: 'fill',
        planHash: 'f'.repeat(64),
        startedAt: IG_FIXTURE.now,
        endedAt: IG_FIXTURE.now,
        endReason: 'daily-cap',
        pageOpens: 200,
        bodyShapes: {},
        profileReport: null,
      }),
    );
    const xBefore = (
      await h.store.read((tx) => records(tx.browserRuns))
    ).filter((run) => run.platform === 'x');
    expect(
      await instagramDailyCount(
        h.store,
        h.plan.accountKey,
        new Date(IG_FIXTURE.now),
        h.plan.timeZone,
      ),
    ).toEqual({ used: 0, last: 0 });
    expect(await h.start(true)).toMatchObject({ completed: 1, steps: 1 });
    expect(
      (
        await instagramDailyCount(
          h.store,
          h.plan.accountKey,
          new Date(IG_FIXTURE.now),
          h.plan.timeZone,
        )
      ).used,
    ).toBe(1);
    expect(
      (await h.store.read((tx) => records(tx.browserRuns))).filter(
        (run) => run.platform === 'x',
      ),
    ).toEqual(xBefore);
    expect(
      (
        await instagramDailyCount(
          h.store,
          h.plan.accountKey,
          new Date('2026-10-15T23:00:00.000Z'),
          'Europe/Berlin',
        )
      ).used,
    ).toBe(0);
  } finally {
    await h.close();
  }
});
test('interrupted sending is recovered as failed INTERRUPTED before a fresh confirmed attempt, never ambiguous', async () => {
  const h = await harness();
  try {
    const writer = new InstagramContextWriter(h.store);
    await writer.startRun({
      runId: 'generated-dead-run',
      accountKey: h.plan.accountKey,
      planHash: h.plan.hash,
      startedAt: '2026-10-14T12:00:00.000Z',
      ownerPid: 2147483647,
    });
    await writer.sending({
      runId: 'generated-dead-run',
      attemptId: 'generated-interrupted',
      itemId: h.fixture.items[0]!.id,
      at: '2026-10-14T12:00:00.000Z',
    });
    expect(await h.start(true)).toMatchObject({ completed: 1 });
    const attempts = await h.store.read((tx) => records(tx.browserAttempts));
    expect(attempts.map((attempt) => attempt.state)).toEqual([
      'sending',
      'failed',
      'sending',
      'confirmed',
    ]);
    expect(attempts[1]!.code).toBe('INTERRUPTED');
  } finally {
    await h.close();
  }
});
test('extension addition refuses automatic acceptance, and no later click runs', async () => {
  const h = await harness();
  let changed = false;
  h.afterWait(async () => {
    if (!changed) {
      changed = true;
      await mkdir(
        join(h.profile, 'Default', 'Extensions', 'b'.repeat(32), '1'),
        { recursive: true },
      );
    }
  });
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CANARY_CHECK_FAILED' });
    expect(
      (await h.store.read((tx) => records(tx.browserRuns)))[0]!
        .canaryAcceptedAt,
    ).toBeNull();
  } finally {
    await h.close();
  }
});
test('extension removal is recorded but refuses automatic canary acceptance', async () => {
  const h = await harness();
  const path = join(h.profile, 'Default', 'Extensions', 'a'.repeat(32), '1');
  await mkdir(path, { recursive: true });
  h.afterLaunch(async () => {
    await rm(join(h.profile, 'Default', 'Extensions'), {
      recursive: true,
      force: true,
    });
  });
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CANARY_CHECK_FAILED' });
    expect(
      (await h.store.read((tx) => records(tx.browserRuns)))[0]!
        .canaryAcceptedAt,
    ).toBeNull();
  } finally {
    await h.close();
  }
});
test.each(['Does not match', 'Stop'])(
  'manual %s never accepts the canary or starts more comments',
  async (action) => {
    const h = await harness();
    try {
      const result = h.start();
      await h.click('Start');
      if (action === 'Does not match') {
        await h.click('Continue');
        await h.click(action);
      } else await h.click(action);
      expect(await result).not.toMatchObject({ completed: 2 });
      expect(
        (await h.store.read((tx) => records(tx.browserRuns)))[0]
          ?.canaryAcceptedAt,
      ).toBeNull();
    } finally {
      await h.close();
    }
  },
);
test('German end state names Instagram and remains served until the owned window closes', async () => {
  const h = await harness('de');
  try {
    const result = h.start(false, 'de');
    const page = await h.local();
    await h.click('Start');
    expect(await result).toMatchObject({ code: 'PAGE_LANGUAGE' });
    expect(h.notices.join('')).toContain('Schließe das Instagram-Fenster');
    expect(await page.locator('html').getAttribute('lang')).toBe('de');
    expect(await page.locator('#result').innerText()).not.toContain(
      'X-Fenster',
    );
  } finally {
    await h.close();
  }
});
test('second candidate gets a fresh list, a second paced step and exactly one confirmation attempt', async () => {
  const h = await harness('second-candidate');
  try {
    expect(await h.start(true)).toMatchObject({ completed: 1, steps: 2 });
    const attempts = await h.store.read((tx) => records(tx.browserAttempts));
    expect(attempts.map((attempt) => attempt.state)).toEqual([
      'sending',
      'confirmed',
    ]);
    expect(
      h.fake.requests.filter(
        (request) => request.path === '/your_activity/interactions/comments',
      ),
    ).toHaveLength(2);
  } finally {
    await h.close();
  }
});
test('four candidate rows settle several after at most three fresh steps', async () => {
  const h = await harness('four-candidates');
  try {
    const result = h.start();
    await h.click('Start');
    await h.click('Continue');
    expect(await result).toMatchObject({ completed: 0, steps: 3 });
    const attempts = await h.store.read((tx) => records(tx.browserAttempts));
    expect(attempts[1]).toMatchObject({
      state: 'unconfirmed',
      code: 'several',
    });
    expect(
      h.fake.requests.filter((request) => /^\/p\//.test(request.path)),
    ).toHaveLength(3);
  } finally {
    await h.close();
  }
});
test('foreign requests and WebSockets are aborted and counted, not treated as writes', async () => {
  let hits = 0;
  const decoy = createServer((_request, response) => {
    hits++;
    response.end('generated');
  });
  await new Promise<void>((resolve, reject) => {
    decoy.once('error', reject);
    decoy.listen(4419, '127.0.0.1', resolve);
  });
  const h = await harness('external');
  try {
    expect(await h.start(true)).toMatchObject({ completed: 1 });
    const run = (await h.store.read((tx) => records(tx.browserRuns)))[0]!;
    const report = JSON.parse(
      await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      ),
    ) as { abortedHosts: Record<string, number> };
    expect(report.abortedHosts['127.0.0.1:4419']).toBe(2);
    expect(hits).toBe(0);
    expect(
      run.profileReport!.unexpectedRequests.some(
        (request) => request.operation === 'CommentsQuery',
      ),
    ).toBe(true);
  } finally {
    await h.close();
    decoy.closeAllConnections();
    await new Promise<void>((resolve) => decoy.close(() => resolve()));
  }
});
test('account mismatch stops before filter clicks and post opens', async () => {
  const h = await harness('account-mismatch');
  try {
    expect(await h.start(true)).toMatchObject({ code: 'ACCOUNT_MISMATCH' });
    expect(
      h.fake.requests.some((request) => request.path.startsWith('/p/')),
    ).toBe(false);
    expect(h.fake.events.flatMap((value) => value.clicks)).toEqual([]);
  } finally {
    await h.close();
  }
});
test('red observer controls reject input/key, forbidden click, DOM insertion and a duplicate image request on decoys', async () => {
  const fixture = await instagramFixture(),
    fake = await fakeInstagram(4401, fixture.items),
    browser = await chromium.launch({ headless: true, chromiumSandbox: true });
  const context = await browser.newContext(),
    page = await context.newPage();
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === fake.origin
      ? route.continue()
      : route.abort(),
  );
  const confirmation = await startConfirmation(
    {
      phase: 'start',
      platform: 'instagram',
      warning: '',
      profileWarning: '',
      planned: 0,
      bulk: 0,
      estimateMs: 0,
      list: '',
      rows: [],
      completed: 0,
      result: '',
    },
    4402,
  );
  try {
    await page.goto(`${fake.origin}/p/${IG_FIXTURE.code}/`);
    await page.locator('input').fill('generated planted input');
    await page.locator('input').press('A');
    await page.getByRole('button', { name: 'Like', exact: true }).click();
    await page.addStyleTag({ content: '.generated-control{color:red}' });
    await expect
      .poll(() => fake.events.at(-1)?.inputs.length ?? 0)
      .toBeGreaterThan(0);
    await expect
      .poll(() => fake.events.at(-1)?.added.length ?? 0)
      .toBeGreaterThan(0);
    const events = fake.events.at(-1)!;
    const noInput = () => expect(events.inputs).toEqual([]),
      allowedClicks = () =>
        expect(
          events.clicks.every((click) =>
            (IG_FIXTURE.allowedClicks as readonly string[]).includes(click),
          ),
        ).toBe(true),
      noAddedNode = () => expect(events.added).toEqual([]);
    expect(noInput).toThrow();
    expect(allowedClicks).toThrow();
    expect(noAddedNode).toThrow();
    const before = fake.requests.filter((request) =>
      request.path.startsWith('/media/'),
    ).length;
    await page.request.get(
      `${fake.origin}/media/${IG_FIXTURE.code}.png?signature=generated-secret`,
    );
    expect(() =>
      expect(
        fake.requests.filter((request) => request.path.startsWith('/media/')),
      ).toHaveLength(before),
    ).toThrow();
    const count = events.clicks.length;
    await expect(
      clickAllowed(
        page,
        { kind: 'named', name: 'Like' } as unknown as Click,
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'UNEXPECTED_ACTION' });
    expect(fake.events.at(-1)!.clicks).toHaveLength(count);
    expect(() =>
      expect(
        JSON.stringify({ forbidden: IG_FIXTURE.other.text }),
      ).not.toContain(IG_FIXTURE.other.text),
    ).toThrow();
  } finally {
    await confirmation.close();
    await browser.close();
    await fake.close();
  }
});
test('daily cap refuses an ordered canary before any list access without changing X', async () => {
  const h = await harness('success', 2);
  try {
    const writer = new InstagramContextWriter(h.store);
    await writer.startRun({
      runId: 'generated-ig-cap',
      accountKey: h.plan.accountKey,
      planHash: h.plan.hash,
      startedAt: IG_FIXTURE.now,
    });
    for (let index = 0; index < 200; index++)
      await writer.step('generated-ig-cap', IG_FIXTURE.now);
    await writer.endRun({
      runId: 'generated-ig-cap',
      endedAt: IG_FIXTURE.now,
      endReason: 'daily-cap',
      bodyShapes: {},
      profileReport: {
        accountBefore: h.plan.handle,
        accountAfter: h.plan.handle,
        extensionsBefore: 0,
        extensionsAfter: 0,
        changedFiles: [],
        unexpectedRequests: [],
      },
    });
    expect(await h.start(true)).toMatchObject({ code: 'CANARY_CHECK_FAILED' });
    const run = (await h.store.browserJournal()).runs.at(-1)!;
    expect(run).toMatchObject({
      pageOpens: 0,
      endReason: 'error',
      canaryAcceptedAt: null,
    });
    expect(h.fake.requests).toEqual([]);
  } finally {
    await h.close();
  }
});
test('a full run uses accepted canary, observes limit and a pause before step 21', async () => {
  const h = await harness('success', 2);
  try {
    const writer = new InstagramContextWriter(h.store),
      item = h.fixture.items[1]!;
    await writer.startRun({
      runId: 'generated-accepted',
      accountKey: h.plan.accountKey,
      planHash: h.plan.hash,
      startedAt: '2026-10-14T12:00:00.000Z',
    });
    await writer.sending({
      runId: 'generated-accepted',
      attemptId: 'generated-confirmed',
      itemId: item.id,
      at: '2026-10-14T12:00:00.000Z',
    });
    await writer.confirm({
      itemId: item.id,
      accountKey: h.plan.accountKey,
      post: {
        kind: 'p',
        code: 'Prior_canary',
        owner: item.reference.ownerHandle!,
        ownerCount: 1,
        caption: null,
        captionComplete: true,
        createdAt: null,
      },
      comment: { id: '778899', createdAt: item.createdAt, expandClicks: 0 },
      image: { file: null, host: null, status: 'not-captured' },
      screenshot: { file: null, bytes: null, status: 'failed' },
      confirmedAt: '2026-10-14T12:00:00.000Z',
      runId: 'generated-accepted',
      attemptId: 'generated-confirmed',
    });
    await writer.endRun({
      runId: 'generated-accepted',
      endedAt: '2026-10-14T12:00:00.000Z',
      endReason: 'canary',
      bodyShapes: {},
      profileReport: {
        accountBefore: h.plan.handle,
        accountAfter: h.plan.handle,
        extensionsBefore: 0,
        extensionsAfter: 0,
        changedFiles: [],
        unexpectedRequests: [],
      },
    });
    await writer.acceptCanary('generated-accepted', '2026-10-14T12:00:00.000Z');
    await writer.startRun({
      runId: 'generated-ig-batch',
      accountKey: h.plan.accountKey,
      planHash: h.plan.hash,
      startedAt: IG_FIXTURE.now,
    });
    for (let index = 0; index < 20; index++)
      await writer.step('generated-ig-batch', IG_FIXTURE.now);
    await writer.endRun({
      runId: 'generated-ig-batch',
      endedAt: IG_FIXTURE.now,
      endReason: 'done',
      bodyShapes: {},
      profileReport: {
        accountBefore: h.plan.handle,
        accountAfter: h.plan.handle,
        extensionsBefore: 0,
        extensionsAfter: 0,
        changedFiles: [],
        unexpectedRequests: [],
      },
    });
    await h.refresh();
    h.setLimit(1);
    expect(h.plan.canary).toBe(false);
    expect(await h.start('no-canary')).toMatchObject({
      completed: 1,
      steps: 1,
      endReason: 'done',
    });
    expect(h.waits).toContain(900000);
    expect(
      h.fake.requests.filter(
        (request) => request.path === '/your_activity/interactions/comments',
      ),
    ).toHaveLength(1);
  } finally {
    await h.close();
  }
});
test('the unchanged X fill counter ignores 200 Instagram steps in the same workspace day', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-ig-x-count-')),
    profile = join(directory, 'profile');
  const ig = await instagramFixture(),
    workspace = xFixtureWorkspace(['1001']);
  workspace.items[0]!.kind = 'reply';
  workspace.items[0]!.reference.replyToId = DETAIL_FIXTURE.id;
  workspace.items.push(...ig.items);
  workspace.imports.push(...ig.workspace.imports);
  workspace.originals = [
    migrateOriginal({
      id: DETAIL_FIXTURE.id,
      status: 'fetched',
      fetchedAt: X_FIXTURE.now,
      text: 'Generated beginning',
      authorName: DETAIL_FIXTURE.name,
      authorHandle: DETAIL_FIXTURE.handle,
      photos: [],
      quotedId: null,
      parentId: null,
      raw: { note_tweet: {} },
      textCompleteness: 'truncated',
      video: null,
    }),
  ];
  workspace.counts.items = workspace.items.length;
  workspace.counts.imports = workspace.imports.length;
  workspace.counts.originals = 1;
  await createProfile(profile);
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: workspace,
  });
  const igWriter = new InstagramContextWriter(store);
  await igWriter.startRun({
    runId: 'generated-ig-prior-cap',
    accountKey: ig.items[0]!.account.key,
    planHash: 'a'.repeat(64),
    startedAt: X_FIXTURE.now,
  });
  for (let step = 0; step < 200; step++)
    await igWriter.step('generated-ig-prior-cap', X_FIXTURE.now);
  await igWriter.endRun({
    runId: 'generated-ig-prior-cap',
    endedAt: X_FIXTURE.now,
    endReason: 'daily-cap',
    bodyShapes: {},
    profileReport: {
      accountBefore: ig.items[0]!.account.handle,
      accountAfter: ig.items[0]!.account.handle,
      extensionsBefore: 0,
      extensionsAfter: 0,
      changedFiles: [],
      unexpectedRequests: [],
    },
  });
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url!);
    if (request.url!.startsWith('/i/api/graphql/')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify(
          detailAnswer({
            ...detailPost(),
            note_tweet: {
              note_tweet_results: { result: { text: DETAIL_FIXTURE.longText } },
            },
          }),
        ),
      );
      return;
    }
    const account = `<button data-testid="SideNav_AccountSwitcher_Button">Generated @${X_FIXTURE.account.handle}</button>`;
    if (request.url === '/home') {
      response.end(account);
      return;
    }
    response.end(
      `${account}<article data-testid="tweet"><a href="/generated/status/${DETAIL_FIXTURE.id}"><time>2026</time></a><p data-testid="tweetText">${DETAIL_FIXTURE.longText}</p></article><script>fetch('/i/api/graphql/generated/TweetDetail?variables='+encodeURIComponent(JSON.stringify({focalTweetId:'${DETAIL_FIXTURE.id}'})))</script>`,
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(4403, '127.0.0.1', resolve);
  });
  let context: BrowserContext | undefined;
  try {
    const plan = await planFill(store, X_FIXTURE.account.key),
      before = await store.read((tx) => records(tx.browserRuns));
    const result = await runFillWithDependencies(
      {
        store,
        plan,
        workspace: directory,
        profile,
        executablePath: chromium.executablePath(),
        list: 'generated-list',
        limit: 1,
        include: new Set(),
        maxVideoBytes: 1024 ** 3,
        maxRunBytes: 20 * 1024 ** 3,
        order: {
          value: {
            scope: 'originals-fill-x',
            account: X_FIXTURE.account.handle,
            givenAt: X_FIXTURE.now,
            words: 'Read this generated X original.',
            maxPages: 1,
          },
          sha256: 'b'.repeat(64),
        },
        signal: new AbortController().signal,
        now: () => new Date(X_FIXTURE.now),
        notice() {},
      },
      {
        origin: 'http://127.0.0.1:4403',
        port: 4404,
        responseMs: 5000,
        intervalMs: 0,
        batch: 20,
        pauseMs: 0,
        media: productionMedia,
        syndication: new SyndicationClient({
          baseUrl: 'http://127.0.0.1:4403',
        }),
        async launch() {
          context = await chromium.launchPersistentContext(profile, {
            executablePath: chromium.executablePath(),
            headless: true,
            chromiumSandbox: true,
            args: ['--enable-automation'],
            ignoreDefaultArgs: ['--disable-infobars'],
            serviceWorkers: 'block',
          });
          return context;
        },
        async sleep() {},
        async close() {
          await context?.close();
        },
      },
    );
    expect(result).toMatchObject({ completed: 1, endReason: 'canary' });
    expect(requests.some((path) => path.includes('/status/'))).toBe(true);
    expect(
      (await store.read((tx) => records(tx.browserRuns))).filter(
        (run) => run.platform === 'instagram',
      ),
    ).toEqual(before);
  } finally {
    await context?.close();
    await store.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});
test('screenshot over the limit refuses automatic acceptance without a context record', async () => {
  const h = await harness();
  h.setCapture(async (...args) => {
    const result = await capturePost(...args);
    return {
      ...result,
      screenshot: { file: null, bytes: null, status: 'too-large' },
    };
  });
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CANARY_CHECK_FAILED' });
    expect(await h.store.read((tx) => records(tx.instagramContext))).toEqual(
      [],
    );
    expect(
      (await h.store.read((tx) => records(tx.browserRuns)))[0]!
        .canaryAcceptedAt,
    ).toBeNull();
  } finally {
    await h.close();
  }
});
test('disk-low has its closed stop token in report and terminal, and accepts nothing', async () => {
  const h = await harness();
  h.setCapture((workspace, code, element, source, images, policy) =>
    capturePost(workspace, code, element, source, images, policy, () =>
      Promise.resolve(0),
    ),
  );
  try {
    expect(await h.start(true)).toMatchObject({ code: 'DISK_LOW' });
    const run = (await h.store.read((tx) => records(tx.browserRuns)))[0]!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      stop: { code: 'DISK_LOW', token: 'disk-low' },
    });
    expect(h.notices.join('')).toContain('Stop detail: disk-low');
  } finally {
    await h.close();
  }
});
test('first five canary comments are paced and a later full run needs a fresh plan', async () => {
  const h = await harness('success', 6);
  try {
    expect(await h.start(true)).toMatchObject({
      completed: 5,
      steps: 5,
      endReason: 'canary',
    });
    expect(h.waits.filter((wait) => wait > 2000).length).toBeGreaterThanOrEqual(
      4,
    );
    const after = await planContext(h.store, h.plan.accountKey);
    expect(after.canary).toBe(false);
    expect(after.rows).toHaveLength(1);
    expect(after.hash).not.toBe(h.plan.hash);
  } finally {
    await h.close();
  }
});
