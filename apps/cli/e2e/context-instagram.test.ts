import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi, onTestFinished } from 'vitest';
import { chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import type { Locator } from 'playwright-core';
import { SQLiteStore } from '../src/workspace/sqlite-store.ts';
import { createProfile, profileInUse } from '../src/browser/profile.ts';
import { planContext } from '../src/browser/instagram/plan.ts';
import { runContextWithDependencies } from '../src/browser/instagram/run.ts';
import type { ContextOrder } from '../src/browser/instagram/order.ts';
import { fakeInstagram } from './fake-instagram/server.ts';
import {
  instagramFixture,
  IG_FIXTURE,
  POST_NOTICE_FIXTURE,
} from './fake-instagram/fixture.ts';
import type { Variant } from './fake-instagram/fixture.ts';
import { instagramContextDirectory } from '../src/workspace/context-files.ts';
import { instagramDailyCount } from '../src/browser/instagram/pace.ts';
import { InstagramContextWriter } from '@socialprune/core/workspace/instagram-context-writer';
import { records } from '@socialprune/core/workspace/store';
import { capturePost } from '../src/browser/instagram/capture.ts';
import { startConfirmation } from '../src/browser/confirmation.ts';
import {
  clickAllowed,
  readPost,
  confirmComment,
  currentImageSource,
} from '../src/browser/instagram/selectors.ts';
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
import * as networkHelpers from '../src/browser/instagram/network.ts';
import * as pagesHelpers from '../src/browser/instagram/pages.ts';
import * as driverHelpers from '../src/browser/instagram/driver.ts';
import * as selectorHelpers from '../src/browser/instagram/selectors.ts';
import { CONTEXT_PORTS, CONTEXT_ORIGINS } from './fake-instagram/ports.ts';
import {
  filterList,
  openCandidate,
  productionContext,
  confirmOnPost,
} from '../src/browser/instagram/driver.ts';
import {
  chooseFilterDate,
  chooseFilterOption,
} from '../src/browser/instagram/filter.ts';
import { assertRecordedEvents } from './fake-instagram/recorder.ts';
import { contextDiagnostics } from './context-diagnostics.ts';
import { fakePageFailure } from './fake-instagram/failure.ts';
import { errorClass } from '../src/browser/instagram/report.ts';
import type { MemorySample } from '../src/browser/instagram/report.ts';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { IMAGE_CASES, imageCasePng } from './fake-instagram/image-cases.ts';
import type { SourceChecks } from '../src/browser/instagram/canary.ts';
import type { ImageDiagnostic } from '../src/browser/instagram/report.ts';

test.each([
  {
    variant: 'scroll-first',
    actions: IG_FIXTURE.scroll.first,
    confirmed: true,
  },
  {
    variant: 'scroll-late',
    actions: IG_FIXTURE.scroll.maximum,
    confirmed: false,
  },
  {
    variant: 'scroll-ten',
    actions: IG_FIXTURE.scroll.maximum,
    confirmed: false,
  },
  {
    variant: 'scroll-never',
    actions: IG_FIXTURE.scroll.empty,
    confirmed: false,
  },
  { variant: 'scroll-no-column', actions: 0, confirmed: false },
] as const)(
  'C8 $variant expands only the comment column with bounded actions and three-second spacing',
  async ({ variant, actions, confirmed }) => {
    const h = await filterHarness(variant);
    let now = 0;
    const times: number[] = [];
    const move = vi.spyOn(h.page.mouse, 'move');
    const originalWheel = h.page.mouse.wheel.bind(h.page.mouse);
    const wheel = vi
      .spyOn(h.page.mouse, 'wheel')
      .mockImplementation(async (...args) => {
        times.push(now);
        return originalWheel(...args);
      });
    try {
      await h.page.goto(`${h.fake.origin}/p/${IG_FIXTURE.code}`);
      const read = await confirmOnPost(
        h.page,
        h.fixture.items[0]!,
        h.fixture.items[0]!.account.handle!,
        {
          ...productionContext,
          origin: h.fake.origin,
          sleep: async (ms) => {
            expect(ms).toBeGreaterThanOrEqual(3000);
            now += ms;
            await new Promise((resolve) => setTimeout(resolve, 30));
          },
        },
        () => {},
      );
      expect(read.result).toMatchObject(
        confirmed
          ? { state: 'confirmed' }
          : { state: 'unconfirmed', code: 'not-shown' },
      );
      expect(read.expandClicks).toBe(actions);
      expect(wheel).toHaveBeenCalledTimes(actions);
      expect(move).toHaveBeenCalledTimes(actions);
      expect(times).toHaveLength(actions);
      for (let index = 0; index < times.length; index++)
        expect(times[index]! - (times[index - 1] ?? 0)).toBeGreaterThanOrEqual(
          3000,
        );
      await expect
        .poll(() => h.fake.events.at(-1)?.wheels.length ?? 0)
        .toBe(actions);
      assertRecordedEvents(h.fake.events);
      expect(h.fake.events.flatMap((event) => event.clicks)).toEqual([]);
      if (actions)
        expect(h.fake.events.at(-1)!.wheels).toEqual(
          Array.from({ length: actions }, () => ({
            area: 'post-comments',
            x: 0,
            y: 700,
          })),
        );
    } finally {
      wheel.mockRestore();
      move.mockRestore();
      await h.close();
    }
  },
);
test.each(['outside-wheel', 'column-click'] as const)(
  'C8 recorder rejects %s on a post without loading comments',
  async (mode) => {
    const h = await filterHarness('scroll-first');
    try {
      await h.page.goto(`${h.fake.origin}/p/${IG_FIXTURE.code}`);
      if (mode === 'outside-wheel') {
        await h.page.mouse.move(700, 30);
        await h.page.mouse.wheel(0, 700);
        await expect
          .poll(() => h.fake.events.at(-1)?.wheels.length ?? 0)
          .toBe(1);
      } else {
        await h.page.locator('#comments').click();
        await expect
          .poll(() => h.fake.events.at(-1)?.clicks.length ?? 0)
          .toBe(1);
      }
      expect(() => assertRecordedEvents(h.fake.events)).toThrow();
      expect((await readPost(h.page, h.fake.origin)).comments).toHaveLength(10);
    } finally {
      await h.close();
    }
  },
);

test('C7r measured comment rows keep the author outside one text candidate and read caption breaks and hashtag without translation', async () => {
  const h = await filterHarness();
  try {
    await h.page.goto(`${h.fake.origin}/p/${IG_FIXTURE.code}`);
    const link = h.page.locator(
      `a[href="/p/${IG_FIXTURE.code}/c/${IG_FIXTURE.commentId}/"]`,
    );
    const block = link.locator('xpath=ancestor::*[3]');
    expect(await block.locator(':scope > div').count()).toBe(2);
    expect(await block.locator('span[dir="auto"]').count()).toBe(4);
    expect(
      await block
        .locator(
          'xpath=.//span[@dir="auto" and not(ancestor::a) and not(ancestor::span[@dir="auto"])]',
        )
        .count(),
    ).toBe(3);
    const textRow = block.locator(':scope > div').nth(1);
    expect(await textRow.locator('a[href*="/c/"]').count()).toBe(0);
    expect(await textRow.innerText()).toBe(h.fixture.items[0]!.text);
    expect(
      await block
        .locator(':scope > div')
        .first()
        .locator(`a[href="/${h.fixture.items[0]!.account.handle}/"]`)
        .count(),
    ).toBe(1);
    const captionSpan = h.page
      .locator('main > section')
      .nth(1)
      .locator(
        'xpath=./div[span[@dir="auto"]/div/div//time[not(ancestor::a)]]/span[@dir="auto"]/div/span',
      );
    expect(await captionSpan.innerText()).toBe(
      `${IG_FIXTURE.captionLine}\n${IG_FIXTURE.captionTag}`,
    );
    const post = await readPost(h.page, h.fake.origin);
    expect(post.comments).toHaveLength(2);
    expect(post.comments).toContainEqual({
      username: h.fixture.items[0]!.account.handle,
      text: h.fixture.items[0]!.text,
      id: IG_FIXTURE.commentId,
      createdAt: h.fixture.items[0]!.createdAt,
    });
    expect(post).toMatchObject({
      caption: IG_FIXTURE.caption,
      captionComplete: true,
    });
    expect(post.caption).not.toContain('See translation');
    expect(h.fake.events.flatMap((event) => event.clicks)).toEqual([]);
  } finally {
    await h.close();
  }
});
test.each(['comment-hashtag', 'comment-mention'] as const)(
  'C7r %s keeps permitted text links while reading the single author outside the candidate',
  async (variant) => {
    const h = await filterHarness(variant);
    try {
      await h.page.goto(`${h.fake.origin}/p/${IG_FIXTURE.code}`);
      const post = await readPost(h.page, h.fake.origin);
      const suffix =
        variant === 'comment-hashtag'
          ? IG_FIXTURE.commentTag
          : '@' + IG_FIXTURE.other.username;
      const text = h.fixture.items[0]!.text + ' ' + suffix;
      expect(post.comments).toContainEqual({
        username: h.fixture.items[0]!.account.handle,
        text,
        id: IG_FIXTURE.commentId,
        createdAt: h.fixture.items[0]!.createdAt,
      });
      expect(
        confirmComment(
          post,
          { ...h.fixture.items[0]!, text },
          h.fixture.items[0]!.account.handle!,
        ),
      ).toMatchObject({ state: 'confirmed' });
    } finally {
      await h.close();
    }
  },
);
test.each([
  'block-text-time',
  'block-text-image',
  'block-text-button',
  'block-text-permalink',
  'block-old-two-level',
] as const)(
  'C7r %s is skipped without falling back to the name or age row',
  async (variant) => {
    const h = await filterHarness(variant);
    try {
      await h.page.goto(`${h.fake.origin}/p/${IG_FIXTURE.code}`);
      const post = await readPost(h.page, h.fake.origin);
      expect(post.comments).toEqual([
        {
          username: IG_FIXTURE.other.username,
          text: IG_FIXTURE.other.text,
          id: '987654321',
          createdAt: IG_FIXTURE.other.time,
        },
      ]);
      expect(
        confirmComment(
          post,
          h.fixture.items[0]!,
          h.fixture.items[0]!.account.handle!,
        ),
      ).toEqual({ state: 'unconfirmed', code: 'not-shown' });
    } finally {
      await h.close();
    }
  },
);
test.each([
  'caption-no-text',
  'caption-extra-text',
  'caption-no-wrapper',
  'caption-no-time',
  'caption-linked-time',
  'caption-text-button',
] as const)(
  'C7r %s leaves the present but unknown caption incomplete',
  async (variant) => {
    const h = await filterHarness(variant);
    try {
      await h.page.goto(`${h.fake.origin}/p/${IG_FIXTURE.code}`);
      const post = await readPost(h.page, h.fake.origin);
      expect(post).toMatchObject({ caption: null, captionComplete: false });
    } finally {
      await h.close();
    }
  },
);
test('C7r a truly absent caption block remains null and complete', async () => {
  const h = await filterHarness('empty-caption');
  try {
    await h.page.goto(`${h.fake.origin}/p/${IG_FIXTURE.code}`);
    expect(await readPost(h.page, h.fake.origin)).toMatchObject({
      caption: null,
      captionComplete: true,
    });
  } finally {
    await h.close();
  }
});

test.each(['success', 'reel', 'reel-links', 'same-owner-links'] as const)(
  'C7 %s reads the main post own-link owner and date, nested comment text and caption',
  async (variant) => {
    const h = await filterHarness(variant);
    try {
      const kind = variant === 'reel' ? 'reel' : 'p';
      await h.page.goto(`${h.fake.origin}/${kind}/${IG_FIXTURE.code}/`);
      expect(await h.page.locator('main').count()).toBe(1);
      expect(await h.page.locator('main section').count()).toBe(2);
      expect(
        await h.page.locator('article,header,ul,li,[role="dialog"]').count(),
      ).toBe(0);
      const post = await readPost(h.page, h.fake.origin);
      expect(post).toMatchObject({
        kind,
        code: IG_FIXTURE.code,
        owner: h.fixture.items[0]!.reference.ownerHandle,
        ownerCount: 1,
        createdAt: IG_FIXTURE.postAt,
        caption: IG_FIXTURE.caption,
        captionComplete: true,
      });
      expect(post.comments).toContainEqual({
        username: h.fixture.items[0]!.account.handle,
        text: h.fixture.items[0]!.text,
        id: IG_FIXTURE.commentId,
        createdAt: h.fixture.items[0]!.createdAt,
      });
      expect(await post.element.locator('xpath=self::main').count()).toBe(1);
      expect(
        confirmComment(
          post,
          h.fixture.items[0]!,
          h.fixture.items[0]!.account.handle!,
        ),
      ).toMatchObject({ state: 'confirmed' });
    } finally {
      await h.close();
    }
  },
);
test.each([
  'owner',
  'owner-first-profile',
  'owner-picture-profile',
  'collaboration',
] as const)(
  'C7 %s rejects inconsistent own-link ownership as owner',
  async (variant) => {
    const h = await filterHarness(variant);
    try {
      await h.page.goto(`${h.fake.origin}/p/${IG_FIXTURE.code}/`);
      const post = await readPost(h.page, h.fake.origin);
      expect(post.ownerCount).toBe(variant === 'collaboration' ? 2 : 1);
      expect(
        confirmComment(
          post,
          h.fixture.items[0]!,
          h.fixture.items[0]!.account.handle!,
        ),
      ).toEqual({ state: 'unconfirmed', code: 'owner' });
    } finally {
      await h.close();
    }
  },
);
test.each([
  'block-two-texts',
  'block-no-text',
  'block-text-in-link',
  'block-two-profiles',
  'block-profile-label',
  'block-profile-image',
  'block-time-count',
  'block-wrong-depth',
  'block-wrong-code',
  'block-query-permalink',
] as const)(
  'C7 %s skips an unrecognized comment block instead of guessing',
  async (variant) => {
    const h = await filterHarness(variant);
    try {
      await h.page.goto(`${h.fake.origin}/p/${IG_FIXTURE.code}/`);
      const post = await readPost(h.page, h.fake.origin);
      expect(post.comments).toEqual([
        {
          username: IG_FIXTURE.other.username,
          text: IG_FIXTURE.other.text,
          id: '987654321',
          createdAt: IG_FIXTURE.other.time,
        },
      ]);
      expect(
        confirmComment(
          post,
          h.fixture.items[0]!,
          h.fixture.items[0]!.account.handle!,
        ),
      ).toEqual({ state: 'unconfirmed', code: 'not-shown' });
    } finally {
      await h.close();
    }
  },
);
test.each(['success', 'reel'] as const)(
  'C7 %s row opening waits for a slashless address and main own-link time',
  async (variant) => {
    const h = await filterHarness(variant);
    try {
      await h.open();
      expect(
        await openCandidate(
          h.page,
          0,
          {
            ...productionContext,
            origin: h.fake.origin,
            responseMs: 1000,
          },
          () => {},
        ),
      ).toBe(true);
      expect(h.page.url()).toBe(
        `${h.fake.origin}/${variant === 'reel' ? 'reel' : 'p'}/${IG_FIXTURE.code}`,
      );
    } finally {
      await h.close();
    }
  },
);
test.each(['post-no-own-time', 'post-other-code', 'post-two-main'] as const)(
  'C7 %s cannot satisfy post readiness or readPost',
  async (variant) => {
    const h = await filterHarness(variant);
    try {
      await h.open();
      await expect(
        openCandidate(
          h.page,
          0,
          {
            ...productionContext,
            origin: h.fake.origin,
            responseMs: 300,
          },
          () => {},
        ),
      ).rejects.toMatchObject({
        code: 'INSTAGRAM_SHAPE_CHANGED',
        token: 'post-structure',
      });
      await expect(readPost(h.page, h.fake.origin)).rejects.toMatchObject({
        code: 'INSTAGRAM_SHAPE_CHANGED',
        token: 'post-structure',
      });
    } finally {
      await h.close();
    }
  },
);
test('C7 media image ignores earlier profile images and unlinked images in comment blocks', async () => {
  const h = await filterHarness('media-decoys');
  try {
    await h.page.goto(`${h.fake.origin}/p/${IG_FIXTURE.code}`);
    expect(await currentImageSource(h.page)).toBe(
      `${h.fake.origin}/media/${IG_FIXTURE.code}.png?signature=generated-secret`,
    );
  } finally {
    await h.close();
  }
});
test('C7 main media supplies the first image and actual screenshot, while fixture decoys stay out of structured workspace data', async () => {
  const h = await harness('media-decoys');
  let capturedMain = false;
  let captureFailure: Error | undefined;
  h.setCapture(async (...args) => {
    try {
      const element = args[2];
      expect(await element.locator('xpath=self::main').count()).toBe(1);
      expect(await element.locator('a[href] img').count()).toBeGreaterThan(0);
      const postPage = h
        .context!.pages()
        .find((page) => page.url().startsWith(h.fake.origin + '/p/'))!;
      expect(args[3]).toBe(
        `${h.fake.origin}/media/${IG_FIXTURE.code}.png?signature=generated-secret`,
      );
      expect(await currentImageSource(postPage)).toBe(args[3]);
      const screenshot = vi.spyOn(
        Object.getPrototypeOf(element) as Locator,
        'screenshot',
      );
      try {
        const result = await capturePost(...args);
        expect(screenshot).toHaveBeenCalledExactlyOnceWith({
          type: 'jpeg',
          quality: 60,
          scale: 'css',
          caret: 'initial',
          animations: 'allow',
          timeout: 30000,
        });
        expect(result).toMatchObject({
          image: { status: 'stored' },
          screenshot: { status: 'stored' },
        });
        capturedMain = true;
        return result;
      } finally {
        screenshot.mockRestore();
      }
    } catch (error) {
      captureFailure =
        error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  });
  try {
    const running = h.start();
    await h.click('Start');
    await expect
      .poll(() => capturedMain || captureFailure !== undefined, {
        timeout: 30000,
      })
      .toBe(true);
    if (captureFailure) throw captureFailure;
    await h.click('Continue');
    await h.click('Matches');
    expect(await running).toMatchObject({
      completed: 1,
      endReason: 'canary',
    });
    expect(capturedMain).toBe(true);
    const values = JSON.stringify({
      journal: await h.store.browserJournal(),
      records: await h.store.read((tx) => records(tx.instagramContext)),
    });
    for (const forbidden of [
      ...Object.values(IG_FIXTURE.other),
      ...Object.values(IG_FIXTURE.postDecoys),
    ])
      expect(values).not.toContain(forbidden);
    expect(
      h.fake.requests.filter((request) => request.path.startsWith('/media/')),
    ).toEqual([{ method: 'GET', path: `/media/${IG_FIXTURE.code}.png` }]);
    expect(
      h.fake.requests.some((request) => request.path.startsWith('/profiles/')),
    ).toBe(true);
    const shot = await readFile(
      join(instagramContextDirectory(h.directory, IG_FIXTURE.code), 'shot.jpg'),
    );
    expect(shot.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  } finally {
    await h.close();
  }
});

test('C6 first canary reloads after the unfiltered oldest probe, records two list navigations and one step without extra pace or empty-row counts', async () => {
  const h = await harness('year-empty-rows');
  h.setLimit(1);
  const starts: { at: string | null; sends: number }[] = [];
  h.fake.beforeList(async () => {
    const journal = await h.store.browserJournal();
    starts.push({
      at: journal.runs.at(-1)!.lastPageOpenedAt ?? null,
      sends: journal.attempts.filter((attempt) => attempt.state === 'sending')
        .length,
    });
    // The second document has a different age display. A diagnostic recomputed
    // from the reloaded or filtered list would no longer agree with eight years.
    if (starts.length === 2) h.fake.setVariant('empty-image-buttons');
  });
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CANARY_CHECK_FAILED' });
    const run = (await h.store.browserJournal()).runs[0]!;
    const report = JSON.parse(
      await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(
      h.fake.requests.filter(
        (request) => request.path === '/your_activity/interactions/comments',
      ),
    ).toHaveLength(2);
    expect(starts).toHaveLength(2);
    expect(starts[0]).toEqual(starts[1]);
    expect(starts[0]!.sends).toBe(1);
    expect(h.waits.every((wait) => wait === 2000)).toBe(true);
    expect(report).toMatchObject({
      rows: { emptySkipped: 3 },
      steps: [{ oldestWithinWeek: true, emptySkipped: 3 }],
      limits: { ready: { list: { count: 2 }, post: { count: 1 } } },
    });
    expect(
      await h.store.read((tx) => records(tx.instagramContext)),
    ).toHaveLength(1);
  } finally {
    await h.close();
  }
});
test('C6 fake refuses a second filter opening after Apply until a fresh list navigation', async () => {
  const h = await filterHarness();
  try {
    await h.open();
    await filterList(h.page, h.fixture.items[0]!.createdAt, () => {});
    await clickAllowed(
      h.page,
      { kind: 'named', name: 'Sort & filter' },
      () => {},
    );
    expect(await h.page.locator('[role="dialog"]').count()).toBe(0);
    await expect(
      clickAllowed(
        h.page,
        { kind: 'named', name: 'Oldest to newest' },
        () => {},
      ),
    ).rejects.toMatchObject({
      code: 'INSTAGRAM_SHAPE_CHANGED',
      token: 'filter-control',
    });
    await h.open();
    await filterList(h.page, h.fixture.items[0]!.createdAt, () => {});
    expect(await h.page.locator('[role="dialog"]').count()).toBe(0);
    expect(await h.page.locator('#list [role="button"]').count()).toBe(1);
    assertRecordedEvents(h.fake.events);
  } finally {
    await h.close();
  }
});
test.each(
  [1, 2].flatMap(
    (ordinal) =>
      [
        { ordinal, variant: 'login', code: 'PLATFORM_CHECK', token: 'login' },
        {
          ordinal,
          variant: 'account-mismatch',
          code: 'ACCOUNT_MISMATCH',
          token: 'account-changed',
        },
        {
          ordinal,
          variant: 'never',
          code: 'PLATFORM_CHECK',
          token: 'list-timeout',
        },
        {
          ordinal,
          variant: 'navigation',
          code: 'PLATFORM_CHECK',
          token: 'navigation',
        },
      ] as const,
  ),
)(
  'C6 load $ordinal $variant retains the first-load $token stop',
  async ({ ordinal, variant, code, token }) => {
    const h = await harness();
    let loads = 0;
    let restoreNavigation: (() => void) | undefined;
    if (variant === 'navigation')
      h.afterLaunch(() => {
        const prototype = Object.getPrototypeOf(h.context!.pages()[0]!) as Page;
        // eslint-disable-next-line @typescript-eslint/unbound-method -- The spy calls the original with its actual page as this.
        const original = prototype.goto;
        const navigation = vi
          .spyOn(prototype, 'goto')
          .mockImplementation(function (
            this: Page,
            ...args: Parameters<Page['goto']>
          ) {
            if (
              new URL(args[0]).pathname ===
                '/your_activity/interactions/comments' &&
              ++loads === ordinal
            )
              return Promise.reject(new Error('Generated navigation failure'));
            return original.call(this, ...args);
          });
        restoreNavigation = () => {
          navigation.mockRestore();
        };
        return Promise.resolve();
      });
    else
      h.fake.beforeList(() => {
        if (++loads === ordinal) h.fake.setVariant(variant);
        return Promise.resolve();
      });
    try {
      expect(await h.start(true)).toMatchObject({ code, token });
      expect(loads).toBe(ordinal);
      expect(
        h.fake.requests.some((request) => request.path.startsWith('/p/')),
      ).toBe(false);
      expect(await h.store.read((tx) => records(tx.instagramContext))).toEqual(
        [],
      );
      const run = (await h.store.browserJournal()).runs[0]!;
      const report = JSON.parse(
        await readFile(
          join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
          'utf8',
        ),
      ) as Record<string, unknown>;
      expect(report).toMatchObject({ stop: { code, token } });
      expect(report).toMatchObject({
        limits: {
          ready: {
            list: {
              count: ordinal - 1 + (variant === 'account-mismatch' ? 1 : 0),
            },
          },
        },
      });
    } finally {
      restoreNavigation?.();
      await h.close();
    }
  },
);
test('C6 non-canary steps keep exactly one list navigation per step and no oldest probe', async () => {
  const h = await harness('success', 3);
  await fullRunReady(h);
  try {
    expect(await h.start('no-canary')).toMatchObject({
      completed: 2,
      steps: 2,
      endReason: 'done',
    });
    expect(
      h.fake.requests.filter(
        (request) => request.path === '/your_activity/interactions/comments',
      ),
    ).toHaveLength(2);
    const run = (await h.store.browserJournal()).runs.at(-1)!;
    const report = JSON.parse(
      await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(report).toMatchObject({
      limits: { ready: { list: { count: 2 } } },
      steps: [{ oldestWithinWeek: null }, { oldestWithinWeek: null }],
    });
    expect(
      h.fake.events
        .filter((event) => event.clicks.at(-1) === 'Apply')
        .every((event) => event.choices.length > 0),
    ).toBe(true);
  } finally {
    await h.close();
  }
});

test('C5 foundation: six native choices cross the real driver and settle one confirmed canary', async () => {
  const h = await harness();
  try {
    const running = h.start();
    await h.click('Start');
    await h.click('Continue');
    await h.click('Matches');
    expect(await running).toMatchObject({
      completed: 1,
      steps: 1,
      endReason: 'canary',
    });
    expect(
      await h.store.read((tx) => records(tx.instagramContext)),
    ).toHaveLength(1);
    expect(
      (await h.store.browserJournal()).runs[0]!.canaryAcceptedAt,
    ).toBeTruthy();
    assertRecordedEvents(h.fake.events);
    const choices =
      h.fake.events.findLast((event) => event.choices.length)?.choices ?? [];
    expect(
      choices
        .filter((event) => event.type === 'change')
        .map(({ side, unit, label }) => [side, unit, label]),
    ).toEqual([
      ['start', 'year', '2025'],
      ['start', 'month', 'July'],
      ['start', 'day', '30'],
      ['end', 'year', '2025'],
      ['end', 'month', 'August'],
      ['end', 'day', '1'],
    ]);
    expect(h.fake.events.flatMap((event) => event.inputs)).toEqual([]);
    expect(h.fake.events.flatMap((event) => event.clicks)).not.toContain(
      'SELECT',
    );
  } finally {
    await h.close();
  }
});

async function filterHarness(variant: Variant = 'success', count = 1) {
  const fixture = await instagramFixture(count),
    fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
  fake.setVariant(variant);
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  const page = await browser.newPage();
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === fake.origin
      ? route.continue()
      : route.abort(),
  );
  let closing: Promise<void> | undefined;
  let closeSettled = false;
  const close = () =>
    (closing ??= (async () => {
      try {
        await browser.close();
      } finally {
        await fake.close();
      }
    })().finally(() => {
      closeSettled = true;
    }));
  onTestFinished(() => (closeSettled ? undefined : close()));
  return {
    fake,
    page,
    fixture,
    async open() {
      await page.goto(fake.origin + '/your_activity/interactions/comments');
    },
    close,
  };
}
test.each([
  'filter-five',
  'filter-seven',
  'filter-no-start',
  'filter-no-end',
  'filter-readback',
  'filter-duplicate-option',
  'filter-unknown-month',
  'filter-wrong-group',
] as const)(
  'C5 %s stops at filter-control before Apply or any post',
  async (variant) => {
    const h = await filterHarness(variant);
    const choose = vi.spyOn(
      Object.getPrototypeOf(h.page.locator('select')) as Locator,
      'selectOption',
    );
    try {
      await h.open();
      await expect(
        filterList(h.page, h.fixture.items[0]!.createdAt, () => {}),
      ).rejects.toMatchObject({
        code: 'INSTAGRAM_SHAPE_CHANGED',
        token: 'filter-control',
      });
      if (variant !== 'filter-readback') expect(choose).not.toHaveBeenCalled();
      await h.page
        .getByRole('button', { name: 'Oldest to newest', exact: true })
        .waitFor();
      expect(h.fake.events.flatMap((event) => event.clicks)).not.toContain(
        'Apply',
      );
      if (variant !== 'filter-readback')
        expect(h.fake.events.flatMap((event) => event.choices)).toEqual([]);
      expect(
        h.fake.requests.some((request) => request.path.startsWith('/p/')),
      ).toBe(false);
    } finally {
      choose.mockRestore();
      await h.close();
    }
  },
);
test('C5 a year list starting after the comment year refuses before any choice', async () => {
  const h = await filterHarness();
  const choose = vi.spyOn(
    Object.getPrototypeOf(h.page.locator('select')) as Locator,
    'selectOption',
  );
  h.fake.setFirstYear(2026);
  try {
    await h.open();
    await expect(
      filterList(h.page, h.fixture.items[0]!.createdAt, () => {}),
    ).rejects.toMatchObject({
      code: 'INSTAGRAM_SHAPE_CHANGED',
      token: 'filter-control',
    });
    expect(h.fake.events.flatMap((event) => event.choices)).toEqual([]);
    expect(choose).not.toHaveBeenCalled();
  } finally {
    choose.mockRestore();
    await h.close();
  }
});
test('C5 missing current-day option is refused before selectOption', async () => {
  const h = await filterHarness();
  const choose = vi.spyOn(
    Object.getPrototypeOf(h.page.locator('select')) as Locator,
    'selectOption',
  );
  h.fake.setToday('2026-10-16');
  try {
    await h.open();
    await clickAllowed(
      h.page,
      { kind: 'named', name: 'Sort & filter' },
      () => {},
    );
    await clickAllowed(
      h.page,
      { kind: 'named', name: 'Oldest to newest' },
      () => {},
    );
    expect(await h.page.locator('[role="dialog"] select').count()).toBe(6);
    await expect(
      chooseFilterOption(
        h.page,
        { side: 'end', unit: 'month', value: 11 },
        () => {},
      ),
    ).rejects.toMatchObject({
      code: 'INSTAGRAM_SHAPE_CHANGED',
      token: 'filter-control',
    });
    expect(h.fake.events.flatMap((event) => event.choices)).toEqual([]);
    expect(choose).not.toHaveBeenCalled();
    expect(
      await h.page
        .locator('select')
        .nth(3)
        .locator('option:checked')
        .allInnerTexts(),
    ).toEqual(['October']);
  } finally {
    choose.mockRestore();
    await h.close();
  }
});
test('C5 dependent lists are re-read in year month day order, including leap day and reordered controls', async () => {
  const h = await filterHarness('filter-reordered');
  h.fake.setToday('2026-10-16');
  try {
    await h.open();
    await clickAllowed(
      h.page,
      { kind: 'named', name: 'Sort & filter' },
      () => {},
    );
    expect(
      await h.page
        .getByRole('button', { name: 'Apply', exact: true })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    const selects = h.page.locator('[role="dialog"] select');
    expect(await selects.nth(3).locator('option').count()).toBe(16);
    expect(await selects.nth(5).locator('option').count()).toBe(10);
    for (const attribute of ['aria-label', 'title', 'name', 'id'])
      for (const select of await selects.all())
        expect(await select.getAttribute(attribute)).toBeNull();
    await clickAllowed(
      h.page,
      { kind: 'named', name: 'Oldest to newest' },
      () => {},
    );
    await chooseFilterDate(h.page, 'end', '2024-02-29', () => {});
    expect(
      await selects.nth(3).locator('option:checked').allInnerTexts(),
    ).toEqual(['29']);
    expect(await selects.nth(3).locator('option').count()).toBe(29);
    expect(await selects.nth(5).locator('option').count()).toBe(12);
    await chooseFilterDate(h.page, 'end', '2025-12-31', () => {});
    expect(
      await selects.nth(3).locator('option:checked').allInnerTexts(),
    ).toEqual(['31']);
    await expect
      .poll(
        () =>
          h.fake.events
            .at(-1)
            ?.choices.filter((event) => event.type === 'change').length,
      )
      .toBe(6);
    expect(
      h.fake.events
        .at(-1)!
        .choices.filter((event) => event.type === 'change')
        .map(({ unit, label }) => [unit, label]),
    ).toEqual([
      ['year', '2024'],
      ['month', 'February'],
      ['day', '29'],
      ['year', '2025'],
      ['month', 'December'],
      ['day', '31'],
    ]);
    assertRecordedEvents(h.fake.events);
  } finally {
    await h.close();
  }
});
test.each([
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'textInput',
  'input',
  'change',
])(
  'C5 recorder rejects a planted %s outside the six filter selects',
  async (event) => {
    const h = await filterHarness();
    try {
      await h.open();
      await h.page.locator('body').dispatchEvent(event);
      await expect
        .poll(() => h.fake.events.at(-1)?.inputs.length ?? 0)
        .toBeGreaterThan(0);
      expect(() => assertRecordedEvents(h.fake.events)).toThrow();
    } finally {
      await h.close();
    }
  },
);
test('C5 recorder rejects a planted select click and accepts only dropdown input and change', async () => {
  const h = await filterHarness();
  try {
    await h.open();
    await clickAllowed(
      h.page,
      { kind: 'named', name: 'Sort & filter' },
      () => {},
    );
    await h.page.locator('select').first().dispatchEvent('click');
    await expect
      .poll(() => h.fake.events.at(-1)?.clicks.includes('SELECT'))
      .toBe(true);
    expect(() => assertRecordedEvents(h.fake.events)).toThrow();
  } finally {
    await h.close();
  }
});
test.each([
  { kind: 'named', name: 'Start date' },
  { kind: 'named', name: 'End date' },
  { kind: 'named', name: 'Choose year' },
  { kind: 'named', name: 'Choose month' },
  { kind: 'year', value: 2025 },
  { kind: 'month', value: 6 },
  { kind: 'day', value: '2025-07-30' },
])(
  'C5 retired calendar click %j is refused before clicking',
  async (choice) => {
    const h = await filterHarness();
    try {
      await h.open();
      await expect(
        clickAllowed(h.page, choice as unknown as Click, () => {}),
      ).rejects.toMatchObject({ code: 'UNEXPECTED_ACTION' });
      expect(h.fake.events.flatMap((event) => event.clicks)).toEqual([]);
    } finally {
      await h.close();
    }
  },
);

async function harness(
  variant: Variant = 'success',
  count = 1,
  responseMs = 1500,
) {
  const diagnostics = contextDiagnostics(variant);
  const directory = await mkdtemp(join(tmpdir(), 'sp-context-fake-')),
    profile = join(directory, 'profile');
  const fixture = await instagramFixture(count);
  if (
    ['year-rows', 'year-word-rows', 'year-empty-rows'].includes(variant) ||
    variant.startsWith('list-other-names')
  ) {
    for (const [index, item] of fixture.items.entries())
      item.createdAt = new Date(
        Date.parse('2018-10-15T12:00:00.000Z') + index * 86400000,
      ).toISOString();
  }
  const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items);
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
  let paceFields: Record<string, unknown> = {};
  let exclude: ReadonlySet<string> = new Set();
  const shown = new Promise<void>((resolve) => {
    started = resolve;
  });
  let running: Promise<unknown> | undefined;
  const controller = new AbortController();
  const start = (
    order: boolean | 'no-canary' | { refreshLikes: true } = false,
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
            ...paceFields,
          },
          sha256: 'a'.repeat(64),
        }
      : undefined;
    running = (async () =>
      runContextWithDependencies(
        {
          store,
          plan:
            typeof order === 'object'
              ? await planContext(
                  store,
                  plan.accountKey,
                  new Set(),
                  exclude,
                  true,
                )
              : plan,
          workspace: directory,
          profile,
          executablePath: chromium.executablePath(),
          list: 'generated-list',
          include: new Set(),
          exclude,
          limit,
          order: written,
          signal: controller.signal,
          lang,
          now: () => new Date(now),
          notice: (text) => notices.push(text),
        },
        {
          origin: fake.origin,
          port: CONTEXT_PORTS.confirmation,
          responseMs,
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
              offline: true,
              chromiumSandbox: true,
              args: ['--enable-automation'],
              ignoreDefaultArgs: ['--disable-infobars'],
              serviceWorkers: 'block',
            });
            diagnostics.observe(context);
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
      ))().catch((error: unknown) => error);
    return running;
  };
  const local = async () => {
    await shown;
    await expect
      .poll(
        () =>
          context!
            .pages()
            .some(
              (page) =>
                new URL(page.url()).origin === CONTEXT_ORIGINS.confirmation,
            ),
        { timeout: 30000 },
      )
      .toBe(true);
    const readyPage = context!
      .pages()
      .find(
        (page) => new URL(page.url()).origin === CONTEXT_ORIGINS.confirmation,
      )!;
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
    diagnostics.event('click:start', { name });
    try {
      // The browser action timeout measures a click, not the preceding read.
      // Observe the runner publishing its pending action before auto-waiting.
      await diagnostics.waitForAction(name);
      await page.getByRole('button', { name, exact: true }).click({
        timeout: count > 5 ? 60000 : variant === 'window-full' ? 45000 : 30000,
      });
      diagnostics.event('click:end', { name });
    } catch (error) {
      throw new Error(`${String(error)}\nRun notices: ${notices.join('')}`);
    }
  };
  let closing: Promise<void> | undefined;
  let closeSettled = false;
  const close = () =>
    (closing ??= (async () => {
      controller.abort();
      try {
        try {
          await context?.close();
        } finally {
          await running;
        }
      } finally {
        try {
          await store.close();
        } finally {
          await fake.close();
        }
      }
      expect(await profileInUse(profile)).toBe(false);
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
      assertRecordedEvents(fake.events);
    })().finally(() => {
      diagnostics.close();
      closeSettled = true;
    }));
  onTestFinished(() => (closeSettled ? undefined : close()));
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
    async setExclude(value: ReadonlySet<string>) {
      exclude = new Set(value);
      Object.assign(
        plan,
        await planContext(store, plan.accountKey, new Set(), exclude),
      );
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
    setPace(value: Record<string, unknown>) {
      paceFields = value;
    },
    get context() {
      return context;
    },
    refresh: async () => {
      Object.assign(
        plan,
        await planContext(store, plan.accountKey, new Set(), exclude),
      );
    },
    close,
  };
}
let cleanupLease: Awaited<ReturnType<typeof harness>> | undefined;
test.each(['caption', 'comment', 'dialog'] as const)(
  'D12 B reading %s never promotes ordinary content to a deletion warning',
  async (slot) => {
    const h = await harness('success', 5);
    h.fake.decorateList(slot);
    try {
      const result = await h.start(true);
      const warning = await h.store
        .browserOutcomeWriter()
        .xWarning(h.plan.accountKey, undefined, 'instagram');
      if (slot === 'dialog') {
        expect(result).toMatchObject({ code: 'PLATFORM_CHECK' });
        expect(warning?.acknowledged).toBe(false);
      } else {
        expect(result, h.notices.join('')).toMatchObject({
          completed: 5,
          endReason: 'canary',
        });
        expect(warning).toBeNull();
      }
    } finally {
      await h.close();
    }
  },
);
test.each(IMAGE_CASES)(
  'IG-IMAGE $name uses real responses and current-source capture before automatic acceptance',
  async (entry) => {
    const h = await harness(
      entry.name.startsWith('reel-') ? 'reel' : 'success',
      entry.agrees ? 5 : 1,
    );
    h.fake.setImageCase(entry.name);
    try {
      const result = await h.start(true);
      if (entry.agrees)
        expect(result, h.notices.join('')).toMatchObject({
          endReason: 'canary',
          completed: 5,
        });
      else
        expect(result, h.notices.join('')).toMatchObject({
          code: !entry.captured
            ? 'CANARY_CHECK_FAILED'
            : entry.name === 'thumbnail-field-only' ||
                entry.name === 'partial-matching-post'
              ? 'CANARY_NO_SECOND_SOURCE'
              : 'CANARY_MISMATCH',
        });
      const run = (await h.store.browserJournal()).runs[0]!;
      const report = JSON.parse(
        await readFile(
          join(h.directory, `context/instagram/canary-${run.runId}.json`),
          'utf8',
        ),
      ) as {
        steps: {
          fields: SourceChecks;
          image: { status: string } & ImageDiagnostic;
          screenshot: { status: string };
        }[];
      };
      const step = report.steps.at(-1)!;
      for (const field of ['owner', 'time', 'caption'] as const)
        expect(step.fields[field]).toMatchObject({ found: true, agrees: true });
      expect(step.fields.image).toMatchObject({ agrees: entry.agrees });
      expect(step.fields.image.paths).toHaveLength(entry.paths);
      expect(step.image.status).toBe(
        entry.captured ? 'stored' : 'not-captured',
      );
      expect(step.image.source).toBe(
        entry.captured ? 'img-current-src' : 'none',
      );
      if (entry.name === 'extra-rendition-common-url')
        expect(step.image).toMatchObject({
          qualifyingObjects: 2,
          matchingLists: 2,
          distinctListLengths: [1, 2],
        });
      if (
        entry.name === 'disjoint-resolutions' ||
        entry.name === 'changed-signed-query'
      )
        expect(step.image).toMatchObject({
          qualifyingObjects: 2,
          matchingLists: 1,
          distinctListLengths: [1],
        });
      if (entry.name === 'thumbnail-field-only')
        expect(step.image).toMatchObject({
          qualifyingObjects: 1,
          matchingLists: 0,
          distinctListLengths: [],
        });
      if (entry.name === 'partial-matching-post')
        expect(step.image).toMatchObject({
          qualifyingObjects: 2,
          matchingLists: 1,
          distinctListLengths: [1],
        });
      for (const value of [
        IG_FIXTURE.code,
        'signature=',
        '/media/',
        'generated-a',
        h.fixture.items[0]!.text,
      ])
        expect(JSON.stringify(step.image)).not.toContain(value);
      expect(step.screenshot.status).toBe('stored');
      if (entry.captured) {
        const bytes = await readFile(
          join(
            instagramContextDirectory(h.directory, IG_FIXTURE.code),
            'image.png',
          ),
        );
        expect(bytes).toEqual(
          imageCasePng(
            entry.name === 'carousel-second-displayed' ||
              entry.name === 'wrong-media-url',
          ),
        );
      }
      const records = await h.store.read((tx) =>
        tx.instagramContext.get(h.fixture.items[0]!.id),
      );
      expect(Boolean(records)).toBe(entry.agrees);
      expect(Boolean(run.canaryAcceptedAt)).toBe(entry.agrees);
      if (!entry.agrees)
        expect(
          h.fake.requests.filter((request) =>
            /^\/(?:p|reel)\//.test(request.path),
          ),
        ).toHaveLength(1);
    } finally {
      await h.close();
    }
  },
);
test('IG-IMAGE main run records exact-url counts but does not enforce canary agreement', async () => {
  const h = await harness('success', 2);
  await fullRunReady(h);
  h.fake.setImageCase('extra-rendition-common-url');
  try {
    expect(await h.start('no-canary'), h.notices.join('')).toMatchObject({
      endReason: 'done',
      completed: 1,
    });
    const run = (await h.store.browserJournal()).runs.at(-1)!;
    const report = JSON.parse(
      await readFile(
        join(h.directory, `context/instagram/canary-${run.runId}.json`),
        'utf8',
      ),
    ) as { steps: { image: ImageDiagnostic; fields: SourceChecks }[] };
    expect(report.steps[0]!.image).toMatchObject({
      qualifyingObjects: 2,
      matchingLists: 2,
      distinctListLengths: [1, 2],
      source: 'img-current-src',
    });
    expect(report.steps[0]!.fields.image.agrees).toBe(true);
    expect(
      await h.store.read((tx) =>
        tx.instagramContext.get(h.fixture.items[0]!.id),
      ),
    ).toBeDefined();
  } finally {
    await h.close();
  }
});
test('IG-IMAGE unconfirmed main step records image counts without capturing or confirming', async () => {
  const h = await harness('success', 2);
  await fullRunReady(h);
  h.fake.setPostVariant(0, 'edited');
  h.fake.setImageCase('single-image');
  try {
    expect(await h.start('no-canary'), h.notices.join('')).toMatchObject({
      endReason: 'done',
      completed: 0,
    });
    const run = (await h.store.browserJournal()).runs.at(-1)!;
    const report = JSON.parse(
      await readFile(
        join(h.directory, `context/instagram/canary-${run.runId}.json`),
        'utf8',
      ),
    ) as {
      steps: {
        image: ImageDiagnostic & { status: string; bytes: number };
        result: string;
      }[];
    };
    expect(report.steps[0]).toMatchObject({
      result: 'text',
      image: {
        status: 'not-attempted',
        bytes: 0,
        qualifyingObjects: 1,
        matchingLists: 1,
        distinctListLengths: [1],
        source: 'img-current-src',
      },
    });
    expect(
      await h.store.read((tx) =>
        tx.instagramContext.get(h.fixture.items[0]!.id),
      ),
    ).toBeUndefined();
  } finally {
    await h.close();
  }
});
test.each([
  'success',
  'other-author',
  'edited',
  'time',
  'several',
  'not-shown',
] as const)(
  'C29 ownerless %s retains only three-check post evidence and never confirms through the list',
  async (variant) => {
    const h = await harness('success', 2);
    await fullRunReady(h);
    h.fake.setPostVariant(0, variant);
    await h.store.write(async (tx) => {
      const stored = (await tx.items.get(h.fixture.items[0]!.id))!;
      stored.item.reference.ownerHandle = null;
      await tx.items.put(stored);
    });
    h.fixture.items[0]!.reference.ownerHandle = null;
    await h.refresh();
    try {
      const result = await h.start('no-canary');
      expect(result, h.notices.join('')).toMatchObject({
        endReason: 'done',
        completed: variant === 'success' ? 1 : 0,
      });
      const record = await h.store.read((tx) =>
        tx.instagramContext.get(h.fixture.items[0]!.id),
      );
      if (variant === 'success')
        expect(record).toMatchObject({
          confirmedBy: 'post',
          ownerCheck: 'not-in-export',
          post: { owner: IG_FIXTURE.ownerWithoutExport },
          comment: {
            id: IG_FIXTURE.commentId,
            createdAt: h.fixture.items[0]!.createdAt,
          },
        });
      else {
        expect(record).toBeUndefined();
        const attempts = await h.store.read((tx) =>
          records(tx.browserAttempts),
        );
        expect(attempts.at(-1)).toMatchObject({
          state: 'unconfirmed',
          code:
            variant === 'other-author' || variant === 'not-shown'
              ? 'not-shown'
              : variant === 'edited'
                ? 'text'
                : variant,
        });
      }
    } finally {
      await h.close();
    }
  },
);
test('C29 ownerless canary counts five post confirmations only after every unchanged automatic check passes', async () => {
  const h = await harness('success', 5);
  for (const item of h.fixture.items) {
    item.reference.ownerHandle = null;
    await h.store.write(async (tx) => {
      const stored = (await tx.items.get(item.id))!;
      stored.item.reference.ownerHandle = null;
      await tx.items.put(stored);
    });
  }
  await h.refresh();
  try {
    expect(await h.start(true), h.notices.join('')).toMatchObject({
      endReason: 'canary',
      completed: 5,
    });
    const saved = await h.store.read((tx) => records(tx.instagramContext));
    expect(saved).toHaveLength(5);
    for (const record of saved)
      expect(record).toMatchObject({
        ownerCheck: 'not-in-export',
        confirmedBy: 'post',
        post: { owner: IG_FIXTURE.ownerWithoutExport },
      });
    expect(
      (await h.store.browserJournal()).runs.at(-1)!.canaryAcceptedAt,
    ).not.toBeNull();
  } finally {
    await h.close();
  }
});
// Opt-in measurement only, never part of the default context-suite duration.
// eslint-disable-next-line no-restricted-properties -- Test-only generated benchmark selection, never credentials.
const memoryBenchmark = process.env['SP_CONTEXT_MEMORY_BENCHMARK'] === '1';
const memoryStepCount =
  // eslint-disable-next-line no-restricted-properties -- Generated benchmark step count only, never credentials.
  process.env['SP_CONTEXT_MEMORY_STEPS'] === '200' ? 200 : 60;
