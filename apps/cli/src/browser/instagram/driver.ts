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
  accountMatches,
  outsideProfilePaths,
  relativeAgeMs,
  checkPage,
  clickAllowed,
  utcWindow,
  rowCandidate,
  postElement,
  postAddress,
  readPost,
  confirmComment,
  currentImageSource,
  scrollPostComments,
  listTimeoutRows,
  filterWindowMatches,
  observeListDomChanges,
} from './selectors.ts';
import type { PostProjection, ConfirmationResult } from './selectors.ts';
import type { RowReadCounts } from './selectors.ts';
import {
  ContextStop,
  accountClass,
  ListTimeoutDiagnosticSchema,
} from './report.ts';
import type { AccountClass, ListTimeoutDiagnostic } from './report.ts';
import { FilteredListTimeout } from './retry.ts';
import { CONTEXT_PACE } from './pace.ts';
import type { capturePost } from './capture.ts';
import type { ReadyKind } from './signals.ts';
import { chooseFilterDate } from './filter.ts';
import { listImageOnlyManual } from './list-image-only.ts';
import { listFreshness } from './list-freshness.ts';
import type { ListFreshness } from './list-freshness.ts';
import { listRegions } from './list-regions.ts';
import { listNavigation } from './list-navigation.ts';
import { windowFacts } from './list-window.ts';
import { listRowDiagnostic } from './list-diagnostic.ts';

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
  accountObserved?(this: void, value: AccountClass): void;
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
  evidence?: {
    readback(value: Awaited<ReturnType<typeof filterWindowMatches>>): void;
    beforeApply(): Promise<void>;
    applied(): void;
  },
): Promise<void> {
  await clickAllowed(page, { kind: 'named', name: 'Sort & filter' }, guard);
  await clickAllowed(page, { kind: 'named', name: 'Oldest to newest' }, guard);
  const dates = utcWindow(at);
  await chooseFilterDate(page, 'start', dates[0], guard);
  await chooseFilterDate(page, 'end', dates[1], guard);
  if (evidence) {
    evidence.readback(await filterWindowMatches(page, dates));
    await evidence.beforeApply();
  }
  await clickAllowed(page, { kind: 'named', name: 'Apply' }, guard, () =>
    evidence?.applied(),
  );
}
async function listTimeoutDiagnostic(
  page: Page,
  filter: ListTimeoutDiagnostic['filter'],
  dom: Awaited<ReturnType<typeof observeListDomChanges>> | undefined,
  dispose = true,
): Promise<ListTimeoutDiagnostic> {
  const rows = await listTimeoutRows(page);
  if (dispose) await dom?.dispose();
  return ListTimeoutDiagnosticSchema.parse({
    ...rows,
    emptyStateClassKnown: false,
    emptyStatePresent: false,
    filter,
    dom: dom?.summary() ?? {
      observed: false,
      changes: 0,
      lastChangeAfterApplyMs: null,
      observedForMs: 0,
    },
    observationFailed:
      !rows.rowsObserved ||
      (!!dom && dom.failed) ||
      (filter.applied && !filter.readbackObserved),
  });
}
export async function navigateList(
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
  const deadline = performance.now() + deps.responseMs;
  await waitPage(
    page,
    async () => (await readRows(page, rowCounts)).length > 0,
    Math.max(0, deadline - performance.now()),
    'list-timeout',
    guard,
  );
  deps.navigated?.('list', performance.now() - navigationStart);
  const accountRows = await checkedAccountRows(
    page,
    expected,
    deadline,
    guard,
    rowCounts,
    navigationStart,
    deps.accountObserved,
  );
  return { entries: accountRows, navigationStart };
}
async function checkedAccountRows(
  page: Page,
  expected: string,
  deadline: number,
  guard: () => void,
  counts: RowReadCounts,
  navigationStart: number,
  observed: ContextDependencies['accountObserved'],
  filtered = false,
) {
  let hadRows = false;
  let reads = 0;
  for (;;) {
    guard();
    await checkPage(page);
    const readStarted = performance.now();
    reads++;
    const entries = await readAccountRows(page, expected, counts);
    hadRows ||= entries.length > 0;
    const paths = await outsideProfilePaths(page);
    const classification = accountClass(expected, paths);
    observed?.(classification);
    if (accountMatches(expected, paths, entries)) return entries;
    const checkedAt = performance.now();
    if (checkedAt >= deadline)
      throw hadRows
        ? new ContextStop('ACCOUNT_MISMATCH', 'account-changed', {
            profileLinkFound: classification === 'expected',
            outsidePathCount: paths.length,
            rows: entries.length,
            ownRows: entries.filter(
              (row) => row.username.toLowerCase() === expected.toLowerCase(),
            ).length,
            elapsedMs: Math.max(0, Math.round(checkedAt - navigationStart)),
            reads,
            lastReadAfterDeadline: readStarted >= deadline,
          })
        : filtered
          ? new FilteredListTimeout()
          : new ContextStop('PLATFORM_CHECK', 'list-timeout');
    await sleep(Math.min(100, Math.max(0, deadline - performance.now())));
  }
}
async function readAccountRows(
  page: Page,
  expected: string,
  counts: RowReadCounts,
) {
  const entries = await readRows(page, counts);
  counts.otherName = Math.max(
    counts.otherName,
    entries.filter(
      (row) => row.username.toLowerCase() !== expected.toLowerCase(),
    ).length,
  );
  return entries;
}
export async function loadList(
  page: Page,
  item: Item,
  expected: string,
  deps: ContextDependencies,
  guard: () => void,
  oldest = false,
  now = new Date(),
  rowCounts: RowReadCounts = { emptySkipped: 0, otherName: 0 },
  freshness: ListFreshness = listFreshness(),
  diagnosticBodies: readonly unknown[] = [],
  diagnose = false,
  diagnosticTimeZone = 'UTC',
) {
  const filter = {
    applied: false,
    readbackObserved: false,
    startMatches: false,
    endMatches: false,
  };
  let dom: Awaited<ReturnType<typeof observeListDomChanges>> | undefined;
  let initialAccount: string | undefined;
  let oldestWithinWeek: boolean | null = null;
  let missingCandidate = false;
  try {
    let navigation = await navigateList(page, expected, deps, guard, rowCounts);
    let accountRows = navigation.entries;
    initialAccount = accountRows.find(
      (row) => row.username.toLowerCase() === expected.toLowerCase(),
    )?.username;
    if (diagnose)
      rowCounts.windowDiagnostic = windowFacts(
        item.createdAt,
        diagnosticTimeZone,
      );
    if (oldest) {
      await clickAllowed(page, { kind: 'named', name: 'Sort & filter' }, guard);
      await clickAllowed(
        page,
        { kind: 'named', name: 'Oldest to newest' },
        guard,
      );
      await clickAllowed(page, { kind: 'named', name: 'Apply' }, guard);
      const first = (await readAccountRows(page, expected, rowCounts)).find(
          (row) => row.username.toLowerCase() === expected.toLowerCase(),
        ),
        age = first ? relativeAgeMs(first.age) : null;
      if (age !== null)
        oldestWithinWeek =
          Math.abs(now.getTime() - age - Date.parse(item.createdAt)) <=
          604800000;
      // Applying the probe sort prevents another filter dialog until navigation.
      // This reload stays inside the same step; empty rows keep their maximum.
      navigation = await navigateList(page, expected, deps, guard, rowCounts);
      accountRows = navigation.entries;
      if (diagnose) {
        rowCounts.unfilteredDiagnostic = await listNavigation(
          page,
          item.createdAt,
          expected,
        );
        rowCounts.unfilteredOldestSortApplied = true;
      }
    }
    if (diagnose && !rowCounts.unfilteredDiagnostic) {
      rowCounts.unfilteredDiagnostic = await listNavigation(
        page,
        item.createdAt,
        expected,
      );
      rowCounts.unfilteredOldestSortApplied = false;
    }
    await filterList(page, item.createdAt, guard, {
      readback(value) {
        Object.assign(filter, value);
      },
      async beforeApply() {
        await freshness.beforeApply(page, utcWindow(item.createdAt));
        dom = await observeListDomChanges(page);
      },
      applied() {
        filter.applied = true;
        dom?.applied();
      },
    });
    const filteredDeadline = performance.now() + deps.responseMs;
    if (diagnose) {
      rowCounts.initialDiagnostic = await listRowDiagnostic(
        page,
        item.text,
        item.createdAt,
        expected,
        diagnosticBodies,
      );
      const initialPage = rowCounts.initialDiagnostic.page;
      rowCounts.filterDialogClosedObserved = Boolean(
        initialPage?.observed && !initialPage.filterDialogPresent,
      );
      if (rowCounts.filterDialogClosedObserved) {
        rowCounts.dialogClosedDiagnostic = initialPage;
        rowCounts.afterDialogSameAsAfterApply = true;
      }
      // Passive observation within the existing response window, with all page
      // and run guards alive. A late lazy row is evidence, not a new retry.
      while (performance.now() < filteredDeadline) {
        guard();
        await checkPage(page);
        await sleep(
          Math.min(100, Math.max(0, filteredDeadline - performance.now())),
        );
      }
    }
    await checkedAccountRows(
      page,
      expected,
      filteredDeadline,
      guard,
      rowCounts,
      navigation.navigationStart,
      deps.accountObserved,
      true,
    );
    let previous = JSON.stringify(
        await readAccountRows(page, expected, rowCounts),
      ),
      scrollLoads = 0,
      full = false;
    for (let index = 0; index < 10; index++) {
      guard();
      const first = (await readAccountRows(page, expected, rowCounts))[0];
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
      const current = JSON.stringify(
        await readAccountRows(page, expected, rowCounts),
      );
      if (current === previous) {
        full = false;
        break;
      }
      scrollLoads++;
      full = index === 9;
      previous = current;
    }
    const entries = await checkedAccountRows(
      page,
      expected,
      filteredDeadline,
      guard,
      rowCounts,
      navigation.navigationStart,
      deps.accountObserved,
      true,
    );
    rowCounts.rowSignature = await freshness.inspect(page);
    rowCounts.regions = await listRegions(page, item.text, item.createdAt);
    const candidates = entries.filter(
      (row) =>
        row.username.toLowerCase() === expected.toLowerCase() &&
        rowCandidate(row.text, item.text),
    );
    missingCandidate = candidates.length === 0;
    // Success of the account read is not evidence that Apply refreshed its rows.
    // The same retained-result guard must also precede a no-row settlement.
    const signature = rowCounts.rowSignature;
    if (
      !candidates.length &&
      rowCounts.emptySkipped > 0 &&
      signature.observed &&
      (signature.sameAsBeforeApply === true ||
        (signature.sameAsPreviousStep === true &&
          signature.previousWindowDifferent === true))
    )
      throw new ContextStop('PLATFORM_CHECK', 'list-timeout');
    return {
      candidates,
      account:
        entries.find(
          (row) => row.username.toLowerCase() === expected.toLowerCase(),
        )?.username ??
        accountRows.find(
          (row) => row.username.toLowerCase() === expected.toLowerCase(),
        )!.username,
      rowCount: entries.length,
      emptySkipped: rowCounts.emptySkipped,
      otherName: rowCounts.otherName,
      scrollLoads,
      full,
      oldestWithinWeek,
      manualReason: undefined as 'list-image-only' | undefined,
    };
  } catch (error) {
    if (error instanceof ContextStop && error.token === 'list-timeout') {
      rowCounts.listTimeout = await listTimeoutDiagnostic(
        page,
        filter,
        dom,
        false,
      );
      rowCounts.rowSignature = await freshness.inspect(page);
      rowCounts.listTimeout.rowSignature = rowCounts.rowSignature;
      rowCounts.regions = await listRegions(page, item.text, item.createdAt);
      rowCounts.listTimeout.regions = rowCounts.regions;
      if (
        error instanceof FilteredListTimeout &&
        initialAccount &&
        listImageOnlyManual(rowCounts.listTimeout)
      ) {
        const firstDom = rowCounts.listTimeout.dom;
        guard();
        await checkPage(page);
        const paths = await outsideProfilePaths(page);
        const classification = accountClass(expected, paths);
        deps.accountObserved?.(classification);
        const current = await readAccountRows(page, expected, rowCounts);
        const candidates = current.filter(
          (row) =>
            row.username.toLowerCase() === expected.toLowerCase() &&
            rowCandidate(row.text, item.text),
        );
        rowCounts.listTimeout = await listTimeoutDiagnostic(page, filter, dom);
        rowCounts.rowSignature = await freshness.inspect(page);
        rowCounts.listTimeout.rowSignature = rowCounts.rowSignature;
        rowCounts.listTimeout.regions = rowCounts.regions;
        guard();
        await checkPage(page);
        if (
          classification === 'expected' &&
          candidates.length === 0 &&
          listImageOnlyManual(rowCounts.listTimeout) &&
          rowCounts.listTimeout.dom.changes === firstDom.changes &&
          rowCounts.listTimeout.dom.lastChangeAfterApplyMs ===
            firstDom.lastChangeAfterApplyMs
        )
          return {
            candidates,
            account: initialAccount,
            rowCount: current.length,
            emptySkipped: rowCounts.emptySkipped,
            otherName: rowCounts.otherName,
            scrollLoads: 0,
            full: false,
            oldestWithinWeek,
            manualReason: 'list-image-only' as const,
          };
      }
      await dom?.dispose();
      if (dom?.failed) rowCounts.listTimeout.observationFailed = true;
      // A positively repeated result is not a transient empty-list read. Do not
      // let a main-run reopen relabel that same result as a fresh same-window skip.
      const signature = rowCounts.rowSignature;
      if (
        error instanceof FilteredListTimeout &&
        signature?.observed &&
        (signature.sameAsBeforeApply === true ||
          (signature.sameAsPreviousStep === true &&
            signature.previousWindowDifferent === true))
      )
        throw new ContextStop('PLATFORM_CHECK', 'list-timeout');
    }
    throw error;
  } finally {
    if (diagnose && !rowCounts.unfilteredDiagnostic && !filter.applied) {
      rowCounts.unfilteredDiagnostic = await listNavigation(
        page,
        item.createdAt,
        expected,
      );
      rowCounts.unfilteredOldestSortApplied = false;
      rowCounts.windowDiagnostic = windowFacts(
        item.createdAt,
        diagnosticTimeZone,
      );
    }
    if (diagnose || missingCandidate || rowCounts.listTimeout)
      rowCounts.diagnostic = await listRowDiagnostic(
        page,
        item.text,
        item.createdAt,
        expected,
        diagnosticBodies,
      );
    const finalPage = rowCounts.diagnostic?.page;
    if (
      diagnose &&
      !rowCounts.filterDialogClosedObserved &&
      finalPage?.observed &&
      !finalPage.filterDialogPresent
    ) {
      rowCounts.filterDialogClosedObserved = true;
      rowCounts.dialogClosedDiagnostic = finalPage;
      rowCounts.afterDialogSameAsAfterApply =
        JSON.stringify(finalPage) ===
        JSON.stringify(rowCounts.initialDiagnostic?.page);
    }
    freshness.finish();
    await dom?.dispose();
  }
}
export async function openCandidate(
  page: Page,
  index: number,
  deps: ContextDependencies,
  guard: () => void,
): Promise<boolean> {
  const navigationStart = performance.now();
  await clickAllowed(page, { kind: 'row', index }, guard);
  return postReady(page, navigationStart, deps, guard);
}
export async function reopenCandidate(
  page: Page,
  target: string,
  deps: ContextDependencies,
  guard: () => void,
): Promise<boolean> {
  guard();
  await checkPage(page);
  const address = postReopenTarget(target, deps.origin);
  if (!address)
    throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure');
  const navigationStart = performance.now();
  await page.goto(address, {
    waitUntil: 'domcontentloaded',
    timeout: deps.responseMs,
  });
  return postReady(page, navigationStart, deps, guard);
}
/** The observed main-frame address may change without a document request. */
export function postReopenTarget(input: string, origin: string): string | null {
  const address = postAddress(input, origin);
  return address
    ? new URL(`/${address.kind}/${address.code}`, origin).href
    : null;
}
async function postReady(
  page: Page,
  navigationStart: number,
  deps: ContextDependencies,
  guard: () => void,
): Promise<boolean> {
  try {
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
  } catch (error) {
    if (error instanceof ContextStop && error.token === 'post-timeout')
      throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure');
    throw error;
  }
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
  expansionScrolls: number;
  source: string | null;
}> {
  let post = await settledPost(page, deps, guard),
    result = confirmComment(post, item, handle),
    expandClicks = 0,
    expansionScrolls = 0,
    emptyScrolls = 0;
  const { kind, code } = post;
  const blockCount = () =>
    post.element
      .locator(
        `xpath=.//a[time[@datetime] and (starts-with(@href,"/p/${post.code}/c/") or starts-with(@href,"/reel/${post.code}/c/"))]/ancestor::*[3]`,
      )
      .count();
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
    const previous = await blockCount();
    await deps.sleep(deps.pace.expandMs);
    guard();
    // Re-query each control, including when the page replaces its node after a click.
    if (name) {
      await clickAllowed(page, { kind: 'named', name }, guard);
      emptyScrolls = 0;
    } else {
      if (!(await scrollPostComments(page, deps.origin, guard))) break;
      expansionScrolls++;
      await deps.sleep(deps.pace.expandMs);
      guard();
      await checkPage(page);
    }
    expandClicks++;
    post = await settledPost(page, deps, guard);
    if (post.kind !== kind || post.code !== code)
      throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure');
    result = confirmComment(post, item, handle);
    if (!name) {
      emptyScrolls = (await blockCount()) > previous ? 0 : emptyScrolls + 1;
      if (emptyScrolls >= 2) break;
    }
  }
  return {
    post,
    result,
    expandClicks,
    expansionScrolls,
    source: await currentImageSource(page),
  };
}

/** A rendered own link can disappear while Instagram replaces the post. */
export async function settledPost(
  page: Page,
  deps: Pick<ContextDependencies, 'origin' | 'responseMs'>,
  guard: () => void,
): Promise<PostProjection> {
  const deadline = performance.now() + deps.responseMs;
  let foundAt: number | undefined;
  for (;;) {
    guard();
    await checkPage(page);
    try {
      if ((await postElement(page, deps.origin)) !== null) {
        const now = performance.now();
        if (foundAt !== undefined && now - foundAt >= 500)
          return await readPost(page, deps.origin);
        foundAt ??= now;
      } else foundAt = undefined;
    } catch (error) {
      if (
        !(error instanceof ContextStop && error.token === 'post-structure') &&
        !(error instanceof Error && error.name === 'TimeoutError')
      )
        throw error;
      foundAt = undefined;
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0)
      throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure');
    await sleep(
      Math.min(
        foundAt === undefined
          ? 500
          : Math.max(1, 500 - (performance.now() - foundAt)),
        remaining,
      ),
    );
  }
}
