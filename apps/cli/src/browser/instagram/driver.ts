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
import type {
  AccountClass,
  ListTimeoutDiagnostic,
  NavigationFailure,
} from './report.ts';
import { observeListNavigation } from './nav-failure.ts';
import { FilteredListTimeout, RepeatedListResult } from './retry.ts';
import type { MediaArea } from './media-source.ts';
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
import {
  listProbeReader,
  boundedProbe,
  probeView,
  emptyProbeView,
  probeWait,
  ProbeTimeout,
} from './list-probe.ts';
import type { NewestProbe } from './report.ts';
import { applyNewestSort, emptySortDiagnostic } from './newest-sort.ts';
import { sortControlStructure } from './sort-structure.ts';
import { widenedFilterProbes } from './widened-probe.ts';

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
  /** HUMAN-1: random source for pointer paths and waits; tests inject one. */
  random?: () => number;
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
      throw new ContextStop(
        token === 'list-timeout' ? 'LIST_TIMEOUT' : 'PLATFORM_CHECK',
        token,
      );
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
    sortBefore?(): Promise<void>;
    sortAfter?(): Promise<void>;
  },
): Promise<void> {
  await clickAllowed(page, { kind: 'named', name: 'Sort & filter' }, guard);
  await evidence?.sortBefore?.();
  try {
    await clickAllowed(
      page,
      { kind: 'named', name: 'Oldest to newest' },
      guard,
    );
  } finally {
    await evidence?.sortAfter?.();
  }
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
  probePhase?: 'newest-navigation' | 'newest-reload' | 'wider-navigation',
) {
  guard();
  const navigationStart = performance.now();
  const checked = async () => {
    guard();
    await checkPage(page);
  };
  const wait = <T>(
    part: 'load' | 'rows' | 'account',
    action: () => Promise<T>,
  ) =>
    probePhase ? probeWait(`${probePhase}-${part}`, action, checked) : action();
  // NAV-DIAG-1: observe the document so a failure keeps its closed classes.
  const observed = observeListNavigation(page, deps.origin);
  try {
    await wait('load', () =>
      page.goto(deps.origin + COMMENTS_PATH, {
        waitUntil: 'domcontentloaded',
        timeout: deps.responseMs,
      }),
    );
  } catch (error) {
    if (
      error instanceof ProbeTimeout ||
      (probePhase && error instanceof ContextStop)
    )
      throw error;
    let failure: NavigationFailure | undefined;
    try {
      failure = observed.failure(error);
    } catch {
      failure = undefined;
    }
    guard();
    const stop = new ContextStop('PLATFORM_CHECK', 'navigation');
    if (failure) stop.navigationFailure = failure;
    throw stop;
  } finally {
    observed.dispose();
  }
  const deadline = performance.now() + deps.responseMs;
  await wait('rows', () =>
    waitPage(
      page,
      async () => (await readRows(page, rowCounts, expected)).length > 0,
      Math.max(0, deadline - performance.now()),
      'list-timeout',
      guard,
    ),
  );
  deps.navigated?.('list', performance.now() - navigationStart);
  const accountRows = await wait('account', () =>
    checkedAccountRows(
      page,
      expected,
      deadline,
      guard,
      rowCounts,
      navigationStart,
      deps.accountObserved,
    ),
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
          : new ContextStop('LIST_TIMEOUT', 'list-timeout');
    await sleep(Math.min(100, Math.max(0, deadline - performance.now())));
  }
}
async function readAccountRows(
  page: Page,
  expected: string,
  counts: RowReadCounts,
) {
  const entries = await readRows(page, counts, expected);
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
  if (diagnose) rowCounts.rowShapeHandle = expected;
  let oldestWithinWeek: boolean | null = null;
  let missingCandidate = false;
  let probeAllowed = false;
  // LIST-DIAG: the last account class seen while the filtered list was read.
  let filteredAccountClass: AccountClass | null = null;
  const observeFiltered = (value: AccountClass) => {
    filteredAccountClass = value;
    deps.accountObserved?.(value);
  };
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
      const before = await sortControlStructure(
        page,
        'Oldest to newest',
        guard,
      );
      try {
        await clickAllowed(
          page,
          { kind: 'named', name: 'Oldest to newest' },
          guard,
        );
      } finally {
        rowCounts.oldestSortStructure = {
          before,
          after: await sortControlStructure(page, 'Oldest to newest', guard),
        };
      }
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
      async sortBefore() {
        if (!rowCounts.oldestSortStructure) {
          const before = await sortControlStructure(
            page,
            'Oldest to newest',
            guard,
          );
          rowCounts.oldestSortStructure = { before, after: before };
        }
      },
      async sortAfter() {
        if (
          rowCounts.oldestSortStructure?.after ===
          rowCounts.oldestSortStructure?.before
        )
          rowCounts.oldestSortStructure!.after = await sortControlStructure(
            page,
            'Oldest to newest',
            guard,
          );
      },
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
      observeFiltered,
      true,
    );
    let previous = JSON.stringify(
        await readAccountRows(page, expected, rowCounts),
      ),
      scrollLoads = 0,
      full = false;
    for (let index = 0; index < (diagnose ? 0 : 10); index++) {
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
      throw new ContextStop('LIST_TIMEOUT', 'list-timeout');
    probeAllowed = true;
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
      manualReason: undefined as
        'list-image-only' | 'list-repeated' | undefined,
    };
  } catch (error) {
    if (error instanceof ContextStop && error.token === 'list-timeout') {
      probeAllowed = true;
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
      const filteredTimeout = error instanceof FilteredListTimeout;
      const firstCheck = listImageOnlyManual(rowCounts.listTimeout);
      // LIST-DIAG: closed values only; the decision below is unchanged.
      const decision: NonNullable<ListTimeoutDiagnostic['imageOnlyDecision']> =
        {
          filteredTimeout,
          initialAccountRow: Boolean(initialAccount),
          firstReadAccountClass: filteredAccountClass,
          firstCheck,
          secondRead: false,
          secondReadAccountClass: null,
          secondReadCandidates: null,
          secondCheck: null,
          domChangesSame: null,
          lastChangeSame: null,
          retainedResult: false,
          outcome: !filteredTimeout
            ? 'not-filtered'
            : !initialAccount
              ? 'no-initial-account-row'
              : 'first-check-failed',
        };
      rowCounts.listTimeout.imageOnlyDecision = decision;
      if (filteredTimeout && initialAccount && firstCheck) {
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
        const secondCheck = listImageOnlyManual(rowCounts.listTimeout),
          domChangesSame =
            rowCounts.listTimeout.dom.changes === firstDom.changes,
          lastChangeSame =
            rowCounts.listTimeout.dom.lastChangeAfterApplyMs ===
            firstDom.lastChangeAfterApplyMs;
        Object.assign(decision, {
          secondRead: true,
          secondReadAccountClass: classification,
          secondReadCandidates: candidates.length,
          secondCheck,
          domChangesSame,
          lastChangeSame,
          outcome:
            classification !== 'expected'
              ? 'second-read-account'
              : candidates.length !== 0
                ? 'second-read-candidate'
                : !secondCheck
                  ? 'second-check-failed'
                  : !domChangesSame || !lastChangeSame
                    ? 'dom-changed'
                    : 'list-image-only',
        });
        rowCounts.listTimeout.imageOnlyDecision = decision;
        guard();
        await checkPage(page);
        if (
          classification === 'expected' &&
          candidates.length === 0 &&
          secondCheck &&
          domChangesSame &&
          lastChangeSame
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
      ) {
        decision.retainedResult = true;
        // RETAIN-1: the run decides whether a main run re-reads the comment
        // once; for every other caller this is the same LIST_TIMEOUT stop.
        if (
          initialAccount &&
          filter.applied &&
          filter.readbackObserved &&
          filter.startMatches &&
          filter.endMatches
        )
          throw new RepeatedListResult(initialAccount);
        throw new ContextStop('LIST_TIMEOUT', 'list-timeout');
      }
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
    if (diagnose && filter.applied && probeAllowed) {
      const checked = async () => {
        guard();
        await checkPage(page);
        const classification = accountClass(
          expected,
          await outsideProfilePaths(page),
        );
        deps.accountObserved?.(classification);
        if (classification !== 'expected')
          throw new ContextStop('ACCOUNT_MISMATCH', 'account-changed');
      };
      const newest: NewestProbe = {
        sortReadback: false,
        settledReload: false,
        observationFailed: false,
        timeoutWait: null,
        view: emptyProbeView(),
        sort: emptySortDiagnostic(),
      };
      rowCounts.newestProbe = newest;
      const probeStarted = performance.now();
      let reader: Awaited<ReturnType<typeof listProbeReader>> | undefined;
      let widerAllowed = false;
      try {
        reader = await probeWait(
          'probe-attach',
          () =>
            listProbeReader(
              page,
              item.text,
              item.createdAt,
              expected,
              now.getTime(),
              guard,
            ),
          checked,
        );
        const active = reader;
        rowCounts.filteredProbe = await boundedProbe(
          () => active.read(),
          () => active.scroll(),
          () => active.settle(deps.pace.scrollMs),
          checked,
          () => active.settle(Math.min(1000, deps.pace.scrollMs)),
        );
        await navigateList(
          page,
          expected,
          deps,
          guard,
          rowCounts,
          'newest-navigation',
        );
        const sort = newest.sort!;
        const beforeSort = listFreshness();
        await beforeSort.beforeApply(page, utcWindow(item.createdAt));
        await applyNewestSort(page, guard, checked, sort);
        newest.sortReadback = sort.chosenReadback;
        const signature = await beforeSort.inspect(page);
        sort.listChangeObserved = signature.observed
          ? signature.sameAsBeforeApply === false
          : null;
        beforeSort.finish();
        sort.failedStep = 'reload';
        await navigateList(
          page,
          expected,
          deps,
          guard,
          rowCounts,
          'newest-reload',
        );
        sort.failedStep = 'settle';
        await probeWait(
          'newest-settle',
          () => active.settle(deps.pace.scrollMs),
          checked,
        );
        sort.failedStep = 'read';
        const reading = await probeWait(
          'newest-read',
          () => active.read(),
          checked,
        );
        newest.view = probeView(reading);
        if (sort.rowOrderRequired) {
          sort.rowOrder = reading.order;
          if (!reading.observed || !reading.order.proved) {
            sort.failedStep = 'readback';
            throw new ProbeTimeout('newest-apply');
          }
          sort.chosenReadback = true;
          sort.readback = 'row-order';
          newest.sortReadback = true;
          newest.view = probeView(reading);
        }
        newest.settledReload = true;
        newest.observationFailed =
          !newest.view.observed || !newest.sortReadback;
        sort.failedStep = newest.sortReadback ? 'none' : 'readback';
        widerAllowed = true;
      } catch (error) {
        if (!(error instanceof ProbeTimeout)) throw error;
        await checked();
        newest.observationFailed = true;
        newest.timeoutWait = error.wait;
        widerAllowed = true;
      } finally {
        newest.sort!.elapsedMs = Math.max(
          0,
          Math.round(performance.now() - probeStarted),
        );
        if (reader) {
          try {
            if (widerAllowed) {
              rowCounts.widenedProbes = [];
              await widenedFilterProbes(
                page,
                item.createdAt,
                guard,
                checked,
                () =>
                  navigateList(
                    page,
                    expected,
                    deps,
                    guard,
                    rowCounts,
                    'wider-navigation',
                  ),
                reader,
                deps.pace.scrollMs,
                rowCounts.widenedProbes,
              );
            }
          } finally {
            try {
              await probeWait('probe-close', () => reader!.close(), checked);
            } catch (error) {
              if (!(error instanceof ProbeTimeout)) throw error;
              newest.observationFailed = true;
              newest.timeoutWait ??= error.wait;
            }
          }
        }
      }
    }
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
  directAccount?: string,
): Promise<boolean> {
  guard();
  if (!directAccount || page.url() !== 'about:blank') await checkPage(page);
  const address = postReopenTarget(target, deps.origin);
  if (!address)
    throw new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure');
  const navigationStart = performance.now();
  await page.goto(address, {
    waitUntil: 'domcontentloaded',
    timeout: deps.responseMs,
  });
  const ready = await postReady(page, navigationStart, deps, guard);
  if (directAccount) {
    guard();
    await checkPage(page);
    const classification = accountClass(
      directAccount,
      await outsideProfilePaths(page),
    );
    deps.accountObserved?.(classification);
    if (classification !== 'expected')
      throw new ContextStop('ACCOUNT_MISMATCH', 'account-changed');
  }
  return ready;
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
  /** IMAGE-3: the media area; the source is chosen once responses are known. */
  media: MediaArea;
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
  const media = await currentImageSource(page);
  return {
    post,
    result,
    expandClicks,
    expansionScrolls,
    media,
    // Without response knowledge: the media image, never a poster or avatar.
    source: media.image?.source ?? null,
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