test.each(memoryBenchmark ? [memoryStepCount] : [3])(
  'C28 %s generated steps record per-page reused-session memory samples and optional attributed browser working sets',
  async (stepCount) => {
    const h = await harness('success', stepCount + 1);
    await fullRunReady(h);
    h.setLimit(stepCount);
    h.setMaxSteps(stepCount);
    h.setPace({ secondsPerStep: 10, stepsPerDay: 600, batchPause: false });
    const execute = promisify(execFile);
    const samples: {
      step: number;
      elapsedMs: number;
      memory: MemorySample;
      browserWorkingSetMB: number | null;
      largestRendererMB: number | null;
      processCount: number;
      processesObserved: boolean;
      node: {
        rssMB: number;
        heapUsedMB: number;
        externalMB: number;
        arrayBuffersMB: number;
      };
      listeners: { request: number; response: number };
      nodeGC?: {
        rssMB: number;
        heapUsedMB: number;
        externalMB: number;
        arrayBuffersMB: number;
      };
      cdp: { active: number; peak: number; attached: number; detached: number };
    }[] = [];
    const cdp = { active: 0, peak: 0, attached: 0, detached: 0 };
    h.afterLaunch(async () => {
      await Promise.resolve();
      const context = h.context!;
      const create = context.newCDPSession.bind(context);
      context.newCDPSession = async (target) => {
        const session = await create(target);
        cdp.attached++;
        cdp.active++;
        cdp.peak = Math.max(cdp.peak, cdp.active);
        const detach = session.detach.bind(session);
        let active = true;
        session.detach = async () => {
          try {
            await detach();
          } finally {
            if (active) {
              active = false;
              cdp.active--;
              cdp.detached++;
            }
          }
        };
        return session;
      };
    });
    const startedAt = performance.now();
    let garbageControl:
      { before: MemorySample; after: MemorySample } | undefined;
    const gcCalls = await import('node:v8');
    const vm = await import('node:vm');
    // Test-only Node reachability controls, never used by the reading run.
    if (memoryBenchmark) gcCalls.setFlagsFromString('--expose_gc');
    const collectNode = memoryBenchmark
      ? (vm.runInNewContext('gc') as () => void)
      : () => {};
    const original = networkHelpers.observePageMemory;
    const observer = vi
      .spyOn(networkHelpers, 'observePageMemory')
      .mockImplementation((page) => {
        const memory = original(page);
        return {
          ...memory,
          async sample() {
            const value = await memory.sample();
            // Vitest call/results history otherwise retains every retired Page
            // through the observer closure and turns the benchmark into an owner.
            observer.mockClear();
            let browserWorkingSetMB: number | null = null,
              largestRendererMB: number | null = null,
              processCount = 0,
              processesObserved = false;
            if (
              process.platform === 'win32' &&
              // eslint-disable-next-line no-restricted-properties -- Test-only OS-counter selection, never credentials.
              process.env['SP_C28_SAMPLE_OS'] === '1'
            ) {
              const profile = h.profile.replaceAll("'", "''");
              const command = `if(Test-Path -LiteralPath '${join(tmpdir(), 'kilo', 'phase2', 'STOP').replaceAll("'", "''")}'){exit 97};$all=@(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='chrome-headless-shell.exe'");$root=@($all | Where-Object {$_.CommandLine -and $_.CommandLine.Contains('${profile}') -and $_.CommandLine -notmatch '--type='});if($root.Count -ne 1){throw 'Generated browser root not unique'};$ids=@([int]$root[0].ProcessId);for($depth=0;$depth -lt 8;$depth++){$next=@($all | Where-Object {$_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids});if($next.Count -eq 0){break};$ids+=@($next.ProcessId)};$owned=@($all | Where-Object {$_.ProcessId -in $ids});$working=0L;$renderer=0L;foreach($p in $owned){$working+=[long]$p.WorkingSetSize;if($p.CommandLine -match '--type=renderer'){$renderer=[Math]::Max($renderer,[long]$p.WorkingSetSize)}};@{workingMB=[Math]::Round($working/1MB);rendererMB=[Math]::Round($renderer/1MB);count=$owned.Count}|ConvertTo-Json -Compress`;
              try {
                const result = JSON.parse(
                  (
                    await execute(
                      'powershell.exe',
                      ['-NoProfile', '-NonInteractive', '-Command', command],
                      { encoding: 'utf8', windowsHide: true, timeout: 30000 },
                    )
                  ).stdout,
                ) as { workingMB: number; rendererMB: number; count: number };
                browserWorkingSetMB = result.workingMB;
                largestRendererMB = result.rendererMB;
                processCount = result.count;
                processesObserved = true;
              } catch {
                console.info('C28_OS_OBSERVATION_FAILED');
              }
            }
            samples.push({
              step: samples.length + 1,
              elapsedMs: Math.round(performance.now() - startedAt),
              memory: value,
              browserWorkingSetMB,
              largestRendererMB,
              processCount,
              processesObserved,
              node: (() => {
                const value = process.memoryUsage();
                return {
                  rssMB: Math.round(value.rss / 1024 ** 2),
                  heapUsedMB: Math.round(value.heapUsed / 1024 ** 2),
                  externalMB: Math.round(value.external / 1024 ** 2),
                  arrayBuffersMB: Math.round(value.arrayBuffers / 1024 ** 2),
                };
              })(),
              listeners: (() => {
                const observed = page as unknown as {
                  listenerCount(event: string): number;
                };
                return {
                  request: observed.listenerCount('request'),
                  response: observed.listenerCount('response'),
                };
              })(),
              cdp: { ...cdp },
            });
            console.info('C28_MEMORY', JSON.stringify(samples.at(-1)));
            if (memoryBenchmark && samples.length % 20 === 0) {
              await new Promise<void>((resolve) => setImmediate(resolve));
              collectNode();
              await new Promise<void>((resolve) => setImmediate(resolve));
              collectNode();
              const value = process.memoryUsage();
              samples.at(-1)!.nodeGC = {
                rssMB: Math.round(value.rss / 1024 ** 2),
                heapUsedMB: Math.round(value.heapUsed / 1024 ** 2),
                externalMB: Math.round(value.external / 1024 ** 2),
                arrayBuffersMB: Math.round(value.arrayBuffers / 1024 ** 2),
              };
              console.info(
                'C35_NODE_GC',
                JSON.stringify({
                  step: samples.length,
                  ...samples.at(-1)!.nodeGC,
                }),
              );
            }
            return value;
          },
          async dispose() {
            // Test-only reachability control; never part of the production observer.
            const client = await page.context().newCDPSession(page);
            try {
              await client.send('Performance.enable');
              const before = networkHelpers.memoryFromMetrics(
                (await client.send('Performance.getMetrics')).metrics,
              );
              await client.send('HeapProfiler.collectGarbage');
              const after = networkHelpers.memoryFromMetrics(
                (await client.send('Performance.getMetrics')).metrics,
              );
              garbageControl = { before, after };
              console.info(
                'C28_GARBAGE_CONTROL',
                JSON.stringify(garbageControl),
              );
            } finally {
              await client.detach();
              await memory.dispose();
            }
          },
        };
      });
    const nodeAfterRun = [] as {
      label: string;
      rssMB: number;
      heapUsedMB: number;
      externalMB: number;
      arrayBuffersMB: number;
    }[];
    const nodeControl = async (label: string) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      collectNode();
      await new Promise<void>((resolve) => setImmediate(resolve));
      collectNode();
      const value = process.memoryUsage();
      nodeAfterRun.push({
        label,
        rssMB: Math.round(value.rss / 1024 ** 2),
        heapUsedMB: Math.round(value.heapUsed / 1024 ** 2),
        externalMB: Math.round(value.external / 1024 ** 2),
        arrayBuffersMB: Math.round(value.arrayBuffers / 1024 ** 2),
      });
    };
    try {
      expect(await h.start('no-canary'), h.notices.join('')).toMatchObject({
        completed: stepCount,
        steps: stepCount,
      });
      const run = (await h.store.browserJournal()).runs.find(
        (run) => run.runId !== 'generated-prior-canary',
      )!;
      const report = JSON.parse(
        await readFile(
          join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
          'utf8',
        ),
      ) as { steps: { memory: MemorySample }[]; memory: unknown };
      expect(samples).toHaveLength(stepCount);
      expect(cdp.active).toBe(0);
      expect(samples.every((sample) => sample.memory.observed)).toBe(true);
      expect(report.steps.map((step) => step.memory)).toEqual(
        samples.map((sample) => sample.memory),
      );
      expect(report.memory).toMatchObject({
        samples: stepCount,
        failedSamples: 0,
        sessionAttached: true,
        observationFailed: false,
      });
      if (memoryBenchmark) {
        await nodeControl('after-run-before-spy-release');
        observer.mockRestore();
        await nodeControl('after-observer-spy-release');
      }
      const output =
        // eslint-disable-next-line no-restricted-properties -- Test-only generated measurement output, never credentials.
        process.env['SP_C28_MEASUREMENT_OUT'] ??
        // eslint-disable-next-line no-restricted-properties -- Test-only generated measurement output, never credentials.
        process.env['SP_C35_MEASUREMENT_OUT'];
      if (output) {
        expect(
          output.startsWith(join(tmpdir(), 'kilo', 'phase2', 'c28') + '\\') ||
            output.startsWith(join(tmpdir(), 'kilo', 'phase2', 'c35') + '\\'),
        ).toBe(true);
        await writeFile(
          output,
          JSON.stringify(
            {
              generatedOnly: true,
              kind: 'success',
              maxWorkers: 1,
              samples,
              garbageControl,
              cdp,
              nodeAfterRun,
              peak: report.memory,
              elapsedMs: Math.round(performance.now() - startedAt),
            },
            null,
            2,
          ),
          { flag: 'wx' },
        );
      }
      assertRecordedEvents(h.fake.events);
    } finally {
      observer.mockRestore();
      await h.close();
    }
  },
  1200000,
);
test('C35 IG19 recycles once between20 and21 in the same context without additional platform navigation', async () => {
  const h = await harness('success', 23);
  await fullRunReady(h);
  h.setLimit(21);
  h.setMaxSteps(21);
  h.setPace({ secondsPerStep: 10, stepsPerDay: 600, batchPause: false });
  let pagesCreated = 0,
    activeBeforeClose = 0;
  const originalPages = pagesHelpers.contextPages;
  const create = vi
    .spyOn(pagesHelpers, 'contextPages')
    .mockImplementation((...args) => {
      const boundary = originalPages(...args);
      const make = boundary.newPage.bind(boundary);
      boundary.newPage = async () => {
        pagesCreated++;
        const page = await make();
        if (pagesCreated === 3)
          activeBeforeClose = page.context().pages().length;
        return page;
      };
      return boundary;
    });
  const memory = vi.spyOn(networkHelpers, 'observePageMemory');
  try {
    expect(await h.start('no-canary'), h.notices.join('')).toMatchObject({
      completed: 21,
      steps: 21,
    });
    expect(pagesCreated).toBe(3);
    expect(memory).toHaveBeenCalledTimes(2);
    const run = (await h.store.browserJournal()).runs.find(
      (run) => run.runId !== 'generated-prior-canary',
    )!;
    const report = JSON.parse(
      await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      ),
    ) as unknown;
    expect(report).toMatchObject({
      recycling: {
        intervalSteps: 20,
        count: 1,
        events: [
          {
            afterStep: 20,
            nextStep: 21,
            reason: 'step-interval',
            checks: 'next-list',
          },
        ],
      },
      memory: { samples: 21, failedSamples: 0 },
      runtime: { unexpectedPageCloses: 0 },
    });
    expect(activeBeforeClose).toBe(2);
    expect(
      h.fake.requests.filter(
        (request) => request.path === networkHelpers.COMMENTS_PATH,
      ),
    ).toHaveLength(21);
    expect(
      h.fake.requests.filter((request) => /^\/p\//.test(request.path)),
    ).toHaveLength(21);
    const counts = await h.store.read((tx) => records(tx.instagramContext));
    expect(counts.filter((record) => record.runId === run.runId)).toHaveLength(
      21,
    );
    assertRecordedEvents(h.fake.events);
  } finally {
    memory.mockRestore();
    create.mockRestore();
    await h.close();
  }
}, 180000);

