import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import type { RunSession } from './run-session.ts';
import { RunControls } from './run-controls.ts';
import { createProfile } from './profile.ts';
import { runWithDependencies } from './runner.ts';
import { productionPace } from './pace.ts';
import { planDeletion } from './plan.ts';
import { runFillWithDependencies } from './x/fill/run.ts';
import { planFill } from './x/fill/plan.ts';
import { runContextWithDependencies } from './instagram/run.ts';
import { productionContext } from './instagram/driver.ts';
import { planContext } from './instagram/plan.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { fixtureWorkspace, FIXTURE } from '../../e2e/fake-x/fixture.ts';
import { instagramFixture } from '../../e2e/fake-instagram/fixture.ts';
import { productionMedia } from '../originals/video.ts';
import { SyndicationClient } from '../originals/syndication.ts';
import * as instagramNetwork from './instagram/network.ts';

test.each(
  (['delete', 'fill', 'context'] as const).flatMap((mode) =>
    (['finish', 'journal'] as const).map((fault) => ({ mode, fault })),
  ),
)(
  '$mode $fault projection failure cannot skip browser, confirmation or listener cleanup',
  async ({ mode, fault }) => {
    const directory = await mkdtemp(join(tmpdir(), 'sp-session-cleanup-'));
    const ig = await instagramFixture(1);
    const store = await SQLiteStore.open(
      join(directory, 'socialprune.sqlite'),
      {
        initial: mode === 'context' ? ig.workspace : fixtureWorkspace(['1001']),
      },
    );
    const profile = join(directory, 'profile');
    await createProfile(profile, mode === 'context' ? 'instagram' : 'x');
    await mkdir(join(directory, 'workspace'));
    const before = [
      process.listenerCount('SIGINT'),
      process.listenerCount('SIGTERM'),
    ];
    const signal = new AbortController();
    const closeConfirmation = vi.fn(() => Promise.resolve());
    const closeBrowser = vi.fn(() => Promise.resolve());
    const allowedOrigins: (string | undefined)[] = [];
    const failed = vi.fn();
    const networkOrigin = vi.spyOn(instagramNetwork, 'guardInstagramNetwork');
    const session: RunSession = {
      controls: new RunControls(
        () => new Date(FIXTURE.now),
        () => {},
      ),
      browser() {},
      failed,
      confirmation: () =>
        Promise.resolve({
          url: 'app://socialprune/',
          launchUrl: 'app://socialprune/',
          stopped: false,
          update(value) {
            if (fault === 'journal' && value.phase === 'ended')
              vi.spyOn(store, 'browserJournal').mockRejectedValueOnce(
                new Error('Generated projection failure'),
              );
          },
          wait: () => Promise.resolve(false),
          onStop() {},
          close: closeConfirmation,
        }),
      before() {},
      entry() {},
      progress() {},
      update() {},
      waiting() {},
      instagram() {},
      finish() {
        if (fault === 'finish') throw new Error('Generated projection failure');
      },
    };
    const page = {
      isClosed: () => false,
      close: () => Promise.resolve(),
      url: () => 'about:blank',
    } as unknown as Page;
    const context = Object.assign(new EventEmitter(), {
      route: () => Promise.resolve(),
      routeWebSocket: () => Promise.resolve(),
      pages: () => [],
      newPage: () => Promise.resolve(page),
      setOffline: () => Promise.resolve(),
    }) as unknown as BrowserContext;
    const account =
      mode === 'context' ? ig.items[0]!.account.key : FIXTURE.account.key;
    try {
      const common = {
        store,
        profile,
        executablePath: 'generated',
        list: '',
        workspace: join(directory, 'workspace'),
        signal: signal.signal,
        now: () => new Date(FIXTURE.now),
        notice() {},
        lang: 'en' as const,
        session,
        include: new Set<string>(),
        limit: 1,
      };
      const run =
        mode === 'delete'
          ? runWithDependencies(
              {
                ...common,
                plan: await planDeletion(store, account),
                verify: false,
              },
              {
                pace: productionPace('delete'),
                confirmationPort: 0,
                sleep: () => Promise.resolve(),
                driver: (configuration) => {
                  allowedOrigins.push(configuration.confirmationOrigin);
                  return Promise.resolve({
                    showConfirmation: () => Promise.resolve(),
                    account: () => Promise.resolve(FIXTURE.account.handle),
                    inspect: () => Promise.resolve('present' as const),
                    delete: () =>
                      Promise.resolve({
                        state: 'deleted' as const,
                        code: null,
                      }),
                    flush: () => Promise.resolve(),
                    close: closeBrowser,
                  });
                },
              },
            )
          : mode === 'fill'
            ? runFillWithDependencies(
                {
                  ...common,
                  plan: await planFill(store, account),
                  maxVideoBytes: 1024,
                  maxRunBytes: 1024,
                },
                {
                  origin: 'https://x.com',
                  port: 0,
                  responseMs: 100,
                  intervalMs: 30000,
                  batch: 20,
                  pauseMs: 900000,
                  launch: () => Promise.resolve(context),
                  sleep: () => Promise.resolve(),
                  close: closeBrowser,
                  media: productionMedia,
                  syndication: new SyndicationClient(),
                },
              )
            : runContextWithDependencies(
                { ...common, plan: await planContext(store, account) },
                {
                  ...productionContext,
                  launch: () => Promise.resolve(context),
                  sleep: () => Promise.resolve(),
                  close: closeBrowser,
                },
              );
      await run.catch(() => undefined);
      expect(closeBrowser).toHaveBeenCalledTimes(1);
      if (mode !== 'delete')
        expect(closeBrowser).toHaveBeenCalledWith(context, false);
      expect(closeConfirmation).toHaveBeenCalledTimes(1);
      expect([
        process.listenerCount('SIGINT'),
        process.listenerCount('SIGTERM'),
      ]).toEqual(before);
      expect(failed).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Generated projection failure' }),
      );
      if (mode === 'delete') expect(allowedOrigins).toEqual([undefined]);
      if (mode === 'context') expect(networkOrigin.mock.calls[0]?.[1]).toBe('');
    } finally {
      networkOrigin.mockRestore();
      signal.abort();
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
