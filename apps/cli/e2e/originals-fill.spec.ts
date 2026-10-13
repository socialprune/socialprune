import { test, expect, chromium } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateOriginal } from '@socialprune/core';
import { SQLiteStore } from '../src/workspace/sqlite-store.ts';
import { fixtureWorkspace, FIXTURE } from './fake-x/fixture.ts';
import {
  detailAnswer,
  detailPost,
  DETAIL_FIXTURE,
} from '../src/originals/test/detail.ts';
import { runFillWithDependencies } from '../src/browser/x/fill/run.ts';
import { planFill, FILL_WARNING } from '../src/browser/x/fill/plan.ts';
import { createProfile, profileInUse } from '../src/browser/profile.ts';
import { productionMedia } from '../src/originals/video.ts';
import { SyndicationClient } from '../src/originals/syndication.ts';
import { CliError } from '../src/cli/errors.ts';
import { fileURLToPath } from 'node:url';
for (const variant of [
  'success',
  'flag-account',
  'flag-account-mismatch',
  'missing-id',
  'login',
  'challenge',
  'limit',
  '429',
  'never',
  'unexpected',
  'background',
  'does-not-match',
  'stop',
  'stale',
  'extension',
  'extension-at-matches',
  'canary-five',
  'shared-cap',
  'unavailable',
  'tombstone',
] as const)
  test(`page-driven fill ${variant}: Start, exact GET response, stop and canary acceptance`, async ({}, testInfo) => {
    const directory = await mkdtemp(join(tmpdir(), 'socialprune-fill-fake-'));
    const workspace =
      variant === 'canary-five'
        ? fixtureWorkspace()
        : fixtureWorkspace(['1001']);
    workspace.items[0]!.kind = 'reply';
    workspace.items[0]!.reference.replyToId = DETAIL_FIXTURE.id;
    if (variant === 'flag-account' || variant === 'flag-account-mismatch') {
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
    workspace.originals = [
      migrateOriginal({
        id: DETAIL_FIXTURE.id,
        status: 'fetched',
        fetchedAt: FIXTURE.now,
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
    workspace.counts.originals = 1;
    if (variant === 'canary-five') {
      workspace.items.forEach((item, index) => {
        item.reference.replyToId = String(910 + index);
      });
      workspace.originals = workspace.items.map((_, index) => ({
        ...workspace.originals![0]!,
        id: String(910 + index),
      }));
      workspace.counts.originals = 6;
    }
    const store = await SQLiteStore.open(
      join(directory, 'socialprune.sqlite'),
      {
        initial: workspace,
      },
    );
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
    if (variant === 'shared-cap') {
      const writer = store.browserOutcomeWriter(),
        run = {
          runId: 'generated-prior-delete',
          platform: 'x' as const,
          accountKey: FIXTURE.account.key,
          mode: 'delete' as const,
          planHash: 'a'.repeat(64),
          startedAt: FIXTURE.now,
          endedAt: null,
          endReason: null,
          bodyShapes: {},
          profileReport: null,
          pageOpens: 200,
          lastPageOpenedAt: FIXTURE.now,
        };
      await writer.begin(run);
      await writer.finish({
        ...run,
        endedAt: FIXTURE.now,
        endReason: 'daily-cap',
      });
    }
    let context: BrowserContext | undefined;
    let running: Promise<unknown> | undefined;
    const abort = new AbortController();
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? '');
      const pathname = (request.url ?? '').split('?')[0];
      response.setHeader('Content-Type', 'text/html');
      if (pathname?.startsWith('/i/api/graphql/')) {
        const id = (
          JSON.parse(
            new URL(request.url!, 'http://127.0.0.1:4231').searchParams.get(
              'variables',
            ) ?? '{}',
          ) as { focalTweetId: string }
        ).focalTweetId;
        const post = detailPost(id);
        if (variant === 'unavailable' || variant === 'tombstone') {
          Object.assign(post, {
            __typename:
              variant === 'unavailable' ? 'TweetUnavailable' : 'TweetTombstone',
            reason: 'generated-unavailable',
            tombstone: { text: { text: 'Generated withheld message' } },
          });
        }
        Object.assign(post, {
          note_tweet: {
            note_tweet_results: { result: { text: DETAIL_FIXTURE.longText } },
          },
        });
        response.setHeader('Content-Type', 'application/json');
        if (variant === 'never') return;
        if (variant === '429') {
          response.writeHead(429);
          response.end('{}');
          return;
        }
        if (variant === 'missing-id')
          delete (post as Partial<typeof post>).rest_id;
        response.end(JSON.stringify(detailAnswer(post)));
        return;
      }
      const account = `<button data-testid="SideNav_AccountSwitcher_Button">@${variant === 'flag-account-mismatch' ? DETAIL_FIXTURE.handle : FIXTURE.account.handle}</button>`;
      if (pathname === '/home') {
        response.end(account);
        return;
      }
      if (['login', 'challenge', 'limit'].includes(variant)) {
        response.end(
          `${account}<p data-testid="${variant === 'login' ? 'loginButton' : variant === 'challenge' ? 'challenge' : 'rateLimit'}">${variant === 'login' ? 'Log in to X' : variant === 'challenge' ? 'Confirm you are human' : 'Rate limit exceeded'}</p>`,
        );
        return;
      }
      response.end(
        `${account}${variant === 'unavailable' || variant === 'tombstone' ? '<p>Generated unavailable message</p>' : `<article data-testid="tweet"><a href="/generated/status/${pathname!.split('/').at(-1)}"><time>2026</time></a></article>`}<script>${variant === 'unexpected' || variant === 'background' ? `fetch('${variant === 'unexpected' ? '/i/api/graphql/generated/FavoriteTweet' : '/i/api/telemetry'}',{method:'POST'});` : ''}fetch('/i/api/graphql/generated/TweetDetail?variables='+encodeURIComponent(JSON.stringify({focalTweetId:'${pathname!.split('/').at(-1)}'})))</script>`,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(4231, '127.0.0.1', resolve),
    );
    try {
      const plan = await planFill(store, workspace.items[0]!.account.key);
      if (variant === 'flag-account' || variant === 'flag-account-mismatch') {
        expect(plan.handle).toBe('');
        plan.handle = FIXTURE.account.handle;
      }
      let now = Date.parse(FIXTURE.now);
      const waits: number[] = [];
      const result = runFillWithDependencies(
        {
          store,
          plan,
          profile,
          executablePath: chromium.executablePath(),
          list: 'generated list',
          workspace: directory,
          signal: abort.signal,
          limit: 200,
          maxVideoBytes: 1024 ** 3,
          maxRunBytes: 20 * 1024 ** 3,
          include: new Set(),
          now: () => new Date(now),
          notice: () => {},
        },
        {
          origin: 'http://127.0.0.1:4231',
          port: 4232,
          responseMs: variant === 'never' ? 200 : 5000,
          intervalMs: 5,
          batch: 2,
          pauseMs: 11,
          media: {
            ...productionMedia,
            origin: 'http://127.0.0.1:4231',
            free: () => Promise.resolve(10 * 1024 ** 3),
          },
          syndication: new SyndicationClient({
            baseUrl: 'http://127.0.0.1:4231',
          }),
          async launch() {
            context = await chromium.launchPersistentContext(profile, {
              executablePath: chromium.executablePath(),
              headless: true,
              chromiumSandbox: true,
              args: ['--enable-automation'],
              ignoreDefaultArgs: ['--disable-infobars'],
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
            return context;
          },
          async sleep(ms) {
            await Promise.resolve();
            waits.push(ms);
            now += ms;
          },
          async close() {},
        },
      ).then(
        (value) => value,
        (error) => error as CliError,
      );
      running = result;
      await expect
        .poll(() =>
          context
            ?.pages()
            .some((page) => page.url().startsWith('http://127.0.0.1:4232')),
        )
        .toBe(true);
      const page = context!.pages()[0]!;
      await expect(
        page.getByRole('button', { name: 'Start', exact: true }),
      ).toBeVisible();
      expect(requests).toEqual([]);
      await expect(page.locator('#account')).toHaveText(
        `Expected X account: @${FIXTURE.account.handle}`,
      );
      if (variant === 'flag-account')
        await page.screenshot({
          path: testInfo.outputPath('expected-account.png'),
          fullPage: true,
        });
      if (variant === 'extension') {
        await mkdir(
          join(profile, 'Default', 'Extensions', 'b'.repeat(32), '1.0'),
          { recursive: true },
        );
        await page.getByRole('button', { name: 'Start', exact: true }).click();
        await expect
          .poll(async () =>
            Boolean((await store.browserJournal()).runs.at(-1)?.endedAt),
          )
          .toBe(true);
        expect(await result).toMatchObject({ code: 'PLATFORM_CHECK' });
        expect(requests).toEqual([]);
        const run = (await store.browserJournal()).runs.at(-1)!;
        const report = JSON.parse(
          await readFile(
            join(profile, `socialprune-readback-${run.runId}.json`),
            'utf8',
          ),
        ) as { extensionIdsBefore: string[]; extensionIdsAfter: string[] };
        expect(report.extensionIdsBefore).toEqual([preinstalledId]);
        expect(report.extensionIdsAfter).toEqual([
          preinstalledId,
          'b'.repeat(32),
        ]);
        return;
      }
      await expect(page.locator('#warning')).toHaveText(FILL_WARNING.en);
      if (variant === 'stop') {
        await page.getByRole('button', { name: 'Stop', exact: true }).click();
        expect(await result).toMatchObject({ code: 'CANCELLED' });
        expect(requests).toEqual([]);
        return;
      }
      if (variant === 'stale') {
        await store.write(async (tx) => {
          const record = (await tx.originals.get(DETAIL_FIXTURE.id))!;
          await tx.originals.put({
            ...record,
            anonymous: { status: 'fetched', at: '2026-10-13T00:00:00.000Z' },
          });
        });
        await page.getByRole('button', { name: 'Start', exact: true }).click();
        expect(await result).toMatchObject({
          code: 'STALE_PLAN',
          message:
            'The plan changed. Make a new dry run and use its plan hash.',
        });
        expect(requests).toEqual([]);
        return;
      }
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      if (variant === 'flag-account-mismatch') {
        expect(await result).toMatchObject({ code: 'ACCOUNT_MISMATCH' });
        expect(requests.every((path) => path === '/home')).toBe(true);
        const journal = await store.browserJournal();
        expect(journal.attempts).toEqual([]);
        expect(journal.runs.at(-1)?.pageOpens ?? 0).toBe(0);
        expect(journal.runs.at(-1)?.endedAt).not.toBeNull();
        expect(
          (await store.read((tx) => tx.originals.get(DETAIL_FIXTURE.id)))
            ?.signedIn,
        ).toBeNull();
        return;
      }
      if (variant === 'shared-cap') {
        await expect
          .poll(async () =>
            Boolean(
              (await store.browserJournal()).runs.find(
                (run) => run.runId !== 'generated-prior-delete',
              )?.endedAt,
            ),
          )
          .toBe(true);
        expect(await result).toMatchObject({
          completed: 0,
          endReason: 'daily-cap',
        });
        expect(
          requests.filter((path) => path.startsWith('/i/api/graphql/')),
        ).toEqual([]);
        return;
      }
      if (
        [
          'missing-id',
          'login',
          'challenge',
          'limit',
          '429',
          'never',
          'unexpected',
        ].includes(variant)
      ) {
        await expect
          .poll(async () =>
            Boolean((await store.browserJournal()).runs.at(-1)?.endedAt),
          )
          .toBe(true);
        expect(await result).toMatchObject({
          code:
            variant === 'missing-id'
              ? 'SHAPE_CHANGED'
              : variant === 'unexpected'
                ? 'UNEXPECTED_ACTION'
                : 'PLATFORM_CHECK',
        });
        return;
      }
      await expect(
        page.getByRole('button', { name: 'Continue', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      if (variant === 'canary-five')
        for (let i = 1; i < 5; i++) {
          await expect(
            page.getByRole('button', { name: 'Continue', exact: true }),
          ).toBeVisible();
          await page
            .getByRole('button', { name: 'Continue', exact: true })
            .click();
        }
      await expect(
        page.getByRole('button', { name: 'Matches', exact: true }),
      ).toBeVisible();
      if (variant === 'extension-at-matches')
        await mkdir(
          join(profile, 'Default', 'Extensions', 'b'.repeat(32), '1.0'),
          { recursive: true },
        );
      await page
        .getByRole('button', {
          name: variant === 'does-not-match' ? 'Does not match' : 'Matches',
          exact: true,
        })
        .click();
      if (variant === 'extension-at-matches') {
        expect(await result).toMatchObject({ code: 'PLATFORM_CHECK' });
        expect((await store.browserJournal()).runs.at(-1)).toMatchObject({
          endReason: 'platform-check',
          canaryAcceptedAt: null,
        });
        return;
      }
      expect(await result).toMatchObject({
        completed: variant === 'canary-five' ? 5 : 1,
        endReason: 'canary',
      });
      if (variant === 'success') {
        const run = (await store.browserJournal()).runs.at(-1)!;
        const report = JSON.parse(
          await readFile(
            join(profile, `socialprune-readback-${run.runId}.json`),
            'utf8',
          ),
        ) as {
          extensionIdsBefore: string[];
          extensionIdsAfter: string[];
          extensionsDisabled: boolean;
        };
        expect(report).toMatchObject({
          extensionIdsBefore: [preinstalledId],
          extensionIdsAfter: [preinstalledId],
          extensionsDisabled: true,
        });
      }
      if (variant === 'canary-five') {
        const sends = (await store.browserJournal()).attempts.filter(
          (attempt) => attempt.state === 'sending',
        );
        expect(sends).toHaveLength(5);
        for (let i = 1; i < sends.length; i++)
          expect(
            Date.parse(sends[i]!.at) - Date.parse(sends[i - 1]!.at),
          ).toBeGreaterThanOrEqual(5);
        expect(waits.filter((ms) => ms === 11)).toHaveLength(2);
        expect((await planFill(store, FIXTURE.account.key)).canary).toBe(false);
        expect((await planFill(store, FIXTURE.account.key)).rows).toHaveLength(
          1,
        );
      }
      const original = await store.read((tx) =>
        tx.originals.get(variant === 'canary-five' ? '915' : DETAIL_FIXTURE.id),
      );
      if (variant === 'unavailable' || variant === 'tombstone') {
        expect(original?.signedIn?.status).toBe(variant);
        expect(original?.text).toBe('Generated beginning');
      } else expect(original?.text).toBe(DETAIL_FIXTURE.longText);
      for (const secret of DETAIL_FIXTURE.forbidden)
        expect(JSON.stringify(original)).not.toContain(secret);
      if (variant === 'does-not-match')
        expect(
          (await store.browserJournal()).runs[0]?.canaryAcceptedAt,
        ).toBeNull();
      else
        expect(
          (await store.browserJournal()).runs[0]?.canaryAcceptedAt,
        ).not.toBeNull();
    } finally {
      abort.abort();
      await context?.close();
      expect(await profileInUse(profile)).toBe(false);
      await running;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.close();
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  });