test.each(['account', 'language', 'extension', 'http-429'] as const)(
  'C35 IG19 recycle retains the %s guard before next comment confirmation',
  async (mode) => {
    const h = await harness('success', 22);
    await fullRunReady(h);
    h.setLimit(21);
    h.setMaxSteps(21);
    h.setPace({ secondsPerStep: 10, stepsPerDay: 600, batchPause: false });
    h.fake.filteredImageOnly(Array.from({ length: 20 }, (_, index) => index));
    const original = pagesHelpers.contextPages;
    vi.spyOn(pagesHelpers, 'contextPages').mockImplementation((...args) => {
      const boundary = original(...args),
        replace = boundary.replace.bind(boundary);
      boundary.replace = async (page) => {
        const next = await replace(page);
        if (mode === 'extension') {
          const folder = join(
            h.profile,
            'Default',
            'Extensions',
            'generated_recycle_extension',
          );
          await mkdir(folder, { recursive: true });
          await writeFile(join(folder, 'manifest.json'), '{}');
        } else if (mode === 'account') h.fake.setVariant('account-mismatch');
        else if (mode === 'language') h.fake.setVariant('de');
        else h.fake.setVariant('429');
        return next;
      };
      return boundary;
    });
    try {
      expect(await h.start('no-canary')).toMatchObject(
        mode === 'account'
          ? { code: 'ACCOUNT_MISMATCH', token: 'account-changed' }
          : mode === 'language'
            ? { code: 'PAGE_LANGUAGE', token: 'page-language' }
            : mode === 'extension'
              ? { code: 'PLATFORM_CHECK', token: 'extensions-added' }
              : { code: 'PLATFORM_CHECK', token: 'http-429' },
      );
      const contexts = await h.store.read((tx) => records(tx.instagramContext));
      expect(
        contexts.filter((record) => record.runId !== 'generated-prior-canary'),
      ).toHaveLength(0);
      expect(
        contexts
          .filter((record) => record.runId !== 'generated-prior-canary')
          .some((record) => record.itemId === h.fixture.items[20]!.id),
      ).toBe(false);
      const journal = await h.store.browserJournal();
      const run = journal.runs.find(
        (run) => run.runId !== 'generated-prior-canary',
      )!;
      expect(
        JSON.parse(
          await readFile(
            join(
              h.directory,
              'context',
              'instagram',
              `canary-${run.runId}.json`,
            ),
            'utf8',
          ),
        ) as unknown,
      ).toMatchObject({
        recycling: {
          count: 1,
          events: [
            {
              afterStep: 20,
              nextStep: 21,
              reason: 'step-interval',
              checks: 'next-list',
            },
          ],
        },
      });
      expect(
        journal.attempts.filter(
          (attempt) =>
            attempt.runId === run.runId &&
            String(attempt.state) === 'confirmed',
        ),
      ).toHaveLength(0);
      expect(
        journal.attempts.filter(
          (attempt) =>
            attempt.runId === run.runId && attempt.code === 'list-image-only',
        ),
      ).toHaveLength(20);
    } finally {
      vi.restoreAllMocks();
      await h.close();
    }
  },
  180000,
);

test('C28 memory diagnostic covers the completed step and run peak without changing its result', async () => {
  const h = await harness('success', 2);
  await fullRunReady(h);
  try {
    expect(await h.start('no-canary')).toMatchObject({
      completed: 1,
      steps: 1,
    });
    const run = (await h.store.browserJournal()).runs.find(
      (run) => run.runId !== 'generated-prior-canary',
    )!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      steps: [
        {
          result: 'confirmed',
          memory: { observed: true, observationFailed: false },
        },
      ],
      memory: {
        samples: 1,
        failedSamples: 0,
        sessionAttached: true,
      },
    });
    const peak = (JSON.parse(text) as { memory: { peak: { frames: number } } })
      .memory.peak;
    expect(Number.isInteger(peak.frames)).toBe(true);
    expect(peak.frames).toBeGreaterThan(0);
    for (const value of [
      h.plan.handle,
      IG_FIXTURE.code,
      ...Object.values(IG_FIXTURE.other),
    ])
      expect(text).not.toContain(value);
  } finally {
    await h.close();
  }
});
test('C34 diagnosis image-only counts describe innerText containers not the absence of comment text', async () => {
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: true,
  });
  const page = await browser.newPage();
  try {
    await page.setContent(`<html lang="en"><body><nav><div role="button" aria-label="generated navigation"><img alt="navigation"></div></nav><main>
      <div role="button" aria-label="generated nested"><img><span><span>generated_person Generated comment 1w</span></span></div>
      <div role="button" aria-label="generated_person Comment in accessible label 1w"><img alt="Comment in image alt"></div>
      <div role="button" aria-label="generated lazy"><img><span hidden>generated_person Lazy comment 1w</span></div>
      <div role="button" aria-label="generated sticker"><img alt="Generated GIF sticker"></div>
      <div role="button" aria-label="generated reel"><img alt="Generated reel thumbnail"></div><span>Text outside the thumbnail button</span>
    </main></body></html>`);
    expect(await selectorHelpers.listTimeoutRows(page)).toMatchObject({
      rowContainers: 6,
      readableRows: 1,
      imageOnlyRows: 5,
    });
    expect(await selectorHelpers.readRows(page)).toHaveLength(1);
    await page
      .locator('span[hidden]')
      .evaluate((node) => node.removeAttribute('hidden'));
    expect(await selectorHelpers.listTimeoutRows(page)).toMatchObject({
      readableRows: 2,
      imageOnlyRows: 4,
    });
    expect(await selectorHelpers.readRows(page)).toHaveLength(2);
  } finally {
    await browser.close();
  }
});

test('C34 IG-18 settled image-only filtered list stays manual and the automatic canary confirms the next five', async () => {
  const h = await harness('success', 6);
  h.fake.filteredImageOnly([0]);
  try {
    expect(await h.start(true), h.notices.join('')).toMatchObject({
      completed: 5,
      steps: 6,
      endReason: 'canary',
    });
    const journal = await h.store.browserJournal();
    expect(
      journal.attempts.find(
        (attempt) =>
          attempt.itemId === h.fixture.items[0]!.id && attempt.settles !== null,
      ),
    ).toMatchObject({ state: 'not-listed', code: 'list-image-only' });
    const contexts = await h.store.read((tx) => records(tx.instagramContext));
    expect(contexts.map((record) => record.itemId)).not.toContain(
      h.fixture.items[0]!.id,
    );
    expect(contexts).toHaveLength(5);
    expect(await planContext(h.store, h.plan.accountKey)).toMatchObject({
      rows: [],
      excluded: { 'not-listed': 1 },
    });
    expect(
      (
        await planContext(
          h.store,
          h.plan.accountKey,
          new Set([h.fixture.items[0]!.id]),
        )
      ).rows.map((row) => row.item.id),
    ).toEqual([h.fixture.items[0]!.id]);
    const run = journal.runs[0]!;
    expect(run.canaryAcceptedAt).not.toBeNull();
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      rows: { imageOnlySkipped: 1 },
      retries: { used: 0, entries: [] },
      steps: [
        { result: 'list-image-only', candidates: 0, confirmed: false },
        {},
        {},
        {},
        {},
        {},
      ],
    });
    expect((JSON.parse(text) as { steps: unknown[] }).steps[0]).toMatchObject({
      listTimeout: {
        rowContainers: 4,
        readableRows: 1,
        imageOnlyRows: 3,
        filter: {
          applied: true,
          readbackObserved: true,
          startMatches: true,
          endMatches: true,
        },
        observationFailed: false,
      },
    });
    expect(h.waits).not.toContain(60000);
    expect(
      h.fake.requests.some(
        (request) => request.path === `/p/${IG_FIXTURE.code}`,
      ),
    ).toBe(false);
    assertRecordedEvents(h.fake.events);
  } finally {
    await h.close();
  }
}, 180000);

test('C34 IG-18 main run skips one opaque list without reopening and records the next comment', async () => {
  const h = await harness('success', 3);
  await fullRunReady(h);
  h.fake.filteredImageOnly([0]);
  h.setLimit(2);
  try {
    expect(await h.start('no-canary'), h.notices.join('')).toMatchObject({
      completed: 1,
      steps: 2,
    });
    const journal = await h.store.browserJournal();
    const run = journal.runs.find(
      (run) => run.runId !== 'generated-prior-canary',
    )!;
    expect(
      journal.attempts.find(
        (attempt) =>
          attempt.runId === run.runId &&
          attempt.itemId === h.fixture.items[0]!.id &&
          attempt.settles !== null,
      ),
    ).toMatchObject({ state: 'not-listed', code: 'list-image-only' });
    const report = JSON.parse(
      await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      ),
    ) as unknown;
    expect(report).toMatchObject({
      rows: { imageOnlySkipped: 1 },
      retries: { used: 0, entries: [] },
    });
    expect(h.waits).not.toContain(60000);
  } finally {
    await h.close();
  }
}, 120000);

test('C-list main run stops on retained rows without a reopen or a not-listed settlement', async () => {
  const h = await harness('success', 3);
  await fullRunReady(h);
  const before = await h.store.read((tx) => records(tx.instagramContext));
  h.fake.listFreshness('retained');
  try {
    expect(await h.start('no-canary')).toMatchObject({
      code: 'PLATFORM_CHECK',
      token: 'list-timeout',
    });
    const journal = await h.store.browserJournal();
    expect(
      journal.attempts.some((attempt) => attempt.code === 'list-image-only'),
    ).toBe(false);
    expect(h.waits).not.toContain(60000);
    const run = journal.runs.find(
      (run) => run.runId !== 'generated-prior-canary',
    )!;
    expect(run.pageOpens).toBe(1);
    expect(await h.store.read((tx) => records(tx.instagramContext))).toEqual(
      before,
    );
  } finally {
    await h.close();
  }
});

test('C-list run-wide signature stops a repeated opaque window on the next canary comment', async () => {
  const h = await harness('success', 6);
  h.fake.listFreshness('repeated');
  try {
    expect(await h.start(true)).toMatchObject({
      code: 'PLATFORM_CHECK',
      token: 'list-timeout',
    });
    const journal = await h.store.browserJournal();
    expect(
      journal.attempts.filter((attempt) => attempt.code === 'list-image-only'),
    ).toHaveLength(1);
    expect(journal.runs[0]!.pageOpens).toBe(2);
    expect(
      await h.store.read((tx) => records(tx.instagramContext)),
    ).toHaveLength(0);
  } finally {
    await h.close();
  }
});

test('C34 IG-18 a lazy row that becomes readable follows the normal candidate path instead of the manual class', async () => {
  const h = await harness('success', 1);
  h.fake.filteredImageOnly([0], { lateText: true });
  const browser = await chromium.launch({
    executablePath: chromium.executablePath(),
    headless: true,
  });
  const page = await browser.newPage();
  try {
    const result = await driverHelpers.loadList(
      page,
      h.fixture.items[0]!,
      h.plan.handle,
      {
        ...productionContext,
        origin: h.fake.origin,
        responseMs: 1500,
        sleep: async () => {
          await page.waitForTimeout(300);
        },
      },
      () => {},
      false,
      new Date(IG_FIXTURE.now),
    );
    expect(result.manualReason).toBeUndefined();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.text).toBe(h.fixture.items[0]!.text);
  } finally {
    await browser.close();
    await h.close();
  }
}, 30000);

test.each([
  'busy',
  'mismatch',
  'observer',
  'dom-change',
  'account',
  'language',
  'notice',
  'http-429',
  'extension',
] as const)(
  'C34 IG-18 opaque filtered rows retain the %s stop',
  async (mode) => {
    const h = await harness('success', 6);
    h.fake.filteredImageOnly([0], {
      busy: mode === 'busy',
      mismatch: mode === 'mismatch',
      ...(['account', 'language', 'notice', 'http-429'].includes(mode)
        ? { issue: mode as 'account' | 'language' | 'notice' | 'http-429' }
        : {}),
    });
    const observer =
      mode === 'observer'
        ? vi.spyOn(selectorHelpers, 'observeListDomChanges').mockResolvedValue({
            applied() {},
            summary: () => ({
              observed: false,
              changes: 0,
              lastChangeAfterApplyMs: null,
              observedForMs: 0,
            }),
            failed: true,
            async dispose() {},
          })
        : undefined;
    if (mode === 'dom-change') {
      const original = selectorHelpers.listTimeoutRows;
      let reads = 0;
      vi.spyOn(selectorHelpers, 'listTimeoutRows').mockImplementation(
        async (page) => {
          if (++reads === 2) {
            await page
              .locator('main')
              .evaluate((node) =>
                node.setAttribute('data-generated-late-change', 'yes'),
              );
            await page.waitForTimeout(600);
          }
          return original(page);
        },
      );
    }
    if (mode === 'extension') {
      const original = selectorHelpers.listTimeoutRows;
      let fired = false;
      vi.spyOn(selectorHelpers, 'listTimeoutRows').mockImplementation(
        async (page) => {
          if (!fired) {
            fired = true;
            const directory = join(
              h.profile,
              'Default',
              'Extensions',
              'generated_added_extension',
            );
            await mkdir(directory, { recursive: true });
            await writeFile(join(directory, 'manifest.json'), '{}');
          }
          return original(page);
        },
      );
    }
    try {
      const result = await h.start(true);
      expect(result).toMatchObject(
        mode === 'account'
          ? { code: 'ACCOUNT_MISMATCH', token: 'account-changed' }
          : mode === 'language'
            ? { code: 'PAGE_LANGUAGE', token: 'page-language' }
            : mode === 'notice'
              ? { code: 'PLATFORM_CHECK', token: 'notice-error' }
              : mode === 'http-429'
                ? { code: 'PLATFORM_CHECK', token: 'http-429' }
                : mode === 'extension'
                  ? { code: 'CANARY_CHECK_FAILED', token: 'extensions-added' }
                  : { code: 'PLATFORM_CHECK', token: 'list-timeout' },
      );
      expect(
        await h.store.read((tx) => records(tx.instagramContext)),
      ).toHaveLength(0);
      expect(
        (await h.store.browserJournal()).attempts.some(
          (attempt) => attempt.code === 'list-image-only',
        ),
      ).toBe(false);
      if (mode === 'mismatch') {
        const run = (await h.store.browserJournal()).runs[0]!;
        const report = JSON.parse(
          await readFile(
            join(
              h.directory,
              'context',
              'instagram',
              `canary-${run.runId}.json`,
            ),
            'utf8',
          ),
        ) as { steps: unknown[] };
        expect(report.steps[0]).toMatchObject({
          result: 'list-timeout',
          listTimeout: {
            rowContainers: 4,
            readableRows: 1,
            imageOnlyRows: 3,
            filter: {
              applied: true,
              readbackObserved: true,
              startMatches: false,
              endMatches: true,
            },
          },
        });
      }
    } finally {
      observer?.mockRestore();
      vi.restoreAllMocks();
      await h.close();
    }
  },
  120000,
);

test('C34 IG-18 canary still refuses after fifteen opaque comments with no confirmations', async () => {
  const h = await harness('success', 17);
  h.fake.filteredImageOnly(Array.from({ length: 17 }, (_, index) => index));
  try {
    expect(await h.start(true)).toMatchObject({
      code: 'CANARY_CHECK_FAILED',
      token: 'canary-check',
    });
    const journal = await h.store.browserJournal();
    expect(
      journal.attempts.filter((attempt) => attempt.state === 'sending'),
    ).toHaveLength(15);
    expect(
      journal.attempts.filter((attempt) => attempt.code === 'list-image-only'),
    ).toHaveLength(15);
    expect(
      await h.store.read((tx) => records(tx.instagramContext)),
    ).toHaveLength(0);
    expect(journal.runs[0]!.canaryAcceptedAt).toBeNull();
  } finally {
    await h.close();
  }
}, 180000);

