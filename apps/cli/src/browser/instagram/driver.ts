import { setTimeout as sleep } from 'node:timers/promises';
import type { BrowserContext, Page } from 'playwright-core';
import type { Item } from '@socialprune/core';
import {
  COMMENTS_PATH,
  INSTAGRAM_ORIGIN,
  productionPolicy,
} from './network.ts';
import type { NetworkPolicy } from './network.ts';
import {
  rows,
  readRows,
  relativeAgeMs,
  checkPage,
  clickAllowed,
  utcWindow,
  rowCandidate,
  postElement,
  readPost,
  confirmComment,
  currentImageSource,
} from './selectors.ts';
import type { PostProjection, ConfirmationResult } from './selectors.ts';
import type { RowReadCounts } from './selectors.ts';
import { ContextStop } from './report.ts';
import { CONTEXT_PACE } from './pace.ts';
import type { capturePost } from './capture.ts';
import type { ReadyKind } from './signals.ts';
import { chooseFilterDate } from './filter.ts';

export interface ContextDependencies {
  origin: string;
  port: number;
  responseMs: number;
  pace: {
    intervalMs: number;
    batch: number;
    pauseMs: number;
    scrollMs: number;
    expandMs: number;
  };
  policy: NetworkPolicy;
  launch(profile: string, executable: string): Promise<BrowserContext>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  capture?: typeof capturePost;
  navigated?(kind: ReadyKind, elapsedMs: number): void;
  close(context: BrowserContext, automatic: boolean): Promise<void>;
}
export const productionContext: ContextDependencies = {
  origin: INSTAGRAM_ORIGIN,
  port: 0,
  responseMs: 30000,
  pace: CONTEXT_PACE,
  policy: productionPolicy,
  async launch(profile, executablePath) {
    const { chromium } = await import('playwright-core');
    return chromium.launchPersistentContext(profile, {
      executablePath,
      headless: false,
      // Restored tabs must not contact a host before the runner attaches routes.
      offline: true,
      chromiumSandbox: true,
      args: ['--enable-automation'],
      serviceWorkers: 'block',
      ignoreDefaultArgs: ['--disable-infobars'],
    });
  },
  sleep: async (ms, signal) => {
    await sleep(ms, undefined, { signal });
  },
  async close(context, automatic) {
    if (automatic) await context.close();
    else if (context.pages().length)
      await new Promise<void>((resolve) =>
        context.once('close', () => resolve()),
      );
  },
};
export async function waitPage(
  page: Page,
  ready: () => Promise<boolean>,
  ms: number,
  token: 'list-timeout' | 'post-timeout',
  guard: () => void,
): Promise<void> {
  const deadline = performance.now() + ms;
  for (;;) {
    guard();
    await checkPage(page);
    if (await ready()) return;
    if (performance.now() >= deadline)
      throw new ContextStop('PLATFORM_CHECK', token);
    await sleep(Math.min(100, Math.max(0, deadline - performance.now())));
  }
}
export async function filterList(
  page: Page,
  at: string,
  guard: () => void,
): Promise<void> {
  await clickAllowed(page, { kind: 'named', name: 'Sort & filter' }, guard);
  await clickAllowed(page, { kind: 'named', name: 'Oldest to newest' }, guard);
  const dates = utcWindow(at);
  await chooseFilterDate(page, 'start', dates[0], guard);
  await chooseFilterDate(page, 'end', dates[1], guard);
  await clickAllowed(page, { kind: 'named', name: 'Apply' }, guard);
}
async function navigateList(
  page: Page,
  expected: string,
  deps: ContextDependencies,
  guard: () => void,
  rowCounts: RowReadCounts,
) {
  guard();
  const navigationStart = performance.now();
  try {
    await page.goto(deps.origin + COMMENTS_PATH, {
      waitUntil: 'domcontentloaded',
      timeout: deps.responseMs,
    });
  } catch {
    guard();
    throw new ContextStop('PLATFORM_CHECK', 'navigation');
  }
  await waitPage(
    page,
    async () => (await readRows(page, rowCounts)).length > 0,
    deps.responseMs,
    'list-timeout',
    guard,
  );
  deps.navigated?.('list', performance.now() - navigationStart);
  const accountRows = await readRows(page, rowCounts);
  if (
    accountRows.some(
      (row) => row.username.toLowerCase() !== expected.toLowerCase(),
    )
  )
    throw new ContextStop('ACCOUNT_MISMATCH', 'account-changed');
  return accountRows;
}
export async function loadList(
  page: Page,
  item: Item,
  expected: string,
  deps: ContextDependencies,
  guard: () => void,
  oldest = false,
  now = new Date(),
  rowCounts: RowReadCounts = { emptySkipped: 0 },
) {
  let accountRows = await navigateList(page, expected, deps, guard, rowCounts);
  let oldestWithinWeek: boolean | null = null;
  if (oldest) {
    await clickAllowed(page, { kind: 'named', name: 'Sort & filter' }, guard);
    await clickAllowed(
      page,
      { kind: 'named', name: 'Oldest to newest' },
      guard,
    );
    await clickAllowed(page, { kind: 'named', name: 'Apply' }, guard);
    const first = (await readRows(page, rowCounts))[0],
      age = first ? relativeAgeMs(first.age) : null;
    if (age !== null)
      oldestWithinWeek =
        Math.abs(now.getTime() - age - Date.parse(item.createdAt)) <= 604800000;
    // Applying the probe sort prevents another filter dialog until navigation.
    // This reload stays inside the same step; empty rows keep their maximum.
    accountRows = await navigateList(page, expected, deps, guard, rowCounts);
  }
  await filterList(page, item.createdAt, guard);
  let previous = JSON.stringify(await readRows(page, rowCounts)),
    scrollLoads = 0,
    full = false;
  for (let index = 0; index < 10; index++) {
    guard();
    const first = (await readRows(page, rowCounts))[0];
    const box = first
      ? await rows(page).nth(first.index).locator('xpath=..').boundingBox()
      : null;
    if (box)
      await page.mouse.move(
        Math.max(0, box.x + box.width / 2),
        Math.max(0, box.y + Math.min(box.height, 400) / 2),
      );
    await page.mouse.wheel(0, 700);
    await deps.sleep(deps.pace.scrollMs);
    guard();
    await checkPage(page);
    const current = JSON.stringify(await readRows(page, rowCounts));
    if (current === previous) {
      full = false;
      break;
    }
    scrollLoads++;
    full = index === 9;
    previous = current;
  }
  const entries = await readRows(page, rowCounts);
  if (
    entries.some((row) => row.username.toLowerCase() !== expected.toLowerCase())
  )
    throw new ContextStop('ACCOUNT_MISMATCH', 'account-changed');
  return {
    candidates: entries.filter((row) => rowCandidate(row.text, item.text)),
    account: entries[0]?.username ?? accountRows[0]!.username,
    rowCount: entries.length,
    emptySkipped: rowCounts.emptySkipped,
    scrollLoads,
    full,
    oldestWithinWeek,
  };
}
export async function openCandidate(
  page: Page,
  index: number,
  deps: ContextDependencies,
  guard: () => void,
): Promise<boolean> {
  const navigationStart = performance.now();
  await clickAllowed(page, { kind: 'row', index }, guard);
  await waitPage(
    page,
    async () =>
      (await postElement(page, deps.origin)) !== null ||
      (await page
        .getByText("Sorry, this page isn't available.", { exact: true })
        .count()) > 0,
    deps.responseMs,
    'post-timeout',
    guard,
  );
  deps.navigated?.('post', performance.now() - navigationStart);
  return (
    (await page
      .getByText("Sorry, this page isn't available.", { exact: true })
      .count()) === 0
  );
}
export async function confirmOnPost(
  page: Page,
  item: Item,
  handle: string,
  deps: ContextDependencies,
  guard: () => void,
): Promise<{
  post: PostProjection;
  result: ConfirmationResult;
  expandClicks: number;
  source: string | null;
}> {
  let post = await readPost(page, deps.origin),
    result = confirmComment(post, item, handle),
    expandClicks = 0;
  while (
    result.state !== 'confirmed' &&
    !['owner', 'time', 'several'].includes(result.code) &&
    expandClicks < 10
  ) {
    const load = page.getByRole('button', {
      name: 'Load more comments',
      exact: true,
    });
    const replies = page.getByRole('button', {
      name: 'View replies',
      exact: true,
    });
    const name = (await load.count())
      ? 'Load more comments'
      : (await replies.count())
        ? 'View replies'
        : null;
    if (!name) break;
    await deps.sleep(deps.pace.expandMs);
    guard();
    // Re-query each control, including when the page replaces its node after a click.
    await clickAllowed(page, { kind: 'named', name }, guard);
    expandClicks++;
    post = await readPost(page, deps.origin);
    result = confirmComment(post, item, handle);
  }
  return {
    post,
    result,
    expandClicks,
    source:
      result.state === 'confirmed' ? await currentImageSource(page) : null,
  };
}