test('C27 readable nonmatching rows reach no-row without list-timeout diagnostics or a reopen', async () => {
  const h = await harness('no-row', 2);
  await fullRunReady(h);
  try {
    expect(await h.start('no-canary')).toMatchObject({
      completed: 0,
      steps: 1,
    });
    const run = (await h.store.browserJournal()).runs.find(
      (run) => run.runId !== 'generated-prior-canary',
    )!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    const report = JSON.parse(text) as { steps: { listTimeout?: unknown }[] };
    expect(JSON.parse(text)).toMatchObject({
      retries: { used: 0, entries: [] },
      steps: [{ result: 'no-row', candidates: 0 }],
    });
    expect(report.steps.every((step) => step.listTimeout === undefined)).toBe(
      true,
    );
    expect((await h.store.browserJournal()).attempts.at(-1)).toMatchObject({
      state: 'not-listed',
      code: 'no-row',
    });
    expect(h.waits).not.toContain(60000);
  } finally {
    await h.close();
  }
});
test('C27 a CDP observer failure cannot turn a filtered timeout into another stop', async () => {
  const h = await harness('success', 2);
  await fullRunReady(h);
  h.fake.filteredListPlaceholders(3, false);
  const attach = vi
    .spyOn(selectorHelpers, 'observeListDomChanges')
    .mockImplementation(() =>
      Promise.resolve({
        applied() {},
        summary: () => ({
          observed: false,
          changes: 0,
          lastChangeAfterApplyMs: null,
          observedForMs: 0,
        }),
        failed: true,
        async dispose() {},
      }),
    );
  try {
    expect(await h.start('no-canary')).toMatchObject({
      code: 'PLATFORM_CHECK',
      token: 'list-timeout',
    });
    const run = (await h.store.browserJournal()).runs.find(
      (run) => run.runId !== 'generated-prior-canary',
    )!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    const report = JSON.parse(text) as { steps: unknown[] };
    for (const step of report.steps)
      expect(step).toMatchObject({
        listTimeout: { dom: { observed: false }, observationFailed: true },
      });
    expect(JSON.parse(text)).toMatchObject({
      retries: { used: 1, entries: [{ outcome: 'timeout' }] },
    });
  } finally {
    attach.mockRestore();
    await h.close();
  }
});
test.each([
  { count: 1, status: false },
  { count: 3, status: false },
  { count: 3, status: true },
] as const)(
  'C27 filtered placeholder count=$count status=$status remains list-timeout with content-free evidence',
  async ({ count, status }) => {
    const h = await harness('success', 2);
    await fullRunReady(h);
    h.fake.filteredListPlaceholders(count, status);
    try {
      expect(await h.start('no-canary')).toMatchObject({
        code: 'PLATFORM_CHECK',
        token: 'list-timeout',
      });
      const run = (await h.store.browserJournal()).runs.find(
        (run) => run.runId !== 'generated-prior-canary',
      )!;
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      const report = JSON.parse(text) as {
        steps: {
          listTimeout: {
            dom: {
              observedForMs: number;
              lastChangeAfterApplyMs: number | null;
            };
          };
        }[];
      };
      expect(report.steps).toHaveLength(2);
      for (const step of report.steps) {
        expect(step).toMatchObject({
          result: 'list-timeout',
          emptySkipped: count,
          listTimeout: {
            rowContainers: count,
            readableRows: 0,
            imageOnlyRows: count,
            statusElementPresent: status,
            busyElementPresent: !status,
            emptyStateClassKnown: false,
            emptyStatePresent: false,
            rowsObserved: true,
            filter: {
              applied: true,
              readbackObserved: true,
              startMatches: true,
              endMatches: true,
            },
            observationFailed: false,
            dom: { observed: true },
          },
        });
        expect(step.listTimeout.dom.lastChangeAfterApplyMs).not.toBeNull();
        expect(step.listTimeout.dom.lastChangeAfterApplyMs).toBeLessThanOrEqual(
          step.listTimeout.dom.observedForMs,
        );
      }
      expect(JSON.parse(text)).toMatchObject({
        retries: { used: 1, entries: [{ stage: 'list', outcome: 'timeout' }] },
        stop: { token: 'list-timeout' },
      });
      expect(run.pageOpens).toBe(2);
      expect(
        h.fake.requests.some((request) => /^\/(p|reel)\//.test(request.path)),
      ).toBe(false);
      for (const value of [
        h.plan.handle,
        IG_FIXTURE.code,
        'No generated comments in this window',
        ...Object.values(IG_FIXTURE.other),
      ])
        expect(text).not.toContain(value);
      assertRecordedEvents(h.fake.events);
    } finally {
      await h.close();
    }
  },
  120000,
);
test.each([
  { kind: 'p', canary: false },
  { kind: 'reel', canary: false },
  { kind: 'p', canary: true },
] as const)(
  'C26 same-document slow post kind=$kind canary=$canary retains a validated target without a navigation request',
  async ({ kind, canary }) => {
    const h = await harness(
      kind === 'reel' ? 'reel' : 'success',
      canary ? 5 : 2,
    );
    if (!canary) await fullRunReady(h);
    h.fake.clientSidePostOpens();
    h.fake.slowPostOpens(0, 1);
    const postRequests: { navigation: boolean; type: string }[] = [];
    const routeChanges: string[] = [];
    h.afterLaunch(() => {
      h.context!.on('page', (page) => {
        page.on('request', (request) => {
          if (new URL(request.url()).pathname === `/${kind}/${IG_FIXTURE.code}`)
            postRequests.push({
              navigation: request.isNavigationRequest(),
              type: request.resourceType(),
            });
        });
        page.on('framenavigated', (frame) => {
          if (
            frame === page.mainFrame() &&
            frame.url().endsWith(`/${kind}/${IG_FIXTURE.code}`)
          )
            routeChanges.push(frame.url());
        });
      });
      return Promise.resolve();
    });
    const failures: { name: string; class: string; url: string }[] = [];
    const open = driverHelpers.openCandidate;
    const observeOpen = vi
      .spyOn(driverHelpers, 'openCandidate')
      .mockImplementation(async (...args) => {
        try {
          return await open(...args);
        } catch (error) {
          failures.push({
            name: error instanceof Error ? error.name : 'other',
            class: errorClass(error),
            url: args[0].url(),
          });
          throw error;
        }
      });
    try {
      const result = await h.start(canary ? true : 'no-canary');
      const run = (await h.store.browserJournal()).runs.find(
        (run) => run.runId !== 'generated-prior-canary',
      )!;
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      const report = JSON.parse(text) as {
        retries: { used: number };
        cause?: { token: string; stage: string };
        steps: { ready: { postMs: number } }[];
      };
      expect(failures).toEqual([
        {
          name: 'TimeoutError',
          class: 'timeout',
          url: `${h.fake.origin}/${kind}/${IG_FIXTURE.code}`,
        },
      ]);
      expect(postRequests[0]).toEqual({ navigation: false, type: 'xhr' });
      expect(routeChanges[0]).toBe(
        `${h.fake.origin}/${kind}/${IG_FIXTURE.code}`,
      );
      // The red control must name the actual pre-fix stop and unused allowance.
      if (!canary && report.retries.used === 0) {
        expect(report.cause).toMatchObject({
          token: 'browser-timeout',
          stage: 'post-open',
        });
        expect(h.notices.join('')).toContain('retriesUsed=0; retries=[]');
        expect(run.pageOpens).toBe(1);
      }
      expect(report.retries.used, h.notices.join('')).toBe(canary ? 0 : 1);
      if (canary) {
        expect(result).toMatchObject({ code: 'CONTEXT_FAILED' });
        expect(report.cause).toMatchObject({
          token: 'browser-timeout',
          stage: 'post-open',
        });
        expect(h.waits).not.toContain(60000);
        expect(postRequests).toHaveLength(1);
      } else {
        expect(result).toMatchObject({ completed: 1, steps: 2 });
        expect(JSON.parse(text)).toMatchObject({
          retries: {
            used: 1,
            entries: [
              {
                step: 1,
                retryStep: 2,
                stage: 'post-open',
                waitedMs: 60000,
                outcome: 'ready',
              },
            ],
          },
        });
        expect(postRequests).toEqual([
          { navigation: false, type: 'xhr' },
          { navigation: true, type: 'document' },
        ]);
        expect(run.pageOpens).toBe(2);
        expect(h.waits.filter((ms) => ms === 60000)).toHaveLength(1);
      }
      expect(report.steps[0]!.ready.postMs).toBeGreaterThanOrEqual(5000);
      for (const value of [
        h.plan.handle,
        IG_FIXTURE.code,
        ...Object.values(IG_FIXTURE.other),
      ]) {
        expect(text).not.toContain(value);
        expect(h.notices.join('')).not.toContain(value);
      }
      assertRecordedEvents(h.fake.events);
    } finally {
      observeOpen.mockRestore();
      await h.close();
    }
  },
  120000,
);
test.each([1, 2])(
  'C25 filtered list empty %s times reopens once and journals both paced steps',
  async (emptyLoads) => {
    const h = await harness('success', 2);
    await fullRunReady(h);
    h.fake.emptyFilteredLists(emptyLoads);
    try {
      const result = await h.start('no-canary');
      if (emptyLoads === 1)
        expect(result, h.notices.join('')).toMatchObject({
          completed: 1,
          steps: 2,
        });
      else
        expect(result).toMatchObject({
          code: 'PLATFORM_CHECK',
          token: 'list-timeout',
        });
      const run = (await h.store.browserJournal()).runs.find(
        (run) => run.runId !== 'generated-prior-canary',
      )!;
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      expect(JSON.parse(text)).toMatchObject({
        retries: {
          used: 1,
          entries: [
            {
              step: 1,
              retryStep: 2,
              stage: 'list',
              waitedMs: 60000,
              outcome: emptyLoads === 1 ? 'ready' : 'timeout',
            },
          ],
        },
      });
      expect(run.pageOpens).toBe(2);
      expect(
        (
          await instagramDailyCount(
            h.store,
            h.plan.accountKey,
            new Date(IG_FIXTURE.now),
            h.plan.timeZone,
          )
        ).used,
      ).toBe(2);
      expect(h.waits.filter((ms) => ms === 60000)).toHaveLength(1);
      expect(
        h.fake.requests.filter(
          (request) => request.path === '/your_activity/interactions/comments',
        ),
      ).toHaveLength(2);
      expect(
        h.fake.requests.filter((request) => /^\/(p|reel)\//.test(request.path)),
      ).toHaveLength(emptyLoads === 1 ? 1 : 0);
      if (emptyLoads === 2)
        expect(h.notices.join('')).toContain('Stop detail: list-timeout');
      for (const value of [
        h.plan.handle,
        IG_FIXTURE.code,
        ...Object.values(IG_FIXTURE.other),
      ]) {
        expect(text).not.toContain(value);
        expect(h.notices.join('')).not.toContain(value);
      }
      assertRecordedEvents(h.fake.events);
    } finally {
      await h.close();
    }
  },
  120000,
);
test.each([false, true])(
  'C25 shared reopen budget mixed-post=%s stops on the fourth eligible empty filtered list',
  async (mixedPost) => {
    const h = await harness('success', 5);
    await fullRunReady(h);
    h.setLimit(20);
    if (mixedPost) h.fake.slowPostOpens(0, 1);
    let loads = 0;
    h.fake.beforeList(() => {
      loads++;
      if ((!mixedPost && loads === 1) || [3, 5, 7].includes(loads))
        h.fake.emptyFilteredLists(1);
      return Promise.resolve();
    });
    try {
      expect(await h.start('no-canary')).toMatchObject({
        code: 'PLATFORM_CHECK',
        token: 'list-timeout',
      });
      const run = (await h.store.browserJournal()).runs.find(
        (run) => run.runId !== 'generated-prior-canary',
      )!;
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      expect(JSON.parse(text)).toMatchObject({
        retries: {
          used: 3,
          entries: [
            {
              step: 1,
              retryStep: 2,
              stage: mixedPost ? 'post-open' : 'list',
              outcome: 'ready',
            },
            { step: 3, retryStep: 4, stage: 'list', outcome: 'ready' },
            { step: 5, retryStep: 6, stage: 'list', outcome: 'ready' },
          ],
        },
        stop: { token: 'list-timeout' },
      });
      expect(run.pageOpens).toBe(7);
      expect(h.waits.filter((ms) => ms === 60000)).toHaveLength(3);
      expect(
        (await h.store.read((tx) => records(tx.instagramContext))).filter(
          (record) => record.runId === run.runId,
        ),
      ).toHaveLength(3);
      assertRecordedEvents(h.fake.events);
    } finally {
      await h.close();
    }
  },
  180000,
);
test('C25 a canary empty filtered list still stops immediately without reopen or post requests', async () => {
  const h = await harness('success', 5);
  // The oldest-first canary probe navigates twice before it applies the filter.
  h.fake.emptyFilteredLists(2);
  try {
    expect(await h.start(true)).toMatchObject({
      code: 'PLATFORM_CHECK',
      token: 'list-timeout',
    });
    const run = (await h.store.browserJournal()).runs[0]!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      retries: { used: 0, entries: [] },
    });
    expect(run.pageOpens).toBe(1);
    expect(h.waits).not.toContain(60000);
    expect(
      h.fake.requests.filter((request) => /^\/(p|reel)\//.test(request.path)),
    ).toEqual([]);
    assertRecordedEvents(h.fake.events);
  } finally {
    await h.close();
  }
}, 60000);
test.each(['cap', 'run-limit', 'pace'] as const)(
  'C25 filtered-list reopen respects %s accounting before any new list open',
  async (mode) => {
    const h = await harness('success', 2);
    await fullRunReady(h);
    h.fake.emptyFilteredLists(1);
    if (mode === 'cap') h.setPace({ stepsPerDay: 1 });
    if (mode === 'run-limit') h.setLimit(1);
    if (mode === 'pace') h.setPace({ secondsPerStep: 10, batchPause: false });
    const starts: number[] = [];
    h.fake.beforeList(async () => {
      starts.push(
        Date.parse(
          (await h.store.browserJournal()).runs.find(
            (run) => run.runId !== 'generated-prior-canary',
          )!.lastPageOpenedAt!,
        ),
      );
    });
    try {
      const result = await h.start('no-canary');
      const run = (await h.store.browserJournal()).runs.find(
        (run) => run.runId !== 'generated-prior-canary',
      )!;
      if (mode === 'pace') {
        expect(result).toMatchObject({ completed: 1, steps: 2 });
        expect(starts).toHaveLength(2);
        expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(60000);
        expect(run.pageOpens).toBe(2);
      } else {
        expect(result).toMatchObject({
          code: 'PLATFORM_CHECK',
          token: 'list-timeout',
        });
        expect(starts).toHaveLength(1);
        expect(run.pageOpens).toBe(1);
        expect(h.waits).not.toContain(60000);
      }
    } finally {
      await h.close();
    }
  },
  120000,
);
test('C25 an initial empty list cannot acquire a filtered-list reopen', async () => {
  const h = await harness('never', 2);
  await fullRunReady(h);
  try {
    expect(await h.start('no-canary')).toMatchObject({
      code: 'PLATFORM_CHECK',
      token: 'list-timeout',
    });
    const run = (await h.store.browserJournal()).runs.find(
      (run) => run.runId !== 'generated-prior-canary',
    )!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      retries: { used: 0, entries: [] },
    });
    expect(h.waits).not.toContain(60000);
    expect(run.pageOpens).toBe(1);
  } finally {
    await h.close();
  }
}, 60000);
test.each(['error', 'login', 'challenge', '429', 'list-nav-other'] as const)(
  'C25 %s during list retry wait remains an immediate stop',
  async (variant) => {
    const h = await harness('success', 2);
    await fullRunReady(h);
    h.fake.emptyFilteredLists(1);
    h.afterWait(async (ms) => {
      if (ms !== 60000) return;
      h.fake.setVariant(variant);
      await h
        .context!.pages()
        .find((page) => new URL(page.url()).origin === h.fake.origin)!
        .goto(`${h.fake.origin}/your_activity/interactions/comments`);
    });
    try {
      expect(await h.start('no-canary')).toMatchObject({
        code:
          variant === 'list-nav-other' ? 'ACCOUNT_MISMATCH' : 'PLATFORM_CHECK',
      });
      const run = (await h.store.browserJournal()).runs.find(
        (run) => run.runId !== 'generated-prior-canary',
      )!;
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      expect(JSON.parse(text)).toMatchObject({
        retries: {
          used: 1,
          entries: [{ stage: 'list', retryStep: null, outcome: null }],
        },
      });
      expect(run.pageOpens).toBe(1);
      expect(
        h.fake.requests.filter((request) => /^\/(p|reel)\//.test(request.path)),
      ).toEqual([]);
    } finally {
      await h.close();
    }
  },
  120000,
);
test.each([1, 2])(
  'C23 post slow %s times reopens once with a counted paced step and keeps the original timeout on repetition',
  async (failures) => {
    const h = await harness('success', 2);
    await fullRunReady(h);
    h.fake.slowPostOpens(0, failures);
    try {
      const result = await h.start('no-canary');
      const run = (await h.store.browserJournal()).runs.find(
        (run) => run.runId !== 'generated-prior-canary',
      )!;
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      const report = JSON.parse(text) as {
        retries: {
          used: number;
          entries: {
            step: number;
            retryStep: number;
            stage: string;
            waitedMs: number;
            outcome: string | null;
          }[];
        };
        steps: { ready: { postMs: number } }[];
      };
      if (failures === 1)
        expect(result, h.notices.join('')).toMatchObject({
          completed: 1,
          steps: 2,
        });
      else expect(result).toMatchObject({ code: 'CONTEXT_FAILED' });
      expect(report.retries).toEqual({
        used: 1,
        entries: [
          {
            step: 1,
            retryStep: 2,
            stage: 'post-open',
            waitedMs: 60000,
            outcome: failures === 1 ? 'ready' : 'timeout',
          },
        ],
      });
      expect(run.pageOpens).toBe(2);
      expect(
        (
          await instagramDailyCount(
            h.store,
            h.plan.accountKey,
            new Date(IG_FIXTURE.now),
            h.plan.timeZone,
          )
        ).used,
      ).toBe(2);
      expect(h.waits.filter((ms) => ms === 60000)).toHaveLength(1);
      expect(report.steps).toHaveLength(2);
      expect(
        report.steps.every(
          (step) =>
            Number.isFinite(step.ready.postMs) && step.ready.postMs >= 0,
        ),
      ).toBe(true);
      if (failures === 2)
        expect(h.notices.join('')).toContain('Stop detail: browser-timeout');
      for (const value of [
        h.plan.handle,
        IG_FIXTURE.code,
        ...Object.values(IG_FIXTURE.other),
      ]) {
        expect(text).not.toContain(value);
        expect(h.notices.join('')).not.toContain(value);
      }
    } finally {
      await h.close();
    }
  },
  120000,
);
test('C23 four slow posts consume only three reopens and stop at the fourth first timeout', async () => {
  const h = await harness('success', 5);
  await fullRunReady(h);
  h.setLimit(20);
  for (let index = 0; index < 4; index++) h.fake.slowPostOpens(index, 1);
  try {
    expect(await h.start('no-canary')).toMatchObject({
      code: 'CONTEXT_FAILED',
    });
    const run = (await h.store.browserJournal()).runs.find(
      (run) => run.runId !== 'generated-prior-canary',
    )!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      retries: {
        used: 3,
        entries: [
          { step: 1, retryStep: 2, outcome: 'ready' },
          { step: 3, retryStep: 4, outcome: 'ready' },
          { step: 5, retryStep: 6, outcome: 'ready' },
        ],
      },
      stop: { token: 'browser-timeout' },
    });
    expect(run.pageOpens).toBe(7);
    expect(h.waits.filter((ms) => ms === 60000)).toHaveLength(3);
    expect(
      (await h.store.read((tx) => records(tx.instagramContext))).filter(
        (record) => record.runId === run.runId,
      ),
    ).toHaveLength(3);
  } finally {
    await h.close();
  }
}, 180000);
test('C23 a notice during the reopen wait stops without starting a second counted step', async () => {
  const h = await harness('success', 2);
  await fullRunReady(h);
  h.fake.slowPostOpens(0, 1);
  h.afterWait(async (ms) => {
    if (ms !== 60000) return;
    h.fake.setVariant('error');
    await h
      .context!.pages()
      .find((page) => new URL(page.url()).origin === h.fake.origin)!
      .goto(`${h.fake.origin}/your_activity/interactions/comments`);
  });
  try {
    expect(await h.start('no-canary')).toMatchObject({
      code: 'PLATFORM_CHECK',
      token: 'notice-error',
    });
    const run = (await h.store.browserJournal()).runs.find(
      (run) => run.runId !== 'generated-prior-canary',
    )!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      retries: {
        used: 1,
        entries: [{ step: 1, retryStep: null, outcome: null }],
      },
      stop: { token: 'notice-error' },
    });
    expect(run.pageOpens).toBe(1);
  } finally {
    await h.close();
  }
}, 120000);
test('C23 a normal main run records zero retries and finite per-step post readiness', async () => {
  const h = await harness('success', 2);
  await fullRunReady(h);
  try {
    expect(await h.start('no-canary')).toMatchObject({
      completed: 1,
      steps: 1,
    });
    const run = (await h.store.browserJournal()).runs.find(
      (run) => run.runId !== 'generated-prior-canary',
    )!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    const report = JSON.parse(text) as {
      retries: unknown;
      steps: { ready: { postMs: number } }[];
    };
    expect(report.retries).toEqual({ used: 0, entries: [] });
    expect(report.steps[0]!.ready.postMs).toBeGreaterThanOrEqual(0);
    expect(h.waits).not.toContain(60000);
  } finally {
    await h.close();
  }
});
test('C23 a canary browser timeout still stops without a retry as in X fill', async () => {
  const h = await harness('success', 5);
  h.fake.slowPostOpens(0, 1);
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CONTEXT_FAILED' });
    const run = (await h.store.browserJournal()).runs[0]!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      retries: { used: 0, entries: [] },
      stop: { token: 'browser-timeout' },
    });
    expect(run.pageOpens).toBe(1);
    expect(h.waits).not.toContain(60000);
  } finally {
    await h.close();
  }
}, 60000);
test('C23 a reopen is pinned to the timed-out post even when the fresh list offers a different candidate address', async () => {
  const h = await harness('success', 2);
  await fullRunReady(h);
  h.fake.slowPostOpens(0, 1);
  h.afterWait((ms) => {
    if (ms === 60000) h.fake.setCandidates(0, ['time']);
    return Promise.resolve();
  });
  try {
    expect(await h.start('no-canary')).toMatchObject({
      completed: 1,
      steps: 2,
    });
    expect(
      h.fake.requests.filter(
        (request) => request.path === `/p/${IG_FIXTURE.code}`,
      ),
    ).toHaveLength(2);
    expect(
      h.fake.requests.some((request) =>
        request.path.includes(IG_FIXTURE.candidateCodes[0]),
      ),
    ).toBe(false);
  } finally {
    await h.close();
  }
}, 120000);
test.each(['cap', 'run-limit', 'pace'] as const)(
  'C23 reopen obeys %s and never hides its extra step from the journal',
  async (mode) => {
    const h = await harness('success', 2);
    await fullRunReady(h);
    h.fake.slowPostOpens(0, 1);
    if (mode === 'cap') h.setPace({ stepsPerDay: 1 });
    if (mode === 'run-limit') h.setLimit(1);
    if (mode === 'pace') h.setPace({ secondsPerStep: 10, batchPause: false });
    const starts: number[] = [];
    h.fake.beforeList(async () => {
      starts.push(
        Date.parse(
          (await h.store.browserJournal()).runs.find(
            (run) => run.runId !== 'generated-prior-canary',
          )!.lastPageOpenedAt!,
        ),
      );
    });
    try {
      const result = await h.start('no-canary');
      const run = (await h.store.browserJournal()).runs.find(
        (run) => run.runId !== 'generated-prior-canary',
      )!;
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      if (mode === 'pace') {
        expect(result).toMatchObject({ completed: 1, steps: 2 });
        expect(starts).toHaveLength(2);
        expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(60000);
        expect(run.pageOpens).toBe(2);
      } else {
        expect(result).toMatchObject({ code: 'CONTEXT_FAILED' });
        expect(JSON.parse(text)).toMatchObject({ retries: { used: 0 } });
        expect(run.pageOpens).toBe(1);
        expect(h.waits).not.toContain(60000);
      }
    } finally {
      await h.close();
    }
  },
  120000,
);
test.each(['429', 'account', 'crash'] as const)(
  'C23 %s during retry wait stops before a second step or post open',
  async (signal) => {
    const h = await harness('success', 2);
    await fullRunReady(h);
    h.fake.slowPostOpens(0, 1);
    h.afterWait(async (ms) => {
      if (ms !== 60000) return;
      const page = h
        .context!.pages()
        .find((page) => new URL(page.url()).origin === h.fake.origin)!;
      if (signal === 'crash') {
        fakePageFailure(page, 'crash');
        return;
      }
      h.fake.setVariant(signal === '429' ? '429' : 'list-nav-other');
      await page.goto(`${h.fake.origin}/your_activity/interactions/comments`);
    });
    try {
      const result = await h.start('no-canary');
      expect(result).toMatchObject({
        code:
          signal === 'crash'
            ? 'CONTEXT_FAILED'
            : signal === 'account'
              ? 'ACCOUNT_MISMATCH'
              : 'PLATFORM_CHECK',
      });
      const run = (await h.store.browserJournal()).runs.find(
        (run) => run.runId !== 'generated-prior-canary',
      )!;
      expect(run.pageOpens).toBe(1);
    } finally {
      await h.close();
    }
  },
  120000,
);
test('C22 a normal automatic run writes the existing two structure snapshots and no late-event rewrite', async () => {
  const h = await harness('success', 5);
  const write = vi.spyOn(captureHelpers, 'writeStructure');
  try {
    expect(await h.start(true)).toMatchObject({ completed: 5 });
    expect(write).toHaveBeenCalledTimes(2);
    const run = (await h.store.browserJournal()).runs[0]!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      runtime: {
        pageCrashes: 0,
        browserDisconnects: 0,
        unexpectedPageCloses: 0,
        observationFailed: false,
        events: [],
      },
    });
  } finally {
    write.mockRestore();
    await h.close();
  }
});
test('C21 IG-15 an exact two-row list with one own row passes without changing the filter or opening another persons post', async () => {
  const h = await filterHarness('list-half-other', 1);
  try {
    const result = await driverHelpers.loadList(
      h.page,
      h.fixture.items[0]!,
      h.fixture.items[0]!.account.handle!,
      {
        ...productionContext,
        origin: h.fake.origin,
        responseMs: 1500,
        sleep: () => Promise.resolve(),
      },
      () => {},
    );
    expect(result).toMatchObject({ rowCount: 2, otherName: 1 });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.username).toBe(
      h.fixture.items[0]!.account.handle,
    );
    expect(
      h.fake.requests.filter((request) => /^\/(p|reel)\//.test(request.path)),
    ).toEqual([]);
  } finally {
    await h.close();
  }
});
test.each([
  'list-half-other',
  'list-majority-other',
  'list-half-other-filtered',
  'list-majority-other-filtered',
] as const)(
  'C21 IG-15 %s passes with a matching profile and at least one own row while other names stay diagnostic',
  async (variant) => {
    const h = await harness(variant, 5);
    try {
      expect(await h.start(true), h.notices.join('')).toMatchObject({
        completed: 5,
        endReason: 'canary',
      });
      const run = (await h.store.browserJournal()).runs[0]!;
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      const report = JSON.parse(text) as {
        steps: { rows: number; candidates: number }[];
        rows: { otherName: number };
        runtime: unknown;
      };
      expect(report.steps).toHaveLength(5);
      expect(
        report.steps.every((step) => step.rows >= 2 && step.candidates >= 1),
      ).toBe(true);
      expect(report.rows.otherName).toBeGreaterThan(0);
      expect(report.runtime).toMatchObject({
        pageCrashes: 0,
        browserDisconnects: 0,
        unexpectedPageCloses: 0,
        events: [],
      });
      expect(
        await h.store.read((tx) => records(tx.instagramContext)),
      ).toHaveLength(5);
      for (const value of [h.plan.handle, ...Object.values(IG_FIXTURE.other)]) {
        expect(text).not.toContain(value);
        expect(h.notices.join('')).not.toContain(value);
      }
    } finally {
      await h.close();
    }
  },
  120000,
);
test.each(['list-no-own', 'list-nav-missing', 'list-nav-other'] as const)(
  'C21 IG-15 %s still stops with its C20 evidence and readback class',
  async (variant) => {
    const h = await harness(variant, 2);
    try {
      expect(await h.start(true)).toMatchObject({
        code: 'ACCOUNT_MISMATCH',
        token: 'account-changed',
      });
      const run = (await h.store.browserJournal()).runs[0]!;
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      expect(JSON.parse(text)).toMatchObject({
        stop: {
          accountCheck: {
            rows: 2,
            ownRows: variant === 'list-no-own' ? 0 : 2,
            profileLinkFound: variant === 'list-no-own',
          },
        },
        readback: {
          accountAfterClass:
            variant === 'list-nav-other'
              ? 'other'
              : variant === 'list-nav-missing'
                ? 'absent'
                : 'expected',
        },
      });
      for (const value of [h.plan.handle, ...Object.values(IG_FIXTURE.other)]) {
        expect(text).not.toContain(value);
        expect(h.notices.join('')).not.toContain(value);
      }
    } finally {
      await h.close();
    }
  },
  60000,
);
test.each(['crash', 'closed', 'generic'] as const)(
  'C21 unexpected %s at post-read retains a closed class and owned lifecycle counts',
  async (kind) => {
    const h = await harness('success', 5);
    const read = vi
      .spyOn(driverHelpers, 'confirmOnPost')
      .mockImplementationOnce((page) =>
        Promise.reject(fakePageFailure(page, kind)),
      );
    try {
      expect(await h.start(true)).toMatchObject({ code: 'CONTEXT_FAILED' });
      const run = (await h.store.browserJournal()).runs[0]!;
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      const errorClass =
        kind === 'crash'
          ? 'page-crashed'
          : kind === 'closed'
            ? 'target-closed'
            : 'other';
      expect(JSON.parse(text)).toMatchObject({
        stop: { token: 'unexpected-error', errorClass },
        cause: { stage: 'post-read', step: 1, errorClass },
        runtime: {
          pageCrashes: kind === 'crash' ? 1 : 0,
          browserDisconnects: 0,
          unexpectedPageCloses: kind === 'closed' ? 1 : 0,
          events:
            kind === 'generic'
              ? []
              : [
                  {
                    event: kind === 'crash' ? 'page-crash' : 'page-close',
                    step: 1,
                    stage: 'post-read',
                    count: 1,
                  },
                ],
        },
      });
      expect(h.notices.join('')).toContain(
        `Stop detail: unexpected-error; errorClass=${errorClass}`,
      );
      expect((await h.store.browserJournal()).attempts.at(-1)).toMatchObject({
        state: 'failed',
        code: 'CONTEXT_FAILED',
      });
      for (const value of [h.plan.handle, ...Object.values(IG_FIXTURE.other)]) {
        expect(text).not.toContain(value);
        expect(h.notices.join('')).not.toContain(value);
      }
    } finally {
      read.mockRestore();
      await h.close();
    }
  },
  60000,
);
test('C21 a real closed owned target keeps the actual Playwright class without message inspection', async () => {
  const h = await harness('success', 5);
  const read = vi
    .spyOn(driverHelpers, 'confirmOnPost')
    .mockImplementationOnce(async (page) => {
      await page.close();
      await page.title();
      throw new Error('generated closed target unexpectedly responded');
    });
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CONTEXT_FAILED' });
    const run = (await h.store.browserJournal()).runs[0]!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      stop: { token: 'unexpected-error', errorClass: 'target-closed' },
      runtime: {
        pageCrashes: 0,
        unexpectedPageCloses: 1,
        events: [
          { event: 'page-close', step: 1, stage: 'post-read', count: 1 },
        ],
      },
    });
    expect(h.notices.join('')).toContain(
      'Stop detail: unexpected-error; errorClass=target-closed',
    );
    for (const value of [h.plan.handle, ...Object.values(IG_FIXTURE.other)]) {
      expect(text).not.toContain(value);
      expect(h.notices.join('')).not.toContain(value);
    }
  } finally {
    read.mockRestore();
    await h.close();
  }
}, 60000);
test('C21 an earlier crash event is retained but does not relabel a later generic error as a page crash', async () => {
  const h = await harness('success', 5);
  const read = vi
    .spyOn(driverHelpers, 'confirmOnPost')
    .mockImplementationOnce((page) => {
      fakePageFailure(page, 'crash');
      return Promise.reject(new Error(IG_FIXTURE.other.text));
    });
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CONTEXT_FAILED' });
    const run = (await h.store.browserJournal()).runs[0]!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      stop: { token: 'unexpected-error', errorClass: 'other' },
      runtime: { pageCrashes: 1 },
    });
  } finally {
    read.mockRestore();
    await h.close();
  }
}, 60000);
test('C21 late finalization unexpected errors retain their class and stage after the first structure write', async () => {
  const h = await harness('success', 5);
  class ProtocolError extends Error {}
  let restore: (() => void) | undefined;
  h.afterLaunch(() => {
    const close = vi.spyOn(h.context!, 'close').mockImplementationOnce(() => {
      fakePageFailure(h.context!.pages().at(-1)!, 'crash');
      return Promise.reject(new ProtocolError(IG_FIXTURE.other.text));
    });
    restore = () => close.mockRestore();
    return Promise.resolve();
  });
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CONTEXT_FAILED' });
    const run = (await h.store.browserJournal()).runs[0]!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      stop: { token: 'unexpected-error', errorClass: 'protocol' },
      cause: { stage: 'browser-close', step: 5, errorClass: 'protocol' },
      runtime: {
        pageCrashes: 1,
        events: [
          { event: 'page-crash', stage: 'browser-close', step: 5, count: 1 },
        ],
      },
    });
    expect(h.notices.join('')).toContain(
      'Stop detail: unexpected-error; errorClass=protocol',
    );
    expect(text + h.notices.join('')).not.toContain(IG_FIXTURE.other.text);
  } finally {
    restore?.();
    await h.close();
  }
}, 120000);
test.each([
  'list-nav-missing',
  'list-no-own',
  'list-nav-after-deadline',
] as const)(
  'C20 account-check %s preserves the failed conditions and never emits private values',
  async (variant) => {
    const h = await harness(variant, 5);
    try {
      expect(await h.start(true)).toMatchObject({
        code: 'ACCOUNT_MISMATCH',
        token: 'account-changed',
      });
      const journal = await h.store.browserJournal(),
        run = journal.runs[0]!;
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      const report = JSON.parse(text) as {
        stop: {
          accountCheck: {
            profileLinkFound: boolean;
            outsidePathCount: number;
            rows: number;
            ownRows: number;
            reads: number;
            elapsedMs: number;
            lastReadAfterDeadline: boolean;
          };
        };
        readback: { accountBeforeClass: string; accountAfterClass: string };
      };
      const detail = report.stop.accountCheck;
      expect(detail).toMatchObject(
        variant === 'list-no-own'
          ? {
              profileLinkFound: true,
              outsidePathCount: 1,
              rows: 5,
              ownRows: 0,
            }
          : {
              profileLinkFound: false,
              outsidePathCount: 0,
              rows: 5,
              ownRows: 5,
            },
      );
      expect(detail.reads).toBeGreaterThan(0);
      expect(detail.elapsedMs).toBeGreaterThanOrEqual(1500);
      expect(typeof detail.lastReadAfterDeadline).toBe('boolean');
      expect(h.notices.join('')).toContain(
        `Stop detail: account-changed; link=${detail.profileLinkFound}; outsidePathCount=${detail.outsidePathCount}; rows=${detail.rows}; own=${detail.ownRows}; reads=${detail.reads}; elapsedMs=${detail.elapsedMs}; lastReadAfterDeadline=${detail.lastReadAfterDeadline}`,
      );
      if (variant === 'list-no-own')
        expect(detail.ownRows).toBeLessThan(detail.rows / 2);
      if (variant === 'list-nav-after-deadline') {
        expect(detail.elapsedMs).toBeLessThan(
          IG_FIXTURE.expected.accountDeadlineDelayMs,
        );
        expect(report.readback.accountAfterClass).toBe('absent');
      }
      expect(journal.attempts.at(-1)).toMatchObject({
        state: 'failed',
        code: 'ACCOUNT_MISMATCH',
      });
      expect(await h.store.read((tx) => records(tx.instagramContext))).toEqual(
        [],
      );
      for (const value of [
        h.plan.handle,
        `/${h.plan.handle}/`,
        IG_FIXTURE.code,
        ...Object.values(IG_FIXTURE.other),
        ...h.fixture.items.map((item) => item.text),
      ]) {
        expect(text).not.toContain(value);
        expect(h.notices.join('')).not.toContain(value);
      }
    } finally {
      await h.close();
    }
  },
  60000,
);
test.each(['list-nav-missing', 'list-nav-other'] as const)(
  'C20 readback %s classifies the last failed list separately from the completed list',
  async (variant) => {
    const h = await harness('success', 3);
    await fullRunReady(h);
    let loads = 0;
    h.fake.beforeList(() => {
      if (++loads === 2) h.fake.setVariant(variant);
      return Promise.resolve();
    });
    try {
      expect(await h.start('no-canary')).toMatchObject({
        code: 'ACCOUNT_MISMATCH',
        token: 'account-changed',
      });
      const run = (await h.store.browserJournal()).runs.find(
        (run) => run.runId !== 'generated-prior-canary',
      )!;
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      const accountAfterClass =
        variant === 'list-nav-missing' ? 'absent' : 'other';
      expect(JSON.parse(text)).toMatchObject({
        readback: { accountBeforeClass: 'expected', accountAfterClass },
      });
      expect(h.notices.join('')).toContain(
        `"accountAfterClass":"${accountAfterClass}"`,
      );
      for (const value of [
        h.plan.handle,
        `/${h.plan.handle}/`,
        ...Object.values(IG_FIXTURE.other),
      ]) {
        expect(text).not.toContain(value);
        expect(h.notices.join('')).not.toContain(value);
      }
    } finally {
      await h.close();
    }
  },
  120000,
);
test('C20 a normal account list never stops and both readback classes remain expected', async () => {
  const h = await harness('success', 5);
  try {
    expect(await h.start(true), h.notices.join('')).toMatchObject({
      completed: 5,
      endReason: 'canary',
    });
    const run = (await h.store.browserJournal()).runs[0]!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      readback: {
        accountBeforeClass: 'expected',
        accountAfterClass: 'expected',
      },
    });
    expect(h.notices.join('')).not.toContain('Stop detail:');
    for (const value of [
      h.plan.handle,
      `/${h.plan.handle}/`,
      ...Object.values(IG_FIXTURE.other),
    ]) {
      expect(text).not.toContain(value);
      expect(h.notices.join('')).not.toContain(value);
    }
  } finally {
    await h.close();
  }
}, 120000);
test.each(POST_NOTICE_FIXTURE.cases)(
  'C19 $variant keeps only bounded closed body counts and still stops at the notice',
  async (entry) => {
    const h = await harness('success', 3);
    h.fake.setPostVariant(0, entry.variant);
    const reads: string[] = [];
    h.afterLaunch(() => {
      h.context!.on('response', (response) => {
        if (
          response.status() !== 404 ||
          new URL(response.url()).pathname !== entry.path
        )
          return;
        const original = response.body.bind(response);
        vi.spyOn(response, 'body').mockImplementation(() => {
          reads.push(entry.variant);
          return original();
        });
      });
      return Promise.resolve();
    });
    try {
      expect(await h.start(true), h.notices.join('')).toMatchObject({
        code: 'PLATFORM_CHECK',
      });
      const journal = await h.store.browserJournal(),
        run = journal.runs[0]!;
      const database = new DatabaseSync(
        join(h.directory, 'socialprune.sqlite'),
        { readOnly: true },
      );
      try {
        expect(database.prepare('PRAGMA user_version').get()).toMatchObject({
          user_version: 11,
        });
      } finally {
        database.close();
      }
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      const report = JSON.parse(text) as {
        steps: {
          postRequests: {
            path: string;
            status: number;
            count: number;
            bodyClasses?: { class: string; count: number }[];
          }[];
        }[];
        stop: { token: string };
      };
      const responses = 'responses' in entry ? entry.responses : 1;
      const expectedBodies = [
        {
          class: entry.bodyClass,
          count: Math.min(responses, POST_NOTICE_FIXTURE.perStepBodies),
        },
        ...(responses > POST_NOTICE_FIXTURE.perStepBodies
          ? [
              {
                class: 'not-classified',
                count: responses - POST_NOTICE_FIXTURE.perStepBodies,
              },
            ]
          : []),
      ];
      expect(report.steps).toHaveLength(1);
      expect(report.stop.token).toBe('notice-error');
      expect(h.notices.join('')).toContain('Stop detail: notice-error');
      expect(report.steps[0]!.postRequests).toEqual(
        expect.arrayContaining([
          {
            path: entry.pathClass,
            status: 404,
            count: responses,
            bodyClasses: expectedBodies,
          },
        ]),
      );
      expect(reads).toHaveLength(
        entry.bodyClass === 'large'
          ? 0
          : Math.min(responses, POST_NOTICE_FIXTURE.perStepBodies),
      );
      expect(
        journal.attempts.filter((attempt) => attempt.state === 'sending'),
      ).toHaveLength(1);
      expect(journal.attempts.at(-1)).toMatchObject({
        state: 'failed',
        code: 'PLATFORM_CHECK',
      });
      expect(run.canaryAcceptedAt).toBeNull();
      expect(await h.store.read((tx) => records(tx.instagramContext))).toEqual(
        [],
      );
      expect(
        h.fake.requests.filter((request) =>
          /^\/(?:p|reel)\//.test(request.path),
        ),
      ).toEqual([]);
      expect(
        h.fake.requests.filter((request) => request.path === entry.path),
      ).toHaveLength(responses);
      for (const value of [
        POST_NOTICE_FIXTURE.mediaId,
        IG_FIXTURE.commentId,
        IG_FIXTURE.code,
        'Not Found',
        ...Object.values(IG_FIXTURE.other),
        ...h.fixture.items.flatMap((item) => [
          item.text,
          item.account.handle!,
          item.reference.ownerHandle!,
          item.id,
        ]),
        h.fake.origin,
      ])
        expect(text).not.toContain(value);
      assertRecordedEvents(h.fake.events);
    } finally {
      await h.close();
    }
  },
  60000,
);
test('C18 excluded oldest comment is never chosen in an ordered canary and the reduced plan survives both stale checks', async () => {
  const h = await harness('success', 6);
  try {
    await h.setExclude(new Set([h.fixture.items[0]!.id]));
    expect(await h.start(true), h.notices.join('')).toMatchObject({
      completed: 5,
      endReason: 'canary',
    });
    const journal = await h.store.browserJournal();
    expect(journal.attempts.map((attempt) => attempt.itemId)).not.toContain(
      h.fixture.items[0]!.id,
    );
    expect(journal.runs[0]!.canaryAcceptedAt).toBeTruthy();
    expect(
      h.fake.requests.filter((request) =>
        request.path.startsWith('/api/v1/generated/post-notice/'),
      ),
    ).toEqual([]);
    expect(
      h.fake.requests.some(
        (request) =>
          request.path === `/p/${IG_FIXTURE.code}` ||
          request.path === `/p/${IG_FIXTURE.code}/`,
      ),
    ).toBe(false);
    expect(
      await h.store.read((tx) => records(tx.instagramContext)),
    ).toHaveLength(5);
    assertRecordedEvents(h.fake.events);
  } finally {
    await h.close();
  }
}, 120000);
test('C18 person-excluded entry stays out of a later full run', async () => {
  const h = await harness('success', 4);
  try {
    await fullRunReady(h);
    await h.setExclude(new Set([h.fixture.items[0]!.id]));
    h.setLimit(2);
    expect(await h.start('no-canary'), h.notices.join('')).toMatchObject({
      completed: 2,
      endReason: 'done',
    });
    const journal = await h.store.browserJournal();
    expect(journal.attempts.map((attempt) => attempt.itemId)).not.toContain(
      h.fixture.items[0]!.id,
    );
    expect(
      h.fake.requests.filter((request) =>
        request.path.startsWith('/api/v1/generated/post-notice/'),
      ),
    ).toEqual([]);
    expect(
      h.fake.requests.some(
        (request) =>
          request.path === `/p/${IG_FIXTURE.code}` ||
          request.path === `/p/${IG_FIXTURE.code}/`,
      ),
    ).toBe(false);
    assertRecordedEvents(h.fake.events);
  } finally {
    await h.close();
  }
}, 120000);
test.each([404, 429, 503] as const)(
  'C17 post-open notice HTTP %s stops immediately and reports only own step status classes',
  async (status) => {
    const h = await harness('success', 3);
    h.fake.setPostVariant(0, `post-notice-${status}`);
    try {
      expect(await h.start(true)).toMatchObject({ code: 'PLATFORM_CHECK' });
      const journal = await h.store.browserJournal(),
        run = journal.runs[0]!;
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      const report = JSON.parse(text) as {
        steps: {
          postRequests: { path: string; status: number; count: number }[];
        }[];
        limits: {
          responses: { path: string; status4xx: Record<string, number> }[];
        };
        stop: { token: string };
      };
      expect(report.steps).toHaveLength(1);
      if (status === 429)
        expect(report.stop.token).toMatch(/^(?:http-429|notice-error)$/);
      else expect(report.stop.token).toBe('notice-error');
      expect(report.steps[0]!.postRequests).toEqual(
        expect.arrayContaining([
          {
            path: 'api-v1-other',
            status,
            count: 1,
            ...(status < 500
              ? { bodyClasses: [{ class: 'json', count: 1 }] }
              : {}),
          },
        ]),
      );
      expect(
        report.steps[0]!.postRequests.some(
          (group) => group.path === 'post-page' || group.path === 'list-page',
        ),
      ).toBe(false);
      if (status === 429)
        expect(report.limits.responses).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: 'api-v1-read',
              status4xx: { '429': 1 },
            }),
          ]),
        );
      expect(
        journal.attempts.filter((attempt) => attempt.state === 'sending'),
      ).toHaveLength(1);
      expect(journal.attempts.at(-1)).toMatchObject({
        state: 'failed',
        code: 'PLATFORM_CHECK',
      });
      expect(await h.store.read((tx) => records(tx.instagramContext))).toEqual(
        [],
      );
      expect(
        h.fake.requests.filter((request) =>
          /^\/(?:p|reel)\//.test(request.path),
        ),
      ).toEqual([]);
      expect(
        h.fake.requests.filter((request) =>
          request.path.startsWith('/api/v1/generated/post-notice/'),
        ),
      ).toHaveLength(1);
      for (const value of [
        IG_FIXTURE.code,
        ...Object.values(IG_FIXTURE.other),
        ...h.fixture.items.flatMap((item) => [
          item.text,
          item.account.handle!,
          item.reference.ownerHandle!,
          item.id,
        ]),
        h.fake.origin,
      ])
        expect(text).not.toContain(value);
      assertRecordedEvents(h.fake.events);
    } finally {
      await h.close();
    }
  },
  60000,
);
test('C17 a later comment notice keeps preceding post responses in their own steps and still stops before a third', async () => {
  const h = await harness('success', 3);
  h.fake.setPostVariant(1, 'post-notice-404');
  try {
    expect(await h.start(true)).toMatchObject({ code: 'PLATFORM_CHECK' });
    const journal = await h.store.browserJournal(),
      run = journal.runs[0]!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    const report = JSON.parse(text) as {
      steps: {
        postRequests: { path: string; status: number; count: number }[];
      }[];
    };
    expect(report.steps).toHaveLength(2);
    expect(report.steps[0]!.postRequests).toEqual(
      expect.arrayContaining([{ path: 'post-page', status: 200, count: 1 }]),
    );
    expect(
      report.steps[0]!.postRequests.some((group) => group.status === 404),
    ).toBe(false);
    expect(report.steps[1]!.postRequests).toEqual(
      expect.arrayContaining([
        {
          path: 'api-v1-other',
          status: 404,
          count: 1,
          bodyClasses: [{ class: 'json', count: 1 }],
        },
      ]),
    );
    expect(
      report.steps[1]!.postRequests.some(
        (group) => group.path === 'post-page' || group.path === 'list-page',
      ),
    ).toBe(false);
    expect(
      journal.attempts.filter((attempt) => attempt.state === 'sending'),
    ).toHaveLength(2);
    expect(journal.attempts.at(-1)).toMatchObject({
      state: 'failed',
      code: 'PLATFORM_CHECK',
    });
    expect(
      await h.store.read((tx) => records(tx.instagramContext)),
    ).toHaveLength(1);
    expect(run.canaryAcceptedAt).toBeNull();
    assertRecordedEvents(h.fake.events);
  } finally {
    await h.close();
  }
}, 120000);
test('C16 unexpected list-read error survives CONTEXT_FAILED as a closed correlated cause', async () => {
  const h = await harness('success', 1);
  const timeout = new Error(IG_FIXTURE.other.text);
  timeout.name = 'TimeoutError';
  const failure = new Error(IG_FIXTURE.other.username, { cause: timeout });
  const load = vi
    .spyOn(driverHelpers, 'loadList')
    .mockRejectedValueOnce(failure);
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CONTEXT_FAILED' });
    const journal = await h.store.browserJournal(),
      run = journal.runs[0]!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      stop: { token: 'browser-timeout' },
      cause: {
        runId: run.runId,
        stage: 'list-read',
        step: 1,
        token: 'browser-timeout',
        chain: ['unexpected-error', 'browser-timeout'],
      },
    });
    expect(h.notices.join('')).toContain(
      `Stop detail: browser-timeout; stage=list-read; step=1; run=${run.runId}`,
    );
    expect(run.canaryAcceptedAt).toBeNull();
    expect(journal.attempts.at(-1)).toMatchObject({
      state: 'failed',
      code: 'CONTEXT_FAILED',
    });
    for (const value of [
      h.plan.handle,
      IG_FIXTURE.code,
      ...Object.values(IG_FIXTURE.other),
    ]) {
      expect(text).not.toContain(value);
      expect(h.notices.join('')).not.toContain(value);
    }
  } finally {
    load.mockRestore();
    await h.close();
  }
});
test('C16 first unexpected cause survives a later finalization failure without exposing messages', async () => {
  const h = await harness('success', 1);
  const failure = Object.assign(new Error(IG_FIXTURE.other.text), {
    code: 'EBUSY',
  });
  h.setCapture(() => Promise.reject(failure));
  const later = vi
    .spyOn(profileHelpers, 'writeExtensionReport')
    .mockRejectedValue(new TypeError(IG_FIXTURE.other.username));
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CONTEXT_FAILED' });
    const run = (await h.store.browserJournal()).runs[0]!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    const report = JSON.parse(text) as {
      finalization: { stage: string; stop: { code: string; token: string } }[];
    };
    expect(report).toMatchObject({
      stop: { token: 'fs-EBUSY' },
      cause: {
        runId: run.runId,
        stage: 'capture',
        step: 1,
        token: 'fs-EBUSY',
        chain: ['fs-EBUSY'],
      },
    });
    expect(report.finalization).toContainEqual({
      stage: 'extension-report',
      stop: { code: 'type-error', token: 'type-error' },
    });
    expect(h.notices.join('')).toContain(
      `Stop detail: fs-EBUSY; stage=capture; step=1; run=${run.runId}`,
    );
    for (const value of Object.values(IG_FIXTURE.other)) {
      expect(text).not.toContain(value);
      expect(h.notices.join('')).not.toContain(value);
    }
  } finally {
    later.mockRestore();
    await h.close();
  }
});
test('C16 an unexpected browser-close failure is persisted after the earlier structure write', async () => {
  const h = await harness('success', 5);
  const failure = new RangeError(IG_FIXTURE.other.text);
  let reset: (() => void) | undefined;
  h.afterLaunch(() => {
    const close = vi.spyOn(h.context!, 'close').mockRejectedValueOnce(failure);
    reset = () => close.mockRestore();
    return Promise.resolve();
  });
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CONTEXT_FAILED' });
    const run = (await h.store.browserJournal()).runs[0]!;
    const text = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      stop: { token: 'range-error' },
      cause: {
        runId: run.runId,
        stage: 'browser-close',
        step: 5,
        token: 'range-error',
        chain: ['range-error'],
      },
    });
    expect(h.notices.join('')).toContain(
      `Stop detail: range-error; stage=browser-close; step=5; run=${run.runId}`,
    );
    expect(text).not.toContain(IG_FIXTURE.other.text);
  } finally {
    reset?.();
    await h.close();
  }
}, 120000);
test('C13 Continue waits for the generated read to settle, not a 30-second click over an unfinished step', async () => {
  const h = await harness('owner-first-profile', 1, 45000);
  let first = true;
  h.fake.beforeList(async () => {
    if (!first) return;
    first = false;
    await new Promise((resolve) => setTimeout(resolve, 31000));
  });
  try {
    const running = h.start();
    await h.click('Start');
    await h.click('Continue');
    expect(await running).toMatchObject({ completed: 0, endReason: 'canary' });
    const attempts = await h.store.read((tx) => records(tx.browserAttempts));
    expect(attempts.map((attempt) => attempt.state)).toEqual([
      'sending',
      'unconfirmed',
    ]);
    expect(attempts[1]!.code).toBe('owner');
  } finally {
    await h.close();
  }
}, 120000);
test.each(['post', 'list'] as const)(
  'C12 IG-9 mixed-name list keeps only own candidates and confirms by %s with closed counts',
  async (confirmedBy) => {
    const h = await harness('list-other-names', 5);
    if (confirmedBy === 'list')
      for (let index = 0; index < 5; index++) h.fake.setPostHidden(index);
    try {
      expect(await h.start(true), h.notices.join('')).toMatchObject({
        completed: 5,
        steps: 5,
        endReason: 'canary',
      });
      const journal = await h.store.browserJournal();
      expect(journal.runs[0]!.canaryAcceptedAt).toBeTruthy();
      const contexts = await h.store.read((tx) => records(tx.instagramContext));
      expect(contexts).toHaveLength(5);
      expect(
        contexts.every((record) => record.confirmedBy === confirmedBy),
      ).toBe(true);
      const report = await readFile(
        join(
          h.directory,
          'context',
          'instagram',
          `canary-${journal.runs[0]!.runId}.json`,
        ),
        'utf8',
      );
      expect(JSON.parse(report)).toMatchObject({
        rows: { otherName: IG_FIXTURE.expected.otherNameRows * 5 },
        steps: Array.from({ length: 5 }, (_, index) => ({
          otherName: IG_FIXTURE.expected.otherNameRows,
          candidates: 1,
          oldestWithinWeek: index === 0 ? true : null,
        })),
      });
      expect(
        h.fake.requests.some((request) =>
          request.path.includes(IG_FIXTURE.other.code),
        ),
      ).toBe(false);
      for (const value of [
        ...Object.values(IG_FIXTURE.other),
        ...Object.values(IG_FIXTURE.postDecoys),
        ...h.fixture.items.flatMap((item) => [
          item.text,
          item.account.handle!,
          item.reference.ownerHandle!,
        ]),
      ]) {
        expect(report).not.toContain(value);
        expect(JSON.stringify(contexts)).not.toContain(
          IG_FIXTURE.other.username,
        );
      }
    } finally {
      await h.close();
    }
  },
  120000,
);
test('C12 IG-9 delayed navigation is awaited within the response window before the first list click', async () => {
  const h = await filterHarness('list-other-names-nav-late');
  const actualClick = selectorHelpers.clickAllowed;
  const clicks = vi.spyOn(selectorHelpers, 'clickAllowed');
  const late: boolean[] = [];
  clicks.mockImplementation(async (page, click, guard) => {
    late.push((await page.locator('#navigation a').count()) === 1);
    return actualClick(page, click, guard);
  });
  try {
    const list = await driverHelpers.loadList(
      h.page,
      h.fixture.items[0]!,
      h.fixture.items[0]!.account.handle!,
      {
        ...productionContext,
        origin: h.fake.origin,
        responseMs: 2000,
        sleep: async () => {},
      },
      () => {},
    );
    expect(list.candidates).toHaveLength(1);
    expect(late.length).toBeGreaterThan(0);
    expect(late.every(Boolean)).toBe(true);
  } finally {
    clicks.mockRestore();
    await h.close();
  }
});
test.each([
  'list-nav-other',
  'list-nav-missing',
  'list-nav-inside-main',
  'list-no-own',
  'list-nav-other-filtered',
  'list-nav-missing-filtered',
  'list-no-own-filtered',
] as const)(
  'C12 IG-9 %s stops account-changed before the first action beyond its account boundary',
  async (variant) => {
    const h = await harness(variant, 5);
    try {
      expect(await h.start(true), h.notices.join('')).toMatchObject({
        code: 'ACCOUNT_MISMATCH',
      });
      expect(
        h.fake.requests.some((request) => /^\/(p|reel)\//.test(request.path)),
      ).toBe(false);
      const clicks = h.fake.events.at(-1)?.clicks ?? [];
      if (!variant.endsWith('-filtered')) expect(clicks).toEqual([]);
      else {
        expect(clicks.at(-1)).toBe('Apply');
        expect(h.fake.events.at(-1)!.wheels).toEqual([]);
      }
      expect(await h.store.read((tx) => records(tx.instagramContext))).toEqual(
        [],
      );
      const journal = await h.store.browserJournal();
      expect(journal.runs[0]!.canaryAcceptedAt).toBeNull();
      expect(journal.attempts.map((attempt) => attempt.state)).toEqual([
        'sending',
        'failed',
      ]);
      const report = await readFile(
        join(
          h.directory,
          'context',
          'instagram',
          `canary-${journal.runs[0]!.runId}.json`,
        ),
        'utf8',
      );
      expect(JSON.parse(report)).toMatchObject({
        stop: { code: 'ACCOUNT_MISMATCH', token: 'account-changed' },
      });
      for (const value of Object.values(IG_FIXTURE.other))
        expect(report).not.toContain(value);
    } finally {
      await h.close();
    }
  },
  120000,
);
test.each(['expansion-post-switch', 'expansion-kind-switch'] as const)(
  'C10 revision %s stops when expansion changes post identity under the same owner',
  async (variant) => {
    const h = await filterHarness(variant);
    try {
      await h.open();
      const deps = {
        ...productionContext,
        origin: h.fake.origin,
        responseMs: 5000,
        sleep: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
        },
      };
      expect(await openCandidate(h.page, 0, deps, () => {})).toBe(true);
      expect(await readPost(h.page, h.fake.origin)).toMatchObject({
        kind: 'p',
        code: IG_FIXTURE.code,
        owner: h.fixture.items[0]!.reference.ownerHandle,
      });
      await expect(
        confirmOnPost(
          h.page,
          h.fixture.items[0]!,
          h.fixture.items[0]!.account.handle!,
          deps,
          () => {},
        ),
      ).rejects.toMatchObject({
        code: 'INSTAGRAM_SHAPE_CHANGED',
        token: 'post-structure',
      });
      expect(await readPost(h.page, h.fake.origin)).toMatchObject({
        kind: variant === 'expansion-kind-switch' ? 'reel' : 'p',
        code:
          variant === 'expansion-post-switch'
            ? IG_FIXTURE.other.code
            : IG_FIXTURE.code,
        owner: h.fixture.items[0]!.reference.ownerHandle,
        ownerCount: 1,
        ownerMatchesProfile: true,
      });
      await expect.poll(() => h.fake.events.at(-1)?.wheels.length).toBe(1);
    } finally {
      await h.close();
    }
  },
);
test.each(['expansion-post-switch', 'expansion-kind-switch'] as const)(
  'C10 revision %s reaches the canary as post-structure before list confirmation or capture',
  async (variant) => {
    const h = await harness(variant, 5);
    const capture = vi.fn(capturePost);
    h.setCapture(capture);
    try {
      expect(await h.start(true), h.notices.join('')).toMatchObject({
        code: 'INSTAGRAM_SHAPE_CHANGED',
      });
      expect(capture).not.toHaveBeenCalled();
      expect(await h.store.read((tx) => records(tx.instagramContext))).toEqual(
        [],
      );
      const journal = await h.store.browserJournal();
      expect(journal.attempts.map((attempt) => attempt.state)).toEqual([
        'sending',
        'failed',
      ]);
      expect(journal.attempts.at(-1)).toMatchObject({
        code: 'INSTAGRAM_SHAPE_CHANGED',
      });
      expect(journal.runs[0]!.canaryAcceptedAt).toBeNull();
      const report = await readFile(
        join(
          h.directory,
          'context',
          'instagram',
          `canary-${journal.runs[0]!.runId}.json`,
        ),
        'utf8',
      );
      expect(JSON.parse(report)).toMatchObject({
        stop: { code: 'INSTAGRAM_SHAPE_CHANGED', token: 'post-structure' },
      });
      for (const value of [
        IG_FIXTURE.code,
        ...Object.values(IG_FIXTURE.other),
        h.fixture.items[0]!.text,
        h.fixture.items[0]!.account.handle!,
        h.fixture.items[0]!.reference.ownerHandle!,
      ])
        expect(report).not.toContain(value);
    } finally {
      await h.close();
    }
  },
  120000,
);
test('C10 settled read requires consecutive markup samples at least 500 ms apart', async () => {
  const h = await filterHarness('own-link-flicker');
  const times: number[] = [];
  const actual = selectorHelpers.postElement;
  const sample = vi
    .spyOn(selectorHelpers, 'postElement')
    .mockImplementation(async (...args) => {
      const found = await actual(...args);
      if (found === null) times.length = 0;
      else times.push(performance.now());
      return found;
    });
  try {
    await h.page.goto(`${h.fake.origin}/p/${IG_FIXTURE.code}`);
    expect(
      await driverHelpers.settledPost(
        h.page,
        { origin: h.fake.origin, responseMs: 10000 },
        () => {},
      ),
    ).toMatchObject({ ownerCount: 1 });
    expect(times.length).toBeGreaterThanOrEqual(2);
    expect(times.at(-1)! - times.at(-2)!).toBeGreaterThanOrEqual(500);
  } finally {
    sample.mockRestore();
    await h.close();
  }
});
test.each(['own-link-flicker', 'expansion-link-flicker'] as const)(
  'C10 settled read %s confirms after markup returns, with two reads at least 500 ms apart',
  async (variant) => {
    const h = await harness(variant, 5, 5000);
    try {
      expect(await h.start(true), h.notices.join('')).toMatchObject({
        completed: 5,
        endReason: 'canary',
      });
      const saved = await h.store.read((tx) => records(tx.instagramContext));
      expect(saved).toHaveLength(5);
      expect(
        saved.every((record) => Reflect.get(record, 'confirmedBy') === 'post'),
      ).toBe(true);
    } finally {
      await h.close();
    }
  },
  180000,
);
test.each(['own-link-vanishes', 'expansion-link-vanishes'] as const)(
  'C10 settled read %s missing for the response window stops post-structure without confirmation',
  async (variant) => {
    const h = await filterHarness(variant);
    try {
      await h.page.goto(`${h.fake.origin}/p/${IG_FIXTURE.code}`);
      await expect(
        driverHelpers.confirmOnPost(
          h.page,
          h.fixture.items[0]!,
          h.fixture.items[0]!.account.handle!,
          {
            ...productionContext,
            origin: h.fake.origin,
            responseMs: 4000,
            sleep: async () => {
              await new Promise((resolve) => setTimeout(resolve, 30));
            },
          },
          () => {},
        ),
      ).rejects.toMatchObject({
        code: 'INSTAGRAM_SHAPE_CHANGED',
        token: 'post-structure',
      });
    } finally {
      await h.close();
    }
  },
  120000,
);
test.each(['scroll-late', 'not-shown'] as const)(
  'C10 IG-8 %s confirms through one exact list row and retains the check kind',
  async (variant) => {
    const h = await harness('success', 5);
    if (variant === 'scroll-late') h.fake.setPostVariant(0, 'scroll-late');
    else
      for (let index = 0; index < 5; index++)
        h.fake.setPostVariant(index, 'not-shown');
    try {
      const running = h.start(true);
      const count = 5;
      expect(await running, h.notices.join('')).toMatchObject({
        completed: count,
        steps: count,
        endReason: 'canary',
      });
      const saved = await h.store.read((tx) => records(tx.instagramContext));
      expect(saved).toHaveLength(count);
      for (const [index, record] of saved.entries())
        expect(record).toMatchObject({
          confirmedBy: variant === 'scroll-late' && index > 0 ? 'post' : 'list',
          comment: {
            id:
              variant === 'scroll-late' && index > 0
                ? (expect.any(String) as unknown)
                : null,
            createdAt:
              variant === 'scroll-late' && index > 0
                ? h.fixture.items[index]!.createdAt
                : null,
            expandClicks: variant === 'scroll-late' ? (index ? 0 : 10) : 2,
          },
          image: { status: 'stored' },
          screenshot: { status: 'stored' },
        });
      const run = (await h.store.browserJournal()).runs[0]!;
      expect(run).toMatchObject({ acceptedBy: 'automatic-check' });
      expect(run.canaryAcceptedAt).toBeTruthy();
      const report = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      expect(JSON.parse(report)).toMatchObject({
        confirmations: {
          post: variant === 'scroll-late' ? 4 : 0,
          list: variant === 'scroll-late' ? 1 : count,
        },
        steps: Array.from(
          { length: count },
          (_, index) =>
            expect.objectContaining({
              confirmedBy:
                variant === 'scroll-late' && index > 0 ? 'post' : 'list',
            }) as unknown,
        ),
      });
      for (const value of [
        IG_FIXTURE.code,
        IG_FIXTURE.postAt,
        ...Object.values(IG_FIXTURE.other),
        ...h.fixture.items.flatMap((item) => [
          item.text,
          item.account.handle!,
          item.reference.ownerHandle!,
        ]),
      ])
        expect(report).not.toContain(value);
    } finally {
      await h.close();
    }
  },
  240000,
);
test.each([
  ['list-cut', 'not-shown'],
  ['two-rows', 'not-shown'],
  ['owner', 'owner'],
  ['collaboration', 'owner'],
  ['owner-first-profile', 'owner'],
  ['time', 'time'],
  ['edited', 'text'],
  ['several', 'several'],
] as const)(
  'C10 IG-8 %s never confirms through the list and leaves no record',
  async (variant, code) => {
    const h = await harness(variant === 'two-rows' ? 'success' : variant);
    if (variant === 'two-rows')
      h.fake.setCandidates(0, ['not-shown', 'not-shown']);
    try {
      const running = h.start();
      await h.click('Start');
      await expect
        .poll(
          async () =>
            (await h.store.browserJournal()).attempts.filter(
              (attempt) => attempt.settles !== null,
            ).length,
          { timeout: 120000 },
        )
        .toBe(1);
      expect(
        (await h.store.read((tx) => records(tx.browserAttempts))).at(-1),
      ).toMatchObject({ state: 'unconfirmed', code });
      await h.click('Continue');
      expect(await running).toMatchObject({ completed: 0 });
      expect((await h.store.browserJournal()).attempts.at(-1)).toMatchObject({
        state: 'unconfirmed',
        code,
      });
      expect(await h.store.read((tx) => records(tx.instagramContext))).toEqual(
        [],
      );
    } finally {
      await h.close();
    }
  },
  180000,
);
test.each([
  ['no-json', 'CANARY_NO_SECOND_SOURCE'],
  ['different-owner', 'CANARY_MISMATCH'],
  ['different-time', 'CANARY_MISMATCH'],
  ['different-caption', 'CANARY_MISMATCH'],
  ['different-image', 'CANARY_MISMATCH'],
  ['image-large', 'CANARY_CHECK_FAILED'],
  ['shot-large', 'CANARY_CHECK_FAILED'],
] as const)(
  'C10 IG-8 list confirmation still refuses %s with %s and accepts nothing',
  async (variant, code) => {
    const h = await harness(variant, 5);
    for (let index = 0; index < 5; index++) h.fake.setPostHidden(index);
    if (variant === 'shot-large')
      h.setCapture(async (...args) => ({
        ...(await capturePost(...args)),
        screenshot: { file: null, bytes: null, status: 'too-large' },
      }));
    try {
      expect(await h.start(true)).toMatchObject({ code });
      expect(await h.store.read((tx) => records(tx.instagramContext))).toEqual(
        [],
      );
      expect(
        (await h.store.browserJournal()).runs[0]!.canaryAcceptedAt,
      ).toBeNull();
    } finally {
      await h.close();
    }
  },
  120000,
);
test('C8 IG-6 candidate owner mismatch then confirmation counts one comment and continues to five', async () => {
  const h = await harness('success', 17);
  h.fake.setCandidates(0, ['owner', 'success']);
  try {
    expect(await h.start(true), h.notices.join('')).toMatchObject({
      completed: 5,
      steps: 5,
      endReason: 'canary',
    });
    const journal = await h.store.browserJournal(),
      run = journal.runs[0]!,
      contexts = await h.store.read((tx) => records(tx.instagramContext));
    expect(run).toMatchObject({ pageOpens: 6, acceptedBy: 'automatic-check' });
    expect(run.canaryAcceptedAt).toBeTruthy();
    expect(journal.attempts.map((attempt) => attempt.state)).toEqual(
      Array.from({ length: 5 }, () => ['sending', 'confirmed']).flat(),
    );
    expect(
      journal.attempts
        .filter((attempt) => attempt.state === 'sending')
        .map((attempt) => attempt.itemId),
    ).toEqual(h.fixture.items.slice(0, 5).map((item) => item.id));
    expect(contexts).toHaveLength(5);
    expect(
      contexts.find((record) => record.itemId === h.fixture.items[0]!.id),
    ).toMatchObject({
      post: {
        code: IG_FIXTURE.candidateCodes[1],
        owner: h.fixture.items[0]!.reference.ownerHandle,
      },
    });
    const report = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(
      (JSON.parse(report) as { steps: { result: string }[] }).steps.map(
        (step) => step.result,
      ),
    ).toEqual(['owner', ...Array<string>(5).fill('confirmed')]);
    for (const value of [
      IG_FIXTURE.candidateCodes[0],
      ...Object.values(IG_FIXTURE.other),
      ...Object.values(IG_FIXTURE.postDecoys),
    ]) {
      expect(JSON.stringify(contexts)).not.toContain(value);
      expect(report).not.toContain(value);
      expect(JSON.stringify(run)).not.toContain(value);
    }
  } finally {
    await h.close();
  }
}, 180000);
test('C8 IG-6 candidate three final not-shown results skip one comment then confirm five', async () => {
  const h = await harness('success', 17);
  h.fake.setCandidates(0, ['not-shown', 'not-shown', 'not-shown']);
  try {
    expect(await h.start(true), h.notices.join('')).toMatchObject({
      completed: 5,
      steps: 6,
      endReason: 'canary',
    });
    const journal = await h.store.browserJournal(),
      run = journal.runs[0]!,
      contexts = await h.store.read((tx) => records(tx.instagramContext));
    expect(run).toMatchObject({ pageOpens: 8, acceptedBy: 'automatic-check' });
    expect(run.canaryAcceptedAt).toBeTruthy();
    expect(journal.attempts).toHaveLength(12);
    expect(journal.attempts[1]).toMatchObject({
      itemId: h.fixture.items[0]!.id,
      state: 'unconfirmed',
      code: 'not-shown',
    });
    expect(contexts.map((record) => record.itemId)).toEqual(
      h.fixture.items.slice(1, 6).map((item) => item.id),
    );
    expect(
      h.fake.requests.filter((request) => request.path.startsWith('/p/')),
    ).toHaveLength(8);
    const report = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(
      (JSON.parse(report) as { steps: { result: string }[] }).steps.map(
        (step) => step.result,
      ),
    ).toEqual([
      ...Array<string>(3).fill('not-shown'),
      ...Array<string>(5).fill('confirmed'),
    ]);
    for (const value of [
      ...IG_FIXTURE.candidateCodes,
      ...Object.values(IG_FIXTURE.other),
      ...Object.values(IG_FIXTURE.postDecoys),
    ]) {
      expect(JSON.stringify(contexts)).not.toContain(value);
      expect(report).not.toContain(value);
      expect(JSON.stringify(run)).not.toContain(value);
    }
  } finally {
    await h.close();
  }
}, 180000);
test('C9 IG-7 candidate final text result after three candidates skips to the next comment', async () => {
  const h = await harness('success', 17);
  h.fake.setCandidates(0, ['owner', 'not-shown', 'edited']);
  try {
    expect(await h.start(true), h.notices.join('')).toMatchObject({
      completed: 5,
      steps: 6,
      endReason: 'canary',
    });
    const journal = await h.store.browserJournal(),
      run = journal.runs[0]!;
    expect(run).toMatchObject({
      pageOpens: 8,
      acceptedBy: 'automatic-check',
      endReason: 'canary',
    });
    expect(run.canaryAcceptedAt).toBeTruthy();
    expect(journal.attempts).toHaveLength(12);
    expect(journal.attempts[1]).toMatchObject({
      itemId: h.fixture.items[0]!.id,
      state: 'unconfirmed',
      code: 'text',
    });
    expect(
      await h.store.read((tx) => records(tx.instagramContext)),
    ).toHaveLength(5);
    expect(
      h.fake.requests
        .filter((request) => request.path.startsWith('/p/'))
        .slice(0, 3)
        .map((request) => request.path),
    ).toEqual(IG_FIXTURE.candidateCodes.map((code) => `/p/${code}`));
    const report = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    expect(
      (JSON.parse(report) as { steps: { result: string }[] }).steps.map(
        (step) => step.result,
      ),
    ).toEqual([
      'owner',
      'not-shown',
      'text',
      ...Array<string>(5).fill('confirmed'),
    ]);
    for (const value of [
      ...IG_FIXTURE.candidateCodes,
      ...Object.values(IG_FIXTURE.other),
      ...Object.values(IG_FIXTURE.postDecoys),
    ]) {
      expect(report).not.toContain(value);
      expect(JSON.stringify(run)).not.toContain(value);
    }
    expect(h.notices.join('')).not.toContain('Stop detail:');
  } finally {
    await h.close();
  }
}, 180000);
test.each([5, 10])(
  'C10 IG-8 automatic skips %i text mismatches and unavailable posts before five confirmations',
  async (skipped) => {
    const h = await harness('success', 17);
    const failures: string[] = [];
    const originalOpen = driverHelpers.openCandidate;
    const originalLoad = driverHelpers.loadList;
    const open = vi
      .spyOn(driverHelpers, 'openCandidate')
      .mockImplementation(async (...args) => {
        try {
          return await originalOpen(...args);
        } catch (error) {
          failures.push(
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error),
          );
          throw error;
        }
      });
    const load = vi
      .spyOn(driverHelpers, 'loadList')
      .mockImplementation(async (...args) => {
        try {
          return await originalLoad(...args);
        } catch (error) {
          failures.push(
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error),
          );
          throw error;
        }
      });
    for (let index = 0; index < skipped; index++)
      h.fake.setPostVariant(index, index % 2 ? 'unavailable' : 'edited');
    try {
      const result = await h.start(true);
      const journal = await h.store.browserJournal(),
        run = journal.runs[0]!;
      const diagnostic = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      expect(
        result,
        failures.join('\n') + h.notices.join('') + '\n' + diagnostic,
      ).toMatchObject({
        completed: 5,
        steps: skipped + 5,
        endReason: 'canary',
      });
      expect(run).toMatchObject({
        acceptedBy: 'automatic-check',
        pageOpens: skipped + 5,
      });
      expect(run.canaryAcceptedAt).toBeTruthy();
      const sends = journal.attempts.filter(
        (attempt) => attempt.state === 'sending',
      );
      expect(sends.map((attempt) => attempt.itemId)).toEqual(
        h.fixture.items.slice(0, skipped + 5).map((item) => item.id),
      );
      expect(
        (await h.store.read((tx) => records(tx.browserAttempts))).filter(
          (attempt) => attempt.state === 'confirmed',
        ),
      ).toHaveLength(5);
      expect(
        (await h.store.read((tx) => records(tx.browserAttempts))).filter(
          (attempt) => attempt.state === 'unconfirmed',
        ),
      ).toHaveLength(Math.ceil(skipped / 2));
      expect(
        (await h.store.read((tx) => records(tx.browserAttempts))).filter(
          (attempt) => attempt.state === 'unavailable',
        ),
      ).toHaveLength(Math.floor(skipped / 2));
      expect(
        await h.store.read((tx) => records(tx.instagramContext)),
      ).toHaveLength(5);
      const after = await planContext(h.store, h.plan.accountKey);
      expect(after.excluded).toEqual({
        unconfirmed: Math.ceil(skipped / 2),
        unavailable: Math.floor(skipped / 2),
        'not-listed': 0,
      });
      expect(after.canary).toBe(false);
      const report = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      const audit = JSON.stringify(run);
      const stored = JSON.stringify(
        await h.store.read((tx) => records(tx.instagramContext)),
      );
      for (const value of [
        ...Object.values(IG_FIXTURE.other),
        ...Object.values(IG_FIXTURE.postDecoys),
      ]) {
        expect(report).not.toContain(value);
        expect(audit).not.toContain(value);
        expect(stored).not.toContain(value);
      }
      for (const item of h.fixture.items)
        expect(report).not.toContain(item.text);
      const steps = (
        JSON.parse(report) as { steps: { oldestWithinWeek?: boolean }[] }
      ).steps;
      expect(steps).toHaveLength(skipped + 5);
      expect(steps[0]).toHaveProperty('oldestWithinWeek');
      expect(
        steps.slice(1).every((step) => step.oldestWithinWeek === null),
      ).toBe(true);
    } finally {
      open.mockRestore();
      load.mockRestore();
      await h.close();
    }
  },
  180000,
);
test('C8 IG-6 fifteen tried with four confirmed refuses and never opens a sixteenth', async () => {
  const h = await harness('success', 17);
  h.fake.setCandidates(0, ['not-shown', 'not-shown', 'not-shown']);
  for (let index = 0; index < 11; index++)
    h.fake.setPostVariant(index, index % 2 ? 'unavailable' : 'edited');
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CANARY_CHECK_FAILED' });
    const journal = await h.store.browserJournal();
    expect(journal.runs[0]).toMatchObject({
      pageOpens: 17,
      canaryAcceptedAt: null,
      endReason: 'error',
      displayEndReason: 'CANARY_CHECK_FAILED',
    });
    expect(journal.runs[0]!.acceptedBy).toBeUndefined();
    expect(
      journal.attempts.filter((attempt) => attempt.state === 'sending'),
    ).toHaveLength(15);
    expect(
      (await h.store.read((tx) => records(tx.browserAttempts))).filter(
        (attempt) => attempt.state === 'confirmed',
      ),
    ).toHaveLength(4);
    expect(h.notices.join('')).toContain('Stop detail: canary-check');
  } finally {
    await h.close();
  }
}, 180000);
test.each([
  'owner',
  'time',
  'edited',
  'several',
  'no-row',
  'window-full',
] as const)(
  'C9 IG-7 second comment %s stays manual and automatic and manual canaries reach five confirmations',
  async (variant) => {
    for (const automatic of [true, false]) {
      const h = await harness('success', 16);
      h.fake.setPostVariant(0, 'unavailable');
      h.fake.setPostVariant(1, variant);
      if (variant === 'no-row' || variant === 'window-full')
        h.fake.beforeList(async () => {
          const sends = (await h.store.browserJournal()).attempts.filter(
            (attempt) => attempt.state === 'sending',
          );
          h.fake.setVariant(
            sends.at(-1)?.itemId === h.fixture.items[1]!.id
              ? variant
              : 'success',
          );
        });
      try {
        const running = h.start(automatic);
        if (!automatic) {
          await h.click('Start');
          for (let comment = 0; comment < 7; comment++)
            await h.click('Continue');
          await h.click('Matches');
        }
        expect(await running, h.notices.join('')).toMatchObject({
          completed: 5,
          steps: 7,
          endReason: 'canary',
        });
        const journal = await h.store.browserJournal();
        expect(journal.runs[0]).toMatchObject({
          pageOpens: 7,
        });
        expect(journal.runs[0]!.canaryAcceptedAt).toBeTruthy();
        expect(journal.attempts).toHaveLength(14);
        expect(journal.attempts[3]).toMatchObject({
          itemId: h.fixture.items[1]!.id,
          state: ['no-row', 'window-full'].includes(variant)
            ? 'not-listed'
            : 'unconfirmed',
          code: variant === 'edited' ? 'text' : variant,
        });
        expect(
          await h.store.read((tx) => records(tx.instagramContext)),
        ).toHaveLength(5);
        expect(
          await h.store.read((tx) =>
            tx.instagramContext.get(h.fixture.items[1]!.id),
          ),
        ).toBeUndefined();
      } finally {
        await h.close();
      }
    }
  },
  180000,
);
test.each([
  ['owner', true, false, true],
  ['collaboration', false, true, true],
  ['owner-first-profile', true, true, false],
] as const)(
  'C9 IG-7 owner report %s contains only the three sub-check booleans',
  async (variant, oneAccount, equalsExport, namesOwner) => {
    const h = await harness('success', 6);
    h.fake.setPostVariant(1, variant);
    try {
      const result = await h.start(true),
        run = (await h.store.browserJournal()).runs[0]!;
      const text = await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      );
      const report = JSON.parse(text) as { steps: Record<string, unknown>[] };
      expect(report.steps[1]).toMatchObject({
        result: 'owner',
        ownerLinksOneAccount: oneAccount,
        ownerEqualsExport: equalsExport,
        firstProfileNamesOwner: namesOwner,
      });
      for (const key of [
        'ownerLinksOneAccount',
        'ownerEqualsExport',
        'firstProfileNamesOwner',
      ]) {
        expect(typeof report.steps[1]![key]).toBe('boolean');
        expect(report.steps[0]).not.toHaveProperty(key);
      }
      expect(result, h.notices.join('')).toMatchObject({
        completed: 5,
        steps: 6,
        endReason: 'canary',
      });
      for (const value of [
        IG_FIXTURE.code,
        IG_FIXTURE.caption,
        IG_FIXTURE.captionLine,
        IG_FIXTURE.captionTag,
        IG_FIXTURE.postAt,
        IG_FIXTURE.commentId,
        ...Object.values(IG_FIXTURE.other),
        ...Object.values(IG_FIXTURE.postDecoys),
        ...h.fixture.items.flatMap((item) => [
          item.text,
          item.account.handle!,
          item.reference.ownerHandle!,
        ]),
      ])
        expect(text).not.toContain(value);
    } finally {
      await h.close();
    }
  },
  120000,
);
test('C8 IG-6 manual selection keeps Continue and Matches after skips and stops at five confirmations', async () => {
  const h = await harness('success', 17);
  h.fake.setPostVariant(0, 'edited');
  h.fake.setPostVariant(1, 'unavailable');
  try {
    const running = h.start();
    await h.click('Start');
    for (let count = 0; count < 7; count++) {
      const page = await h.local();
      await expect
        .poll(
          async () =>
            (await h.store.browserJournal()).attempts.filter(
              (attempt) => attempt.state !== 'sending',
            ).length,
          { timeout: 30000 },
        )
        .toBe(count + 1);
      expect(
        await page
          .getByRole('button', { name: 'Matches', exact: true })
          .isVisible(),
      ).toBe(false);
      await h.click('Continue');
    }
    await h.click('Matches');
    expect(await running).toMatchObject({
      completed: 5,
      steps: 7,
      endReason: 'canary',
    });
    const journal = await h.store.browserJournal();
    expect(journal.runs[0]!.canaryAcceptedAt).toBeTruthy();
    expect(journal.runs[0]!.acceptedBy).toBeUndefined();
    expect(
      journal.attempts
        .filter((attempt) => attempt.state === 'sending')
        .map((attempt) => attempt.itemId),
    ).toEqual(h.fixture.items.slice(0, 7).map((item) => item.id));
  } finally {
    await h.close();
  }
}, 180000);
test.each([
  ['different-caption', 'CANARY_MISMATCH', 'field-mismatch'],
  ['no-json', 'CANARY_NO_SECOND_SOURCE', 'second-source'],
  ['challenge', 'PLATFORM_CHECK', 'challenge'],
  ['429', 'PLATFORM_CHECK', 'http-429'],
  ['mutation', 'UNEXPECTED_ACTION', 'unexpected-action'],
  ['de', 'PAGE_LANGUAGE', 'page-language'],
  ['account-mismatch', 'ACCOUNT_MISMATCH', 'account-changed'],
  ['extension', 'CANARY_CHECK_FAILED', 'extensions-added'],
] as const)(
  'C9 IG-7 skipped owner cannot hide the immediate %s stop',
  async (variant, code, token) => {
    const h = await harness('success', 7);
    h.fake.setPostVariant(0, 'owner');
    if (variant === 'different-caption' || variant === 'no-json')
      h.fake.setPostVariant(1, variant);
    else
      h.fake.beforeList(async () => {
        const sends = (await h.store.browserJournal()).attempts.filter(
          (attempt) => attempt.state === 'sending',
        );
        if (sends.at(-1)?.itemId !== h.fixture.items[1]!.id) return;
        if (variant === 'extension')
          await mkdir(
            join(h.profile, 'Default', 'Extensions', 'b'.repeat(32), '1'),
            { recursive: true },
          );
        else h.fake.setVariant(variant);
      });
    try {
      expect(await h.start(true), h.notices.join('')).toMatchObject({ code });
      const journal = await h.store.browserJournal(),
        run = journal.runs[0]!;
      expect(run.canaryAcceptedAt).toBeNull();
      expect(run.acceptedBy).toBeUndefined();
      expect(
        journal.attempts
          .filter((attempt) => attempt.state === 'sending')
          .map((attempt) => attempt.itemId),
      ).toEqual(h.fixture.items.slice(0, 2).map((item) => item.id));
      expect(journal.attempts).toHaveLength(4);
      expect(journal.attempts[1]).toMatchObject({
        state: 'unconfirmed',
        code: 'owner',
      });
      expect(journal.attempts[3]).toMatchObject({ state: 'failed', code });
      expect(await h.store.read((tx) => records(tx.instagramContext))).toEqual(
        [],
      );
      expect(h.notices.join('')).toContain(`Stop detail: ${token}`);
    } finally {
      await h.close();
    }
  },
  120000,
);
// C22: 68.92 s censored full-run maximum on C20, plus 30 s, rounded up.
test('C8 IG-6 manual limit below fifteen keeps its existing Continue and Matches boundary', async () => {
  const h = await harness('success', 17);
  h.setLimit(1);
  try {
    const running = h.start();
    await h.click('Start');
    await h.click('Continue');
    await h.click('Matches');
    expect(await running).toMatchObject({
      completed: 1,
      steps: 1,
      endReason: 'canary',
    });
    const journal = await h.store.browserJournal();
    expect(journal.attempts).toHaveLength(2);
    expect(journal.runs[0]!.canaryAcceptedAt).toBeTruthy();
  } finally {
    await h.close();
  }
}, 100000);
test('C8 cleanup 1 registers cleanup even when the test never enters a finally', async () => {
  cleanupLease = await harness();
  void cleanupLease.start();
  await cleanupLease.local();
});
test('C8 cleanup 2 verifies the preceding test released its browser and fixed fake port', async () => {
  const h = cleanupLease;
  expect(h).toBeDefined();
  try {
    expect(h!.fake.listening).toBe(false);
    expect(h!.context?.pages()).toEqual([]);
    const next = await fakeInstagram(CONTEXT_PORTS.instagram, h!.fixture.items);
    try {
      expect(next.listening).toBe(true);
    } finally {
      await next.close();
    }
  } finally {
    await h?.close();
    cleanupLease = undefined;
  }
});
test('C8 wheel is not a named click and refuses before any column click', async () => {
  const h = await filterHarness('scroll-first');
  try {
    await h.page.goto(`${h.fake.origin}/p/${IG_FIXTURE.code}`);
    await expect(
      clickAllowed(
        h.page,
        { kind: 'named', name: 'post-comments-wheel' } as unknown as Click,
        () => {},
      ),
    ).rejects.toMatchObject({
      code: 'UNEXPECTED_ACTION',
      token: 'unexpected-action',
    });
    expect(h.fake.events.flatMap((event) => event.clicks)).toEqual([]);
  } finally {
    await h.close();
  }
});
test('C8 scroll foundation confirms after one wheel and records action counts without fixture leaks', async () => {
  const h = await harness('scroll-first');
  try {
    const running = h.start();
    await h.click('Start');
    await h.click('Continue');
    await h.click('Matches');
    expect(await running).toMatchObject({
      completed: 1,
      steps: 1,
      endReason: 'canary',
    });
    const journal = await h.store.browserJournal();
    const run = journal.runs[0]!;
    expect(run.canaryAcceptedAt).toBeTruthy();
    expect(journal.attempts.map((attempt) => attempt.state)).toEqual([
      'sending',
      'confirmed',
    ]);
    const contexts = await h.store.read((tx) => records(tx.instagramContext));
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.comment.expandClicks).toBe(1);
    const report = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    const parsed = JSON.parse(report) as {
      steps: {
        expansionClicks: number;
        expansionScrolls: number;
        controls: string[];
      }[];
    };
    expect(parsed.steps[0]).toMatchObject({
      expansionClicks: 1,
      expansionScrolls: 1,
    });
    expect(parsed.steps[0]!.controls).toContain('post-comments-wheel');
    const stored = JSON.stringify({ journal, contexts });
    for (const value of [
      ...Object.values(IG_FIXTURE.other),
      ...Object.values(IG_FIXTURE.postDecoys),
    ]) {
      expect(stored).not.toContain(value);
      expect(report).not.toContain(value);
    }
    assertRecordedEvents(h.fake.events);
  } finally {
    await h.close();
  }
});
test('C8 harness closes its fake even when browser cleanup rejects and a repeated close cannot reopen it', async () => {
  const h = await harness();
  const running = h.start();
  await h.local();
  const actual = h.context!.close.bind(h.context!);
  const close = vi
    .spyOn(h.context!, 'close')
    .mockImplementationOnce(async () => {
      await actual();
      throw new Error('Generated close rejection');
    });
  try {
    await expect(h.close()).rejects.toThrow('Generated close rejection');
    await expect(h.close()).rejects.toThrow('Generated close rejection');
    expect(h.fake.listening).toBe(false);
    const next = await fakeInstagram(CONTEXT_PORTS.instagram, h.fixture.items);
    try {
      expect(next.listening).toBe(true);
    } finally {
      await next.close();
    }
    await running;
  } finally {
    close.mockRestore();
  }
});
for (const variant of [
  'year-rows',
  'year-word-rows',
  'empty-image-buttons',
  'year-empty-rows',
] as const) {
  // C22: only empty-image-buttons exhausted 60 s in the parent full gate;
  // 60 s censored maximum plus 30 s margin, other variants keep the default.
  test(
    `C4 ${variant} keeps the real row index and reads the account from a nonempty row`,
    async () => {
      const h = await harness(variant, 5);
      try {
        const result = await h.start(true),
          run = (await h.store.browserJournal()).runs[0]!;
        expect(result).toMatchObject({ completed: 5, endReason: 'canary' });
        expect(run.profileReport).toMatchObject({
          accountBefore: h.fixture.items[0]!.account.handle,
          accountAfter: h.fixture.items[0]!.account.handle,
        });
        expect(run.canaryAcceptedAt).toBeTruthy();
        const reportText = await readFile(
          join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
          'utf8',
        );
        const empty =
          variant === 'empty-image-buttons' || variant === 'year-empty-rows';
        expect(JSON.parse(reportText)).toMatchObject({
          rows: {
            emptySkipped: empty ? IG_FIXTURE.expected.emptyImageButtons * 5 : 0,
          },
          readback: { accountSame: true },
        });
        if (variant !== 'empty-image-buttons') {
          const report = JSON.parse(reportText) as {
            steps: { oldestWithinWeek: boolean }[];
          };
          expect(report.steps[0]).toMatchObject({ oldestWithinWeek: true });
        }
        expect(
          h.fake.requests.filter(
            (request) => request.path === `/p/${IG_FIXTURE.code}`,
          ),
        ).toHaveLength(1);
        expect(h.fake.events.flatMap((value) => value.clicks)).not.toContain(
          'Generated image decoration',
        );
        for (const value of Object.values(IG_FIXTURE.other))
          expect(reportText).not.toContain(value);
      } finally {
        await h.close();
      }
    },
    variant === 'empty-image-buttons' ? 90000 : undefined,
  );
}
test('C4 a nonempty row with unknown age suffix still stops at row-structure', async () => {
  const h = await harness('unknown-age');
  try {
    expect(await h.start(true)).toMatchObject({
      code: 'INSTAGRAM_SHAPE_CHANGED',
    });
    expect(h.notices.join('')).toContain('Stop detail: row-structure');
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(run.endedAt).toBeTruthy();
    expect(run.canaryAcceptedAt).toBeNull();
    expect(
      h.fake.requests.some((request) => request.path.startsWith('/p/')),
    ).toBe(false);
  } finally {
    await h.close();
  }
});
test('C3 restored launch tab POST is journaled before confirmation, then its page is closed and counted', async () => {
  const h = await harness();
  let restored: Page | undefined;
  h.afterLaunch(async () => {
    restored = await h.context!.newPage();
  });
  const originalGuard = networkHelpers.guardInstagramNetwork;
  const guardSpy = vi.spyOn(networkHelpers, 'guardInstagramNetwork');
  guardSpy.mockImplementation(async (...args) => {
    const guard = await originalGuard(...args);
    await h.context!.setOffline(false);
    await restored!.goto(h.fake.origin + '/restored');
    await restored!.locator('body[data-ready]').waitFor({ state: 'attached' });
    return guard;
  });
  try {
    const result = h.start();
    await h.local();
    const runs = await h.store.browserJournal();
    expect(runs.runs).toHaveLength(1);
    expect(
      h.fake.requests.filter((request) => request.path === '/startup-read'),
    ).toHaveLength(1);
    const beforeStart = runs.runs[0]!;
    expect(beforeStart.pageOpens).toBe(0);
    const db = new DatabaseSync(join(h.directory, 'socialprune.sqlite'), {
      readOnly: true,
    });
    try {
      expect(
        db
          .prepare(
            'SELECT data FROM browser_requests WHERE run_id=? ORDER BY rowid',
          )
          .all(beforeStart.runId)
          .map(
            (row) =>
              (JSON.parse(String(row.data)) as { operation: string }).operation,
          ),
      ).toContain('RestoredCommentsQuery');
    } finally {
      db.close();
    }
    expect(restored!.isClosed()).toBe(true);
    await h.click('Start');
    await h.click('Continue');
    await h.click('Matches');
    expect(await result).toMatchObject({ completed: 1, endReason: 'canary' });
    const text = await readFile(
      join(
        h.directory,
        'context',
        'instagram',
        `canary-${beforeStart.runId}.json`,
      ),
      'utf8',
    );
    expect(JSON.parse(text)).toMatchObject({
      pages: { startupClosed: 2, unexpectedOpened: 0 },
    });
    expect(text).not.toContain('/restored');
  } finally {
    guardSpy.mockRestore();
    await h.close();
  }
});
test('C3 an extra page during the run is closed and stops before it reaches the fake platform', async () => {
  const h = await harness();
  let extra: Page | undefined;
  h.afterWait(async () => {
    if (!extra) {
      extra = await h.context!.newPage().catch(() => undefined);
      if (extra)
        await extra.goto(h.fake.origin + '/restored').catch(() => undefined);
    }
  });
  try {
    expect(await h.start(true)).toMatchObject({ code: 'PLATFORM_CHECK' });
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(run.endedAt).toBeTruthy();
    expect(run.canaryAcceptedAt).toBeNull();
    expect(h.notices.join('')).toContain('Stop detail: unexpected-page');
    expect(extra?.isClosed()).toBe(true);
    expect(
      h.fake.requests.some(
        (request) =>
          request.path === '/restored' || request.path === '/startup-read',
      ),
    ).toBe(false);
  } finally {
    await h.close();
  }
});
test('C3 a journal failure after the run row exists still stops with request-journal', async () => {
  const h = await harness();
  let runExisted = false;
  const journal = vi
    .spyOn(BrowserOutcomeWriter.prototype, 'request')
    .mockImplementation(async (runId) => {
      runExisted = Boolean(
        await h.store.read((tx) => tx.browserRuns.get(runId)),
      );
      throw new Error('Generated journal failure');
    });
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CONTEXT_FAILED' });
    expect(runExisted).toBe(true);
    expect(h.notices.join('')).toContain('Stop detail: request-journal');
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(run.endedAt).toBeTruthy();
    expect(run.canaryAcceptedAt).toBeNull();
  } finally {
    journal.mockRestore();
    await h.close();
  }
});
test('C3 a page opened while manual Start waits stops without any Start click', async () => {
  const h = await harness();
  try {
    const running = h.start();
    await h.local();
    const extra = await h.context!.newPage().catch(() => undefined);
    expect(await running).toMatchObject({ code: 'PLATFORM_CHECK' });
    expect(h.notices.join('')).toContain('Stop detail: unexpected-page');
    expect(extra?.isClosed()).toBe(true);
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(run.pageOpens).toBe(0);
    expect(run.endedAt).toBeTruthy();
  } finally {
    await h.close();
  }
});
test('C3 a launch failure closes its already-started journal and retains structure and profile read-back', async () => {
  const h = await harness();
  h.afterLaunch(() =>
    Promise.reject(new TypeError('Generated private launch failure')),
  );
  try {
    expect(await h.start(true)).toMatchObject({ code: 'CONTEXT_FAILED' });
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(run.endedAt).toBeTruthy();
    expect(run.endReason).toBe('error');
    expect(run.pageOpens).toBe(0);
    expect(
      JSON.parse(
        await readFile(
          join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
          'utf8',
        ),
      ),
    ).toMatchObject({ stop: { token: 'type-error' } });
    expect(
      (await readdir(h.profile)).some(
        (file) => file === `socialprune-readback-${run.runId}.json`,
      ),
    ).toBe(true);
    expect(h.notices.join('')).not.toContain(
      'Generated private launch failure',
    );
  } finally {
    await h.close();
  }
});
test.each(['429', 'signal'] as const)(
  'C3 restored %s response retains the platform stop before Start',
  async (kind) => {
    const h = await harness();
    let restored: Page | undefined;
    h.afterLaunch(async () => {
      restored = await h.context!.newPage();
    });
    const originalGuard = networkHelpers.guardInstagramNetwork,
      guardSpy = vi.spyOn(networkHelpers, 'guardInstagramNetwork');
    guardSpy.mockImplementation(async (...args) => {
      const guard = await originalGuard(...args);
      await h.context!.setOffline(false);
      await restored!.goto(h.fake.origin + `/restored?limit=${kind}`);
      await restored!
        .locator('body[data-ready]')
        .waitFor({ state: 'attached' });
      return guard;
    });
    try {
      expect(await h.start(true)).toMatchObject({ code: 'PLATFORM_CHECK' });
      expect(h.notices.join('')).toContain(
        `Stop detail: ${kind === '429' ? 'http-429' : 'rate-signal'}`,
      );
      const run = (await h.store.browserJournal()).runs[0]!;
      expect(run.pageOpens).toBe(0);
      expect(run.endedAt).toBeTruthy();
      expect(
        (await readdir(h.profile)).some(
          (file) => file === `socialprune-readback-${run.runId}.json`,
        ),
      ).toBe(true);
    } finally {
      guardSpy.mockRestore();
      await h.close();
    }
  },
);
test('C3 a Mutation POST from a restored page is aborted before Start with unexpected-action', async () => {
  const h = await harness();
  let restored: Page | undefined;
  h.afterLaunch(async () => {
    restored = await h.context!.newPage();
  });
  const originalGuard = networkHelpers.guardInstagramNetwork,
    guardSpy = vi.spyOn(networkHelpers, 'guardInstagramNetwork');
  guardSpy.mockImplementation(async (...args) => {
    const guard = await originalGuard(...args);
    await h.context!.setOffline(false);
    await restored!.goto(h.fake.origin + '/restored?mutation=1');
    await restored!.locator('body[data-ready]').waitFor({ state: 'attached' });
    return guard;
  });
  try {
    expect(await h.start(true)).toMatchObject({ code: 'UNEXPECTED_ACTION' });
    expect(
      h.fake.requests.some((request) => request.path === '/startup-read'),
    ).toBe(false);
    expect(h.notices.join('')).toContain('Stop detail: unexpected-action');
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(run.endedAt).toBeTruthy();
    expect(
      run.profileReport!.unexpectedRequests.some(
        (request) => request.operation === 'RestoredMutation',
      ),
    ).toBe(true);
  } finally {
    guardSpy.mockRestore();
    await h.close();
  }
});
test.each([false, true])(
  'C3 nine existing extension folders form the baseline and any actual removal refuses acceptance, added=%j',
  async (added) => {
    const h = await harness('success', 5);
    for (const letter of 'abcdefghi')
      await mkdir(
        join(h.profile, 'Default', 'Extensions', letter.repeat(32), '1'),
        { recursive: true },
      );
    let planted = false;
    if (added)
      h.afterWait(async () => {
        if (!planted) {
          planted = true;
          await mkdir(
            join(h.profile, 'Default', 'Extensions', 'j'.repeat(32), '1'),
            { recursive: true },
          );
        }
      });
    try {
      const result = await h.start(true),
        run = (await h.store.browserJournal()).runs[0]!;
      // Chromium can prune these generated empty extension folders while reading.
      // Read the fixture back independently rather than assuming it stayed put.
      const remaining = (
        await readdir(join(h.profile, 'Default', 'Extensions')).catch(() => [])
      ).filter((name) => /^[a-i]{32}$/.test(name)).length;
      if (added) {
        expect(result).toMatchObject({ code: 'CANARY_CHECK_FAILED' });
        expect(h.notices.join('')).toContain('Stop detail: extensions-added');
        expect(run.canaryAcceptedAt).toBeNull();
      } else {
        const structure = await readFile(
          join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
          'utf8',
        );
        const report = JSON.parse(structure) as {
          readback: { extensionsRemoved: number };
        };
        expect(report.readback.extensionsRemoved).toBe(9 - remaining);
        expect(
          await h.store.read((tx) => records(tx.instagramContext)),
        ).toHaveLength(5);
        if (remaining === 9) {
          expect(result, h.notices.join('') + '\n' + structure).toMatchObject({
            completed: 5,
            endReason: 'canary',
          });
          expect(run.canaryAcceptedAt).toBeTruthy();
        } else {
          expect(result).toMatchObject({ code: 'CANARY_CHECK_FAILED' });
          expect(run.canaryAcceptedAt).toBeNull();
          expect(run.acceptedBy).toBeUndefined();
        }
      }
      expect(run.profileReport).toMatchObject({
        extensionsBefore: 9,
        extensionsAfter: remaining + (added ? 1 : 0),
      });
    } finally {
      await h.close();
    }
  },
);
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
  const h = await harness('success', 5);
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
  const h = await harness('success', 5);
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
    const h = await harness(variant, 5);
    try {
      const result = await h.start(true),
        run = (await h.store.browserJournal()).runs[0]!;
      expect(run.endedAt).toBeTruthy();
      expect(result).toMatchObject({ completed: 5, endReason: 'canary' });
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
  const h = await harness('success', 5);
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
  const h = await harness('success', 5),
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
  const h = await harness('success', 5);
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
      ['Stop detail: page-language; retriesUsed=0; retries=[]\n'],
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
async function fullRunReady(
  h: Awaited<ReturnType<typeof harness>>,
  priorSteps = 0,
) {
  const item = h.fixture.items.at(-1)!,
    writer = new InstagramContextWriter(h.store),
    runId = 'generated-prior-canary';
  await writer.startRun({
    runId,
    accountKey: h.plan.accountKey,
    planHash: h.plan.hash,
    startedAt: '2026-10-14T12:00:00.000Z',
  });
  await writer.sending({
    runId,
    attemptId: 'generated-prior-confirmed',
    itemId: item.id,
    at: '2026-10-14T12:00:00.000Z',
  });
  await writer.confirm({
    confirmedBy: 'post',
    ownerCheck: 'matched-export',
    itemId: item.id,
    accountKey: h.plan.accountKey,
    post: {
      kind: 'p',
      code: 'Generated_prior',
      owner: item.reference.ownerHandle!,
      ownerCount: 1,
      caption: null,
      captionComplete: true,
      createdAt: null,
    },
    comment: { id: '99112233', createdAt: item.createdAt, expandClicks: 0 },
    image: { file: null, host: null, status: 'not-captured' },
    screenshot: { file: null, bytes: null, status: 'failed' },
    confirmedAt: '2026-10-14T12:00:00.000Z',
    runId,
    attemptId: 'generated-prior-confirmed',
  });
  const profileReport = {
    accountBefore: h.plan.handle,
    accountAfter: h.plan.handle,
    extensionsBefore: 0,
    extensionsAfter: 0,
    changedFiles: [],
    unexpectedRequests: [],
  };
  await writer.endRun({
    runId,
    endedAt: '2026-10-14T12:00:00.000Z',
    endReason: 'canary',
    bodyShapes: {},
    profileReport,
  });
  await writer.acceptCanary(runId, '2026-10-14T12:00:00.000Z');
  if (priorSteps) {
    await writer.startRun({
      runId: 'generated-prior-steps',
      accountKey: h.plan.accountKey,
      planHash: h.plan.hash,
      startedAt: IG_FIXTURE.now,
    });
    for (let step = 0; step < priorSteps; step++)
      await writer.step('generated-prior-steps', IG_FIXTURE.now);
    await writer.endRun({
      runId: 'generated-prior-steps',
      endedAt: IG_FIXTURE.now,
      endReason: 'done',
      bodyShapes: {},
      profileReport,
    });
  }
  await h.refresh();
}

test.each(['answer', 'dom', 'unknown'] as const)(
  'IG-LIKES %s stores only the exact confirmed comment count',
  async (mode) => {
    const h = await harness('success', 5);
    h.fake.likes(mode);
    try {
      expect(await h.start(true)).toMatchObject({ completed: 5 });
      const contexts = await h.store.read((tx) => records(tx.instagramContext));
      expect(contexts[0]!.likes).toEqual(
        mode === 'answer'
          ? { count: 23, source: 'answer' }
          : mode === 'dom'
            ? { count: 17, source: 'dom' }
            : { count: null, source: null },
      );
    } finally {
      await h.close();
    }
  },
);

test('IG-LIKES refresh reopens the confirmed post once and preserves the original confirmation', async () => {
  const h = await harness('success', 5);
  h.fake.likes('answer');
  try {
    await h.start(true);
    const prior = (
      await h.store.read((tx) => records(tx.instagramContext))
    )[0]!;
    // Generated version-10 record, never a production mutation entrypoint.
    const raw = new DatabaseSync(join(h.directory, 'socialprune.sqlite'));
    raw.exec('DROP TRIGGER instagram_context_no_update');
    raw
      .prepare(
        "UPDATE instagram_context SET data=json_remove(data,'$.likes') WHERE item_id=?",
      )
      .run(prior.itemId);
    raw.close();
    const before = (
      await h.store.read((tx) => records(tx.instagramContext))
    )[0]!;
    const plan = await planContext(
      h.store,
      prior.accountKey,
      new Set(),
      new Set(),
      true,
    );
    expect(plan.refreshLikes).toBe(true);
    expect(plan.rows).toHaveLength(1);
    expect(plan.hash).not.toBe(
      (await planContext(h.store, prior.accountKey)).hash,
    );
    // Harness runner options are injected from a generated plan below.
    const result = await h.start({ refreshLikes: true });
    expect(result).toMatchObject({ completed: 1, steps: 1 });
    expect(
      await h.store.read((tx) => tx.instagramContext.get(prior.itemId)),
    ).toEqual({ ...before, likes: { count: 23, source: 'answer' } });
    expect(
      (await planContext(h.store, prior.accountKey, new Set(), new Set(), true))
        .rows,
    ).toHaveLength(0);
  } finally {
    await h.close();
  }
});
test('P1 secondsPerStep 10 controls two full-run step starts and records the effective pace', async () => {
  const h = await harness('success', 3);
  await fullRunReady(h, 20);
  h.setPace({ secondsPerStep: 10, stepsPerDay: 600, batchPause: false });
  h.setLimit(600);
  h.setMaxSteps(600);
  const starts: number[] = [];
  h.fake.beforeList(async () => {
    const run = (await h.store.browserJournal()).runs.at(-1)!;
    starts.push(Date.parse(run.lastPageOpenedAt!));
  });
  try {
    expect(await h.start('no-canary')).toMatchObject({
      completed: 2,
      steps: 2,
      endReason: 'done',
    });
    expect(starts[1]! - starts[0]!).toBe(10000);
    expect(h.waits).not.toContain(900000);
    const run = (await h.store.browserJournal()).runs.at(-1)!;
    const report = JSON.parse(
      await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(report.pace).toMatchObject({
      secondsPerStep: 10,
      stepsPerDay: 600,
      batchPause: false,
    });
    expect(report.limits).toBeDefined();
  } finally {
    await h.close();
  }
});
test('P1 a 10-second order cannot accelerate a canary from its 30-second starts', async () => {
  const h = await harness('success', 5);
  h.setPace({ secondsPerStep: 10, stepsPerDay: 600, batchPause: false });
  const starts: number[] = [];
  h.fake.beforeList(async () => {
    starts.push(
      Date.parse(
        (await h.store.browserJournal()).runs.at(-1)!.lastPageOpenedAt!,
      ),
    );
  });
  try {
    expect(await h.start(true)).toMatchObject({
      completed: 5,
      endReason: 'canary',
    });
    expect(starts).toHaveLength(6);
    expect(starts[1]).toBe(starts[0]);
    expect(starts[2]! - starts[1]!).toBe(30000);
  } finally {
    await h.close();
  }
});
test('P1 the confirmation shows the effective pace before a manual Start', async () => {
  const h = await harness();
  try {
    const result = h.start();
    const page = await h.local();
    await expect
      .poll(() => page.locator('#profile').innerText(), { timeout: 15000 })
      .toContain('30 seconds between step starts');
    expect(await page.locator('#profile').innerText()).toContain(
      '200 steps per Instagram day',
    );
    await h.click('Stop');
    await result;
  } finally {
    await h.close();
  }
});
test('P1 stepsPerDay uses the Instagram remainder instead of the old 200-step cap', async () => {
  const h = await harness('success', 3);
  await fullRunReady(h, 2);
  h.setPace({ secondsPerStep: 10, stepsPerDay: 3, batchPause: false });
  h.setLimit(600);
  try {
    expect(await h.start('no-canary')).toMatchObject({
      completed: 1,
      steps: 1,
      endReason: 'daily-cap',
    });
    expect(
      h.fake.requests.filter(
        (request) => request.path === '/your_activity/interactions/comments',
      ),
    ).toHaveLength(1);
  } finally {
    await h.close();
  }
});
test('P1 absent pace fields retain 30 seconds, batch pause and the 200 daily ceiling', async () => {
  const h = await harness('success', 3);
  await fullRunReady(h, 199);
  try {
    expect(await h.start('no-canary')).toMatchObject({
      completed: 1,
      steps: 1,
      endReason: 'daily-cap',
    });
    const run = (await h.store.browserJournal()).runs.at(-1)!;
    const report = JSON.parse(
      await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      ),
    ) as Record<string, unknown>;
    expect(report.pace).toMatchObject({
      secondsPerStep: 30,
      stepsPerDay: 200,
      batchPause: true,
    });
  } finally {
    await h.close();
  }
});
test.each([
  ['side-429', 'http-429'],
  ['feedback-required', 'rate-signal'],
  ['please-wait', 'rate-signal'],
  ['checkpoint-required', 'rate-signal'],
  ['spam', 'rate-signal'],
] as const)(
  'P2 %s on a side answer stops without a second step or retry',
  async (variant, token) => {
    const h = await harness(variant);
    try {
      expect(await h.start(true)).toMatchObject({ code: 'PLATFORM_CHECK' });
      const run = (await h.store.browserJournal()).runs[0]!;
      expect(run.canaryAcceptedAt).toBeNull();
      expect(run.endedAt).toBeTruthy();
      expect(h.notices.join('')).toContain(`Stop detail: ${token}`);
      expect(h.waits).not.toContain(30000);
      expect(
        h.fake.requests.filter(
          (request) => request.path === '/api/v1/generated/read/',
        ),
      ).toHaveLength(1);
    } finally {
      await h.close();
    }
  },
);
test.each([
  ['side-429', 'http-429'],
  ['feedback-required', 'rate-signal'],
] as const)(
  'P2 %s also stops a full run before another step',
  async (variant, token) => {
    const h = await harness(variant, 3);
    await fullRunReady(h);
    h.setPace({ secondsPerStep: 10, stepsPerDay: 600 });
    try {
      expect(await h.start('no-canary')).toMatchObject({
        code: 'PLATFORM_CHECK',
      });
      const run = (await h.store.browserJournal()).runs.at(-1)!;
      expect(run.pageOpens).toBe(1);
      expect(run.endedAt).toBeTruthy();
      expect(h.notices.join('')).toContain(`Stop detail: ${token}`);
    } finally {
      await h.close();
    }
  },
);
test('P2 every full run reports closed response classes, readiness times and header names without their values', async () => {
  const h = await harness('signal-metrics', 2);
  await fullRunReady(h);
  try {
    expect(await h.start('no-canary')).toMatchObject({ completed: 1 });
    const run = (await h.store.browserJournal()).runs.at(-1)!;
    const reportText = await readFile(
      join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
      'utf8',
    );
    const report = JSON.parse(reportText) as {
      limits: {
        responses: {
          host: string;
          path: string;
          count: number;
          status4xx: Record<string, number>;
          status5xx: number;
        }[];
        ready: Record<
          string,
          { count: number; medianMs: number; maxMs: number }
        >;
        headerNames: string[];
      };
    };
    expect(report.limits.responses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'graphql', status4xx: { '403': 1 } }),
        expect.objectContaining({ path: 'api-v1-read', status5xx: 1 }),
      ]),
    );
    expect(report.limits.headerNames).toEqual([
      'retry-after',
      'x-ratelimit-remaining',
    ]);
    for (const kind of ['list', 'post']) {
      const timing = report.limits.ready[kind]!;
      expect(timing.count).toBe(1);
      expect(timing.medianMs).toBeGreaterThanOrEqual(0);
      expect(timing.maxMs).toBeGreaterThanOrEqual(timing.medianMs);
    }
    for (const value of [
      ...Object.values(IG_FIXTURE.other),
      IG_FIXTURE.code,
      h.plan.handle,
      'generated_secret',
      'private',
    ])
      expect(reportText).not.toContain(value);
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
    assertRecordedEvents(h.fake.events);
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
for (const variant of [
  'success',
  'hidden',
  'reel',
  'cut-caption',
  'same-owner-links',
  'empty-caption',
  'not-shown',
  'other-author',
] as const) {
  // C22: hidden exhausted 60 s in the parent gate; +30 s margin. The
  // same-machine C20/C21 successes were 23.68/26.02 s, not a new fixed wait.
  test(
    `automatic canary ${variant} compares every field with the page JSON, accepts once and never starts a full run`,
    async () => {
      const h = await harness(variant, 5);
      try {
        const result = await h.start(true);
        expect(result).toMatchObject({ completed: 5, endReason: 'canary' });
        const runs = await h.store.browserJournal();
        expect(runs.runs[0]).toMatchObject({ acceptedBy: 'automatic-check' });
        expect(runs.runs[0]?.canaryAcceptedAt).toBeTruthy();
        if (variant === 'hidden')
          expect(h.waits.filter((value) => value === 3000)).toHaveLength(15);
      } finally {
        await h.close();
      }
    },
    variant === 'hidden' ? 90000 : undefined,
  );
}
test.each([
  ['answer-ndjson', null, 'sequence', 'json', 2],
  ['answer-concatenated', null, 'sequence', 'json', 2],
  ['answer-javascript', null, 'single', 'javascript', 1],
  ['answer-disagreement', 'CANARY_MISMATCH', 'sequence', 'json', 2],
  ['answer-unparsable', 'CANARY_NO_SECOND_SOURCE', 'failed', 'json', 0],
] as const)(
  'C14 second-source %s retains every document and reports closed evidence',
  async (variant, code, mode, type, bodies) => {
    const h = await harness(variant, 5);
    try {
      const result = await h.start(true);
      expect(result, h.notices.join('')).toMatchObject(
        code ? { code } : { completed: 5, endReason: 'canary' },
      );
      const journal = await h.store.browserJournal();
      expect(Boolean(journal.runs[0]!.canaryAcceptedAt)).toBe(code === null);
      const reportText = await readFile(
        join(
          h.directory,
          'context',
          'instagram',
          `canary-${journal.runs[0]!.runId}.json`,
        ),
        'utf8',
      );
      const report = JSON.parse(reportText) as {
        steps: {
          secondSource: {
            contentTypes: Record<string, Record<string, number>>;
            objects: { fields: Record<string, boolean> }[];
          };
        }[];
      };
      expect(report.steps).toHaveLength(code ? 1 : 5);
      for (const step of report.steps) {
        expect(step.secondSource.contentTypes[type]).toMatchObject({
          responses: 1,
          bodies,
          [mode]: 1,
          responsesWithCode: 1,
        });
        if (mode === 'failed') expect(step.secondSource.objects).toEqual([]);
        else
          expect(step.secondSource.objects).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                fields: { owner: true, time: true, caption: true, image: true },
              }),
            ]),
          );
      }
      for (const value of [
        IG_FIXTURE.code,
        IG_FIXTURE.caption,
        IG_FIXTURE.postAt,
        IG_FIXTURE.commentId,
        ...Object.values(IG_FIXTURE.other),
        ...h.fixture.items.flatMap((item) => [
          item.text,
          item.account.handle!,
          item.reference.ownerHandle!,
          item.id,
        ]),
        h.fake.origin,
      ])
        expect(reportText).not.toContain(value);
      expect(
        h.fake.requests.filter((request) => request.path.startsWith('/ajax/')),
      ).toHaveLength(code ? 1 : 5);
      expect(
        h.fake.requests.filter((request) => request.path.startsWith('/media/')),
      ).toHaveLength(code ? 1 : 5);
      assertRecordedEvents(h.fake.events);
    } finally {
      await h.close();
    }
  },
  120000,
);
test.each([
  ['answer-probe8-crlf', false],
  ['answer-probe8-lf', false],
  ['answer-probe8-concatenated', false],
  ['answer-route-caption', false],
  ['answer-real-disagreement', true],
] as const)(
  'C15 framed second-source %s excludes parameters but never real disagreement',
  async (variant, disagrees) => {
    const h = await harness(variant, 5);
    try {
      const result = await h.start(true);
      expect(result, h.notices.join('')).toMatchObject(
        disagrees
          ? { code: 'CANARY_MISMATCH' }
          : { completed: 5, endReason: 'canary' },
      );
      const journal = await h.store.browserJournal();
      expect(Boolean(journal.runs[0]!.canaryAcceptedAt)).toBe(!disagrees);
      const reportText = await readFile(
        join(
          h.directory,
          'context',
          'instagram',
          `canary-${journal.runs[0]!.runId}.json`,
        ),
        'utf8',
      );
      const report = JSON.parse(reportText) as {
        steps: {
          secondSource: {
            skippedParameters: number;
            objectsCapped: boolean;
            contentTypes: { json: Record<string, number> };
            objects: { path: string; fields: Record<string, boolean> }[];
          };
          fields: Record<string, { found: boolean; agrees: boolean }>;
        }[];
      };
      expect(report.steps).toHaveLength(disagrees ? 1 : 5);
      for (const step of report.steps) {
        expect(step.secondSource.contentTypes.json).toMatchObject({
          responses: 1,
          sequence: 1,
          single: 0,
          failed: 0,
          bodies: IG_FIXTURE.expected.framedDocuments,
          bodiesWithCode:
            IG_FIXTURE.expected.framedCodeDocuments + (disagrees ? 1 : 0),
        });
        expect(step.secondSource.skippedParameters).toBe(
          IG_FIXTURE.expected.framedParameterObjects,
        );
        expect(step.secondSource.objectsCapped).toBe(false);
        expect(step.secondSource.objects).toHaveLength(disagrees ? 2 : 1);
        expect(step.secondSource.objects[0]).toMatchObject({
          path: '*.*.data.*.items[]',
          fields: { owner: true, time: true, caption: true, image: true },
        });
        expect(step.fields.caption).toMatchObject({
          found: true,
          agrees: !disagrees,
        });
      }
      for (const value of [
        IG_FIXTURE.code,
        IG_FIXTURE.caption,
        IG_FIXTURE.postAt,
        IG_FIXTURE.commentId,
        ...Object.values(IG_FIXTURE.other),
        ...h.fixture.items.flatMap((item) => [
          item.text,
          item.account.handle!,
          item.reference.ownerHandle!,
          item.id,
        ]),
        h.fake.origin,
      ])
        expect(reportText).not.toContain(value);
      assertRecordedEvents(h.fake.events);
      expect(
        h.fake.requests.filter((request) => request.path.startsWith('/media/')),
      ).toHaveLength(disagrees ? 1 : 5);
    } finally {
      await h.close();
    }
  },
  120000,
);
test.each([
  ['time', 'CANARY_CHECK_FAILED'],
  ['owner', 'CANARY_CHECK_FAILED'],
  ['collaboration', 'CANARY_CHECK_FAILED'],
  ['owner-first-profile', 'CANARY_CHECK_FAILED'],
  ['several', 'CANARY_CHECK_FAILED'],
  ['edited', 'CANARY_CHECK_FAILED'],
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
      ).toBeLessThanOrEqual(2);
      const attempts = await h.store.read((tx) => records(tx.browserAttempts));
      expect(
        attempts.filter((attempt) => attempt.state === 'sending'),
      ).toHaveLength(1);
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
  'C5 dropdown UTC window covers the filtered day at UTC%j',
  async (zone) => {
    const h = await harness();
    h.fake.setZone(zone);
    try {
      const running = h.start();
      await h.click('Start');
      await h.click('Continue');
      await h.click('Matches');
      expect(await running).toMatchObject({ completed: 1 });
      const files = await readdir(
        instagramContextDirectory(h.directory, IG_FIXTURE.code),
      );
      expect(files.sort()).toEqual(['image.png', 'shot.jpg']);
    } finally {
      await h.close();
    }
  },
);
test.each([14, -12])(
  'C5 UTC%j applies both offered dates and removes rows outside the three-day UTC window',
  async (zone) => {
    const fixture = await instagramFixture(3);
    fixture.items[0]!.createdAt = '2025-07-31T00:00:00.000Z';
    fixture.items[1]!.createdAt = '2025-07-28T00:00:00.000Z';
    fixture.items[2]!.createdAt = '2025-08-04T00:00:00.000Z';
    const fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items),
      browser = await chromium.launch({
        headless: true,
        chromiumSandbox: true,
      });
    fake.setZone(zone);
    const page = await browser.newPage();
    await page.route('**/*', (route) =>
      new URL(route.request().url()).origin === fake.origin
        ? route.continue()
        : route.abort(),
    );
    try {
      await page.goto(fake.origin + '/your_activity/interactions/comments');
      expect(await page.locator('#list [role="button"]').count()).toBe(3);
      await filterList(page, fixture.items[0]!.createdAt, () => {});
      expect(await page.locator('#list [role="button"]').count()).toBe(1);
      expect(await page.locator('#list').innerText()).toContain(
        fixture.items[0]!.text,
      );
      for (const item of fixture.items.slice(1))
        expect(await page.locator('#list').innerText()).not.toContain(
          item.text,
        );
      await expect
        .poll(
          () =>
            fake.events
              .at(-1)
              ?.choices.filter((event) => event.type === 'change').length,
        )
        .toBe(6);
      expect(
        fake.events
          .at(-1)!
          .choices.filter((event) => event.type === 'change')
          .map(({ side, unit, label }) => [side, unit, label]),
      ).toEqual([
        ['start', 'year', '2025'],
        ['start', 'month', 'July'],
        ['start', 'day', '30'],
        ['end', 'year', '2025'],
        ['end', 'month', 'August'],
        ['end', 'day', '1'],
      ]);
      assertRecordedEvents(fake.events);
    } finally {
      await browser.close();
      await fake.close();
    }
  },
);
test.each([
  ['time', 'time'],
  ['owner', 'owner'],
  ['collaboration', 'owner'],
  ['owner-first-profile', 'owner'],
  ['several', 'several'],
  ['edited', 'text'],
  ['other-author', 'not-shown'],
  ['not-shown', 'not-shown'],
  ['block-two-texts', 'not-shown'],
  ['block-wrong-depth', 'not-shown'],
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
      if (code === 'not-shown') await h.click('Matches');
      expect(await result).toMatchObject({
        completed: code === 'not-shown' ? 1 : 0,
        endReason: 'canary',
      });
      const attempts = await h.store.read((tx) => records(tx.browserAttempts));
      expect(attempts).toHaveLength(2);
      expect(attempts[1]!.code).toBe(code === 'not-shown' ? null : code);
      expect(attempts[1]!.state).toBe(
        variant === 'unavailable'
          ? 'unavailable'
          : variant === 'no-row' || variant === 'window-full'
            ? 'not-listed'
            : code === 'not-shown'
              ? 'confirmed'
              : 'unconfirmed',
      );
      const contexts = await h.store.read((tx) => records(tx.instagramContext));
      expect(contexts).toHaveLength(code === 'not-shown' ? 1 : 0);
      if (code === 'not-shown')
        expect(contexts[0]).toMatchObject({
          confirmedBy: 'list',
          comment: { id: null, createdAt: null },
        });
    } finally {
      await h.close();
    }
  },
  120000,
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
    const running = h.start();
    await h.click('Start');
    await h.click('Continue');
    await h.click('Matches');
    expect(await running).toMatchObject({ completed: 1, steps: 1 });
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
    const running = h.start();
    await h.click('Start');
    await h.click('Continue');
    await h.click('Matches');
    expect(await running).toMatchObject({ completed: 1 });
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
    const h = await harness('success', action === 'Does not match' ? 5 : 1);
    try {
      const result = h.start();
      await h.click('Start');
      if (action === 'Does not match') {
        for (let index = 0; index < 5; index++) await h.click('Continue');
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
test('a manual canary confirms its second candidate after a time mismatch and counts one comment', async () => {
  const h = await harness('second-candidate');
  try {
    const running = h.start();
    await h.click('Start');
    await h.click('Continue');
    await h.click('Matches');
    expect(await running).toMatchObject({ completed: 1, steps: 1 });
    const attempts = await h.store.read((tx) => records(tx.browserAttempts));
    expect(attempts.map((attempt) => attempt.state)).toEqual([
      'sending',
      'confirmed',
    ]);
    expect((await h.store.browserJournal()).runs[0]).toMatchObject({
      pageOpens: 2,
    });
    expect(
      h.fake.requests.filter(
        (request) => request.path === '/your_activity/interactions/comments',
      ),
    ).toHaveLength(3);
  } finally {
    await h.close();
  }
});
test('C9 IG-7 four candidate rows settle several and skip after at most three candidates', async () => {
  const h = await harness('four-candidates');
  try {
    const result = h.start();
    await h.click('Start');
    await h.click('Continue');
    expect(await result).toMatchObject({
      completed: 0,
      steps: 1,
      endReason: 'canary',
    });
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
    decoy.listen(CONTEXT_PORTS.foreign, '127.0.0.1', resolve);
  });
  const h = await harness('external');
  try {
    const running = h.start();
    await h.click('Start');
    await h.click('Continue');
    await h.click('Matches');
    expect(await running).toMatchObject({ completed: 1 });
    const run = (await h.store.read((tx) => records(tx.browserRuns)))[0]!;
    const report = JSON.parse(
      await readFile(
        join(h.directory, 'context', 'instagram', `canary-${run.runId}.json`),
        'utf8',
      ),
    ) as { abortedHosts: Record<string, number> };
    expect(
      h.fake.requests.filter(
        (request) => request.path === '/your_activity/interactions/comments',
      ),
    ).toHaveLength(2);
    // Each document plants one fetch and one WebSocket, including the probe reload.
    expect(report.abortedHosts[`127.0.0.1:${CONTEXT_PORTS.foreign}`]).toBe(4);
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
    fake = await fakeInstagram(CONTEXT_PORTS.instagram, fixture.items),
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
    CONTEXT_PORTS.confirmation,
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
      confirmedBy: 'post',
      ownerCheck: 'matched-export',
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
    server.listen(CONTEXT_PORTS.server, '127.0.0.1', resolve);
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
            batchPause: true,
          },
          sha256: 'b'.repeat(64),
        },
        signal: new AbortController().signal,
        now: () => new Date(X_FIXTURE.now),
        notice() {},
      },
      {
        origin: CONTEXT_ORIGINS.server,
        port: CONTEXT_PORTS.review,
        responseMs: 5000,
        intervalMs: 0,
        batch: 20,
        pauseMs: 0,
        media: productionMedia,
        syndication: new SyndicationClient({
          baseUrl: CONTEXT_ORIGINS.server,
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
// C22: 73.59 s censored full-run maximum on C20 plus 25 s, rounded up.
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
}, 100000);
