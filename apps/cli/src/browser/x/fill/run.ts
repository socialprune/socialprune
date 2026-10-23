import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import type { Original, BrowserRun, BrowserRequest } from '@socialprune/core';
import { OriginalsFillWriter } from '@socialprune/core/workspace/store';
import { startConfirmation } from '../../confirmation.ts';
import {
  validateProfile,
  profileSnapshot,
  changedProfileFiles,
  extensionsChanged,
  writeExtensionReport,
} from '../../profile.ts';
import {
  profileWarning,
  EXTENSION_NOTICE,
  FILL_STEPS,
  START_STATUS,
  endText,
  endReason,
  fillMismatchNotice,
  FILL_RELOAD_NOTICE,
  fillWindowWaitNotice,
  fillPaceNotice,
} from '../../copy.ts';
import type { ReadbackOutcome } from '../../copy.ts';
import { xSelectors } from '../selectors.ts';
import { statusUrl, X_ORIGIN, X_ALLOWED_HOSTS } from '../driver.ts';
import { restrictOrigins } from '../../network.ts';
import { FillOrderSchema, orderPace, DEFAULT_FILL_PACE } from './order.ts';
import type { FillOrder } from './order.ts';
import {
  compareFocal,
  compareNotice,
  compareEmptyFocal,
  normalizedLength,
  expectedFocalMediaCounts,
  noticeAlignmentFromAnswer,
} from './compare.ts';
import type { CanaryComparison } from './compare.ts';
import { dateInZone } from '../../pace.ts';
import { SQLiteStore } from '../../../workspace/sqlite-store.ts';
import { CliError, platformCheckReason } from '../../../cli/errors.ts';
import type { PlatformCheckReason } from '../../../cli/errors.ts';
import { planFill, fillSummary } from './plan.ts';
import type { FillPlan } from './plan.ts';
import { isPostAnswer, unexpectedAction } from './read.ts';
import { extract } from './extract.ts';
import { mergeFillMedia } from './media.ts';
import { structureReport, errorStop, XResponseWindows } from './report.ts';
import type { StopDetails } from './report.ts';
import { SyndicationClient } from '../../../originals/syndication.ts';
import { storeOriginalMedia } from '../../../originals/store-media.ts';
import { cleanupParts, originalDirectory } from '../../../originals/media.ts';
import { productionMedia } from '../../../originals/video.ts';
import type { MediaDependencies } from '../../../originals/video.ts';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchRunBrowser, freshPlatformPage } from '../../launch.ts';
import type { WindowPlacement } from '../../launch.ts';
import { entryView } from '../../run-session.ts';
import type { RunSession } from '../../run-session.ts';
import { rateWindow } from '../../confirmation-state.ts';
import type { XRateWindow } from '@socialprune/core/workspace/desktop-protocol';

export interface FillOptions {
  session?: RunSession;
  windowPlacement?: WindowPlacement;
  order?: FillOrder;
  store: SQLiteStore;
  plan: FillPlan;
  profile: string;
  executablePath: string;
  list: string;
  workspace: string;
  signal: AbortSignal;
  limit: number;
  maxVideoBytes: number;
  maxRunBytes: number;
  include: ReadonlySet<string>;
  now(): Date;
  notice(text: string): void;
  lang?: 'en' | 'de';
  mediaNotice?: string;
}
export interface FillDependencies {
  origin: string;
  port: number;
  responseMs: number;
  intervalMs: number;
  batch: number;
  pauseMs: number;
  media: MediaDependencies;
  syndication: SyndicationClient;
  launch(
    profile: string,
    executablePath: string,
    placement?: WindowPlacement,
  ): Promise<BrowserContext>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  close(context: BrowserContext, automatic?: boolean): Promise<void>;
}
export const FILL_PACE = DEFAULT_FILL_PACE;
const production: FillDependencies = {
  origin: X_ORIGIN,
  port: 0,
  responseMs: 30000,
  intervalMs: FILL_PACE.intervalMs,
  batch: FILL_PACE.batch,
  pauseMs: FILL_PACE.pauseMs,
  media: productionMedia,
  syndication: new SyndicationClient(),
  launch: launchRunBrowser,
  sleep: async (ms, signal) => {
    await sleep(ms, undefined, { signal });
  },
  close: async (context, automatic) => {
    if (automatic) {
      await context.close();
      return;
    }
    if (context.pages().length)
      await new Promise<void>((resolve) =>
        context.once('close', () => resolve()),
      );
  },
};
async function pageAnswer(
  page: Page,
  id: string,
  deps: FillDependencies,
): Promise<{ body: unknown; state: 'present' | 'gone' | null }> {
  const response = page
    .waitForResponse(
      (value) =>
        isPostAnswer(
          {
            method: value.request().method(),
            url: value.url(),
            status: 200,
            contentType: 'application/json',
          },
          id,
          deps.origin,
        ),
      { timeout: deps.responseMs },
    )
    .catch(() => null);
  await page.goto(statusUrl(id, deps.origin), {
    waitUntil: 'domcontentloaded',
    timeout: deps.responseMs,
  });
  try {
    await xSelectors.rendered(
      page,
      page
        .getByTestId('SideNav_AccountSwitcher_Button')
        .or(page.getByTestId('error-detail')),
      Math.min(20_000, deps.responseMs),
    );
  } catch (caught) {
    if (
      caught instanceof CliError &&
      caught.code === 'PLATFORM_CHECK' &&
      caught.reason === 'render-timeout'
    ) {
      const received = await response;
      if (received && received.status() !== 200)
        throw new CliError(
          'PLATFORM_CHECK',
          undefined,
          undefined,
          'answer-status',
        );
      if (
        received &&
        !received.headers()['content-type']?.startsWith('application/json')
      )
        throw new CliError(
          'PLATFORM_CHECK',
          undefined,
          undefined,
          'answer-type',
        );
    }
    throw caught;
  }
  const answer = await response;
  if (answer && answer.status() !== 200)
    throw new CliError('PLATFORM_CHECK', undefined, undefined, 'answer-status');
  if (
    answer &&
    !answer.headers()['content-type']?.startsWith('application/json')
  )
    throw new CliError('PLATFORM_CHECK', undefined, undefined, 'answer-type');
  if (!answer) {
    let state: 'present' | 'gone';
    try {
      state = await xSelectors.state(page, id);
    } catch (caught) {
      if (
        caught instanceof CliError &&
        caught.code === 'PLATFORM_CHECK' &&
        !caught.reason
      )
        throw new CliError(
          'PLATFORM_CHECK',
          undefined,
          undefined,
          'gone-check',
        );
      throw caught;
    }
    if (state === 'gone') return { body: null, state };
    throw new CliError(
      'PLATFORM_CHECK',
      undefined,
      undefined,
      'answer-timeout',
    );
  }
  const length = answer.headers()['content-length'];
  if (length && Number(length) > 8 * 1024 ** 2)
    throw new CliError('SHAPE_CHANGED');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bytes = await Promise.race([
    answer.body(),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new CliError(
              'PLATFORM_CHECK',
              undefined,
              undefined,
              'body-timeout',
            ),
          ),
        deps.responseMs,
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  if (bytes.length > 8 * 1024 ** 2) throw new CliError('SHAPE_CHANGED');
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new CliError('SHAPE_CHANGED');
  }
  const classified = extract(body, id, { instruction: null });
  return {
    body,
    state:
      classified.kind === 'shape-changed'
        ? null
        : classified.kind === 'tombstone' || classified.kind === 'unavailable'
          ? 'gone'
          : await xSelectors.state(page, id, deps.responseMs),
  };
}
export async function runFillWithDependencies(
  options: FillOptions,
  deps: FillDependencies,
) {
  if (options.order) {
    const value = FillOrderSchema.safeParse(options.order.value);
    if (
      !value.success ||
      value.data.account.toLowerCase() !== options.plan.handle.toLowerCase() ||
      !/^[a-f0-9]{64}$/.test(options.order.sha256)
    )
      throw new CliError('ORDER_INVALID');
  }
  if (
    (await planFill(options.store, options.plan.accountKey, options.include))
      .hash !== options.plan.hash
  )
    throw new CliError('STALE_PLAN');
  await validateProfile(options.profile);
  const before = await profileSnapshot(options.profile);
  const effectivePace = orderPace(options.order);
  deps = {
    ...deps,
    intervalMs:
      options.order?.value.secondsPerPage === undefined
        ? deps.intervalMs
        : effectivePace.intervalMs,
    pauseMs: options.order?.value.batchPause === false ? 0 : deps.pauseMs,
  };
  const dayCap = effectivePace.perDay;
  const pageLimit =
    options.order?.value.maxPages ??
    (options.order?.value.pagesPerDay === undefined ? 200 : 300);
  const paceLine = fillPaceNotice(
    effectivePace.intervalMs / 1000,
    dayCap,
    effectivePace.pauseMs > 0,
    options.lang,
  );
  const summary = fillSummary(options.plan, options.lang, options.order),
    confirmation = await (
      options.session?.confirmation ??
      ((initial) => startConfirmation(initial, deps.port))
    )({
      phase: options.order ? 'running' : 'start',
      lang: options.lang ?? 'en',
      expectedHandle: options.plan.handle,
      warning: summary.warning,
      profileWarning:
        profileWarning(options.plan.handle, options.lang) +
        ' ' +
        FILL_STEPS[options.lang ?? 'en'] +
        ' ' +
        EXTENSION_NOTICE[options.lang ?? 'en'] +
        (options.mediaNotice ?? '') +
        ' ' +
        paceLine,
      planned: summary.planned,
      bulk: 0,
      estimateMs: summary.estimateMs,
      list: options.list,
      rows: options.plan.rows
        .slice(0, 20)
        .map(({ id, reasons, reference }) => ({ id, reasons, reference })),
      completed: 0,
      result: options.order
        ? options.lang === 'de'
          ? 'Auf deinen schriftlichen Auftrag gestartet. Die Stichprobe wird automatisch mit der Seite verglichen.'
          : 'Started on your written order. The sample is compared with the page automatically.'
        : START_STATUS[options.plan.canary ? 'fillCanary' : 'fill'][
            options.lang ?? 'en'
          ],
    });
  const writer = new OriginalsFillWriter(options.store),
    runId = crypto.randomUUID(),
    run: BrowserRun = {
      runId,
      platform: 'x',
      accountKey: options.plan.accountKey,
      mode: 'fill',
      planHash: options.plan.hash,
      startedAt: options.now().toISOString(),
      endedAt: null,
      endReason: null,
      bodyShapes: { ...options.plan.bodyShapes },
      profileReport: null,
      canaryAcceptedAt: null,
    };
  const lock = { instruction: run.bodyShapes['read-post']?.[0] ?? null },
    reports: unknown[] = [],
    requests: BrowserRequest[] = [];
  const pendingRequests = new Set<Promise<void>>();
  const canaryCounts: CanaryComparison[] = [];
  const gatedPosts = new Map<string, number>();
  const abortedHosts: Record<string, number> = {};
  let mismatchCount = 0;
  let reloadCount = 0;
  let opened = 0;
  let dailyUsed = 0;
  const reloaded = new Set<string>();
  const mismatch = async (
    comparison: CanaryComparison,
    position: number,
    afterReload = false,
  ) => {
    mismatchCount++;
    reports.push({ mismatch: { position, ...comparison } });
    options.notice(`Canary counts: ${JSON.stringify(canaryCounts)}\n`);
    if (options.plan.canary || afterReload || mismatchCount >= 3) {
      if (options.order)
        await options.store
          .browserOutcomeWriter()
          .recordCanaryMismatch(runId, canaryCounts);
      throw new CliError('CANARY_MISMATCH');
    }
    options.notice(fillMismatchNotice(mismatchCount, options.lang) + '\n');
  };
  let context: BrowserContext | undefined,
    page: Page | undefined,
    accountBefore: string | null = null,
    accountAfter: string | null = null,
    began = false,
    completed = 0,
    stop = false,
    action = false,
    error: unknown;
  let stopReason: PlatformCheckReason | undefined;
  let longWindow = false;
  let rateLimited = false;
  let projectionFailure: Error | undefined;
  const windows = new XResponseWindows(
    deps.origin === X_ORIGIN ? undefined : deps.origin,
  );
  const desktopWindows = new Map<string, XRateWindow>();
  let readback: ReadbackOutcome | undefined;
  let cancelWait: () => void = () => {};
  let rejectRateLimit: (error: CliError) => void = () => {};
  const rateLimitStop = new Promise<never>((_resolve, reject) => {
    rejectRateLimit = reject;
  });
  void rateLimitStop.catch(() => undefined);
  const cancelMedia = new AbortController();
  const mediaSignal = AbortSignal.any([options.signal, cancelMedia.signal]);
  const cancellation = new Promise<false>((resolve) => {
    cancelWait = () => resolve(false);
  });
  const stopped = () => {
    stop = true;
    cancelMedia.abort();
    cancelWait();
  };
  confirmation.onStop(stopped);
  options.signal.addEventListener('abort', stopped, { once: true });
  process.on('SIGINT', stopped);
  process.on('SIGTERM', stopped);
  const check = () => {
    if (stop || options.signal.aborted) throw new CliError('CANCELLED');
    if (action) throw new CliError('UNEXPECTED_ACTION');
    if (rateLimited)
      throw new CliError('PLATFORM_CHECK', undefined, undefined, 'http-429');
    if (projectionFailure) throw projectionFailure;
  };
  try {
    options.session?.before(before, null);
    options.notice(summary.warning + '\n');
    options.notice(paceLine + '\n');
    const started = options.order
      ? Promise.resolve(true)
      : confirmation.wait('start');
    context = await deps.launch(
      options.profile,
      options.executablePath,
      options.windowPlacement,
    );
    options.session?.browser(() => context!.close());
    const allowed =
      deps.origin === X_ORIGIN
        ? X_ALLOWED_HOSTS.map((host) => `https://${host}`)
        : [deps.origin];
    if (!options.session) allowed.push(new URL(confirmation.url).origin);
    await restrictOrigins(context, allowed, abortedHosts);
    context.on('response', (response) => {
      if (!windows.accepts(response.url())) return;
      if (response.status() === 429) {
        rateLimited = true;
        rejectRateLimit(
          new CliError('PLATFORM_CHECK', undefined, undefined, 'http-429'),
        );
        cancelMedia.abort();
        cancelWait();
      }
      windows.observe(
        response.url(),
        response.headers(),
        options.now().getTime(),
      );
      try {
        if (!options.session) return;
        const headers = response.headers();
        const limit = Number(headers['x-rate-limit-limit']),
          remaining = Number(headers['x-rate-limit-remaining']),
          reset = Number(headers['x-rate-limit-reset']);
        if (
          [limit, remaining, reset].every(Number.isSafeInteger) &&
          limit > 0 &&
          remaining >= 0 &&
          reset * 1000 >= options.now().getTime() - 86400000 &&
          reset * 1000 <= options.now().getTime() + 366 * 86400000
        ) {
          const operation =
            new URL(response.url()).pathname.match(
              /^\/i\/api\/graphql\/[^/]+\/([A-Za-z0-9_]{1,64})\/?$/,
            )?.[1] ??
            (new URL(response.url()).pathname.startsWith('/i/api/')
              ? 'api-other'
              : 'other');
          const window = rateWindow(operation, limit, remaining, reset * 1000);
          const key = `${window.operation}|${window.operationName ?? ''}`;
          desktopWindows.set(key, window);
          options.session?.update({ xWindows: [...desktopWindows.values()] });
        }
      } catch (projectionError) {
        projectionFailure ??=
          projectionError instanceof Error
            ? projectionError
            : new CliError('RUN_STOPPED');
      }
    });
    context.once('close', stopped);
    if (!options.session) {
      const local = context.pages()[0] ?? (await context.newPage());
      await local.goto(confirmation.launchUrl);
    }
    options.notice(`Confirmation: ${confirmation.url}\n`);
    if (!(await Promise.race([started, cancellation])))
      throw new CliError('CANCELLED');
    check();
    if (
      (await planFill(options.store, options.plan.accountKey, options.include))
        .hash !== options.plan.hash
    )
      throw new CliError('STALE_PLAN');
    await options.store
      .browserOutcomeWriter()
      .recover(options.plan.accountKey, run.startedAt);
    await writer.startRun({
      runId,
      accountKey: options.plan.accountKey,
      planHash: options.plan.hash,
      canary: options.plan.canary,
      startedAt: run.startedAt,
      ownerPid: process.pid,
    });
    began = true;
    if (options.order)
      await options.store
        .browserOutcomeWriter()
        .recordOrder(runId, options.order.sha256);
    if (extensionsChanged(before, await profileSnapshot(options.profile)))
      throw new CliError(
        'PLATFORM_CHECK',
        undefined,
        undefined,
        'extensions-changed',
      );
    const requestRecords = new WeakMap<object, BrowserRequest>();
    const persist = (value: BrowserRequest) => {
      const task = options.store.browserOutcomeWriter().request(runId, value);
      pendingRequests.add(task);
      void task.then(
        () => pendingRequests.delete(task),
        () => {
          action = true;
          pendingRequests.delete(task);
        },
      );
    };
    context.on('request', (request) => {
      const url = new URL(request.url());
      if (request.method() !== 'GET' && url.origin === deps.origin) {
        const record: BrowserRequest = {
          requestId: crypto.randomUUID(),
          method: request.method(),
          host: url.host,
          path: url.pathname,
          status: null,
        };
        requests.push(record);
        requestRecords.set(request, record);
        persist(record);
        if (unexpectedAction(request.method(), request.url(), deps.origin))
          action = true;
      }
    });
    context.on('response', (response) => {
      const record = requestRecords.get(response.request());
      if (record) persist({ ...record, status: response.status() });
    });
    page = options.session
      ? await freshPlatformPage(context)
      : await context.newPage();
    // /home is used once for the account check. Read-back uses the current page.
    await page.goto(deps.origin + '/home', { waitUntil: 'domcontentloaded' });
    accountBefore = await xSelectors.account(
      page,
      Math.min(20_000, deps.responseMs),
    );
    if (accountBefore.toLowerCase() !== options.plan.handle.toLowerCase())
      throw new CliError('ACCOUNT_MISMATCH');
    options.session?.before(before, accountBefore);
    const language = await page.locator('html').getAttribute('lang');
    let reloadNavigationPending = false;
    let deferredResumeCheck = false;
    const accountAndLanguage = async () => {
      if (
        (
          await xSelectors.account(page!, Math.min(20_000, deps.responseMs))
        ).toLowerCase() !== options.plan.handle.toLowerCase()
      )
        throw new CliError('ACCOUNT_MISMATCH');
      if ((await page!.locator('html').getAttribute('lang')) !== language)
        throw new CliError('PAGE_LANGUAGE');
    };
    const resumeChecks = async () => {
      check();
      if (extensionsChanged(before, await profileSnapshot(options.profile)))
        throw new CliError(
          'PLATFORM_CHECK',
          undefined,
          undefined,
          'extensions-changed',
        );
      if (reloadNavigationPending) {
        deferredResumeCheck = true;
        return;
      }
      await accountAndLanguage();
    };
    const controls = options.session?.controls;
    const boundaryWait = async (ms: number) => {
      if (controls)
        await controls.delay(
          ms,
          (duration, signal) => deps.sleep(duration, signal),
          resumeChecks,
          mediaSignal,
          (remaining, next) => options.session?.waiting(remaining, next),
        );
      else await deps.sleep(ms, mediaSignal);
    };
    check();
    await cleanupParts(options.workspace);
    const day = dateInZone(options.now(), 'Europe/Berlin');
    let used = 0,
      last = 0;
    const lastBatch: number[] = [];
    await options.store.read(async (tx) => {
      const accounts = new Set<string>();
      for await (const run of tx.browserRuns.iterate())
        if (run.accountKey === options.plan.accountKey) accounts.add(run.runId);
      const precise = new Set<string>();
      for await (const run of tx.browserRuns.iterate())
        if (
          run.accountKey === options.plan.accountKey &&
          run.pageOpens !== undefined
        ) {
          precise.add(run.runId);
          if (dateInZone(run.startedAt, 'Europe/Berlin') === day)
            used += run.pageOpens;
          if (run.lastPageOpenedAt)
            last = Math.max(last, Date.parse(run.lastPageOpenedAt));
        }
      for await (const attempt of tx.browserAttempts.iterate())
        if (
          accounts.has(attempt.runId) &&
          !precise.has(attempt.runId) &&
          (attempt.state === 'sending' ||
            attempt.action === 'verify' ||
            (attempt.state === 'not-found' && attempt.settles === null)) &&
          dateInZone(attempt.at, 'Europe/Berlin') === day
        ) {
          used++;
          last = Math.max(last, Date.parse(attempt.at));
        }
      for await (const attempt of tx.browserAttempts.iterate())
        if (
          accounts.has(attempt.runId) &&
          attempt.state === 'sending' &&
          dateInZone(attempt.at, 'Europe/Berlin') === day
        )
          lastBatch.push(Date.parse(attempt.at));
    });
    lastBatch.sort((a, b) => a - b);
    dailyUsed = used;
    const recent: number[] = [];
    for (const time of lastBatch) {
      if (recent.length && time - recent.at(-1)! >= deps.pauseMs)
        recent.length = 0;
      recent.push(time);
      if (recent.length > deps.batch) recent.shift();
    }
    const budget = {
      videoBytes: options.maxVideoBytes,
      runBytes: options.maxRunBytes,
      used: 0,
      lastStart: 0,
      failures: 0,
    };
    const own = new Set<string>();
    await options.store.read(async (tx) => {
      for await (const { item } of tx.items.iterate())
        if (
          item.platform === 'x' &&
          item.account.key === options.plan.accountKey
        )
          own.add(item.id.slice(2));
    });
    const first = options.plan.canary
      ? [
          ...new Set(
            ['unseen', 'long-text', 'media'].flatMap(
              (reason) =>
                options.plan.rows.find((row) =>
                  row.reasons.includes(
                    reason as 'unseen' | 'long-text' | 'media',
                  ),
                ) ?? [],
            ),
          ),
        ]
      : [];
    const candidates = [
      ...first,
      ...options.plan.rows.filter((row) => !first.includes(row)),
    ].slice(
      0,
      Math.min(
        options.limit,
        pageLimit,
        options.plan.canary ? 5 : options.limit,
      ),
    );
    let batch = recent.length;
    if (options.order)
      confirmation.update({
        result:
          options.lang === 'de'
            ? 'Kontoprüfung abgeschlossen. Die Seiten werden auf deinen schriftlichen Auftrag gelesen.'
            : 'Account check complete. Reading pages on your written order.',
      });
    for (
      let candidateIndex = 0;
      candidateIndex < candidates.length;
      candidateIndex++
    ) {
      const row = candidates[candidateIndex]!;
      const position = options.plan.rows.indexOf(row) + 1;
      check();
      const pausedBefore = controls?.pausedMs ?? 0;
      await controls?.checkpoint(resumeChecks, mediaSignal);
      last += (controls?.pausedMs ?? 0) - pausedBefore;
      const referenced = await options.store.read(async (tx) => {
        for await (const { item } of tx.items.iterate())
          if (
            item.account.key === options.plan.accountKey &&
            (item.reference.replyToId === row.id ||
              item.reference.quotedId === row.id)
          )
            return item;
        return undefined;
      });
      options.session?.entry(
        referenced ? entryView(referenced, 'read-post') : null,
      );
      if (opened >= pageLimit) break;
      if (extensionsChanged(before, await profileSnapshot(options.profile)))
        throw new CliError(
          'PLATFORM_CHECK',
          undefined,
          undefined,
          'extensions-changed',
        );
      const existing = await options.store.read((tx) =>
        tx.originals.get(row.id),
      );
      if (
        existing?.signedIn?.runId === runId &&
        existing.signedIn.status === 'read'
      )
        continue;
      if (
        used >= dayCap ||
        dateInZone(options.now(), 'Europe/Berlin') !== day
      ) {
        run.endReason = 'daily-cap';
        break;
      }
      if (batch >= deps.batch) {
        options.session?.update({
          phase: 'batch-pause',
          remainingMs: deps.pauseMs,
          until: new Date(options.now().getTime() + deps.pauseMs).toISOString(),
        });
        await Promise.race([
          boundaryWait(deps.pauseMs),
          cancellation,
          rateLimitStop,
        ]);
        options.session?.update({ phase: 'running' });
        batch = 0;
      }
      const delay = last + deps.intervalMs - options.now().getTime();
      if (delay > 0)
        await Promise.race([boundaryWait(delay), cancellation, rateLimitStop]);
      check();
      for (;;) {
        const window = windows.beforePage(options.now().getTime());
        if (window.kind === 'long') {
          longWindow = true;
          run.endReason = 'daily-cap';
          break;
        }
        if (window.kind === 'ready') break;
        options.notice(
          fillWindowWaitNotice(window.minutes, options.lang) + '\n',
        );
        options.session?.update({
          phase: 'rate-wait',
          remainingMs: window.ms,
          resetAt: new Date(
            options.now().getTime() + window.ms - 5000,
          ).toISOString(),
        });
        await Promise.race([
          boundaryWait(window.ms),
          cancellation,
          rateLimitStop,
        ]);
        options.session?.update({ phase: 'running' });
        check();
      }
      if (longWindow) break;
      if (dateInZone(options.now(), 'Europe/Berlin') !== day) {
        run.endReason = 'daily-cap';
        break;
      }
      if (extensionsChanged(before, await profileSnapshot(options.profile)))
        throw new CliError(
          'PLATFORM_CHECK',
          undefined,
          undefined,
          'extensions-changed',
        );
      await controls?.checkpoint(resumeChecks, mediaSignal);
      const attemptId = crypto.randomUUID();
      await writer.sending({
        attemptId,
        runId,
        originalId: row.id,
        at: options.now().toISOString(),
      });
      last = options.now().getTime();
      used++;
      dailyUsed = used;
      batch++;
      opened++;
      options.session?.progress(
        used,
        completed,
        (await options.store.browserJournal()).attempts.filter(
          (value) => value.runId === runId,
        ),
      );
      let pageAnswerCompleted = false;
      try {
        const answer = await Promise.race([
          pageAnswer(page, row.id, deps),
          rateLimitStop,
        ]);
        pageAnswerCompleted = true;
        reloadNavigationPending = false;
        if (deferredResumeCheck) {
          await accountAndLanguage();
          deferredResumeCheck = false;
        }
        if (extensionsChanged(before, await profileSnapshot(options.profile)))
          throw new CliError(
            'PLATFORM_CHECK',
            undefined,
            undefined,
            'extensions-changed',
          );
        check();
        const extracted =
          answer.body === null
            ? { kind: 'no-entry' as const }
            : extract(answer.body, row.id, lock);
        const gated = new Map(
          extracted.kind === 'read'
            ? extracted.gated.map(({ id, mediaItems }) => [id, mediaItems])
            : [],
        );
        for (const [id, mediaItems] of gated)
          gatedPosts.set(id, Math.max(gatedPosts.get(id) ?? 0, mediaItems));
        if (answer.body !== null)
          reports.push({
            ...structureReport(
              answer.body,
              extracted.kind === 'shape-changed'
                ? extracted.path
                : extracted.kind === 'no-entry' && answer.state !== 'gone'
                  ? 'no-entry'
                  : undefined,
            ),
            ...('emptyResults' in extracted && extracted.emptyResults
              ? { emptyResults: extracted.emptyResults }
              : {}),
            ...('noticeParents' in extracted && extracted.noticeParents
              ? { noticeParents: extracted.noticeParents }
              : {}),
            ...(gated.size
              ? {
                  gated: {
                    posts: gated.size,
                    mediaItems: [...gated.values()].reduce(
                      (sum, count) => sum + count,
                      0,
                    ),
                  },
                }
              : {}),
          });
        if (extracted.kind === 'shape-changed')
          throw new CliError('SHAPE_CHANGED');
        if (extracted.kind === 'no-entry' && answer.state !== 'gone')
          throw new CliError('SHAPE_CHANGED');
        let emptyComparison: CanaryComparison | undefined;
        if (
          extracted.kind === 'unavailable' &&
          'empty' in extracted &&
          extracted.empty
        ) {
          try {
            emptyComparison = await Promise.race([
              compareEmptyFocal(page, row.id),
              rateLimitStop,
            ]);
          } catch (caught) {
            if (caught instanceof CliError && caught.code === 'PLATFORM_CHECK')
              throw caught;
            emptyComparison = {
              stored: { textLength: 0, photos: 0, videos: 0 },
              shown: { textLength: 0, photos: 0, videos: 0 },
              matches: false,
            };
          }
          check();
          if (!emptyComparison.matches) {
            canaryCounts.push(emptyComparison);
            await mismatch(emptyComparison, position, reloaded.has(row.id));
            await writer.settle(
              {
                attemptId,
                state: 'failed',
                at: options.now().toISOString(),
                code: 'CANARY_MISMATCH',
              },
              [],
            );
            continue;
          }
        }
        run.bodyShapes['read-post'] = lock.instruction
          ? [lock.instruction]
          : [];
        const records: Original[] = [];
        const extractedIds = new Set<string>();
        let mediaFailure: unknown;
        if (extracted.kind === 'read') {
          for (const post of [
            extracted.post,
            ...extracted.above,
            ...extracted.quoted,
          ]) {
            if (own.has(post.id)) continue;
            if (extractedIds.has(post.id)) continue;
            extractedIds.add(post.id);
            const old = await options.store.read((tx) =>
              tx.originals.get(post.id),
            );
            if (
              post.id !== row.id &&
              old?.signedIn?.status === 'read' &&
              !options.include.has(post.id) &&
              !gated.has(post.id)
            )
              continue;
            const record: Original = {
              ...post,
              media: mergeFillMedia(
                post.media,
                old?.media ?? [],
                gated.has(post.id),
              ),
              signedInRecord: gated.has(post.id)
                ? { ...post.signedInRecord!, mediaDetails: [] }
                : post.signedInRecord,
              anonymous: old?.anonymous ?? null,
              raw: old?.raw ?? null,
              signedIn: {
                status: 'read',
                at: options.now().toISOString(),
                runId,
                attemptId,
                reason: null,
              },
              chainAbove: post.id === row.id ? extracted.chainAbove : null,
            };
            try {
              if (!gated.has(post.id))
                await storeOriginalMedia(
                  options.workspace,
                  record,
                  deps.syndication,
                  budget,
                  mediaSignal,
                  deps.media,
                );
            } catch (caught) {
              mediaFailure = caught;
            }
            records.push(record);
            if (mediaFailure) break;
          }
        } else {
          records.push({
            ...row.original,
            signedIn: {
              status:
                extracted.kind === 'no-entry' ? 'not-found' : extracted.kind,
              at: options.now().toISOString(),
              runId,
              attemptId,
              reason: extracted.kind === 'no-entry' ? null : extracted.reason,
            },
            signedInRecord: row.original.signedInRecord,
          });
        }
        await writer.settle(
          {
            attemptId,
            state:
              extracted.kind === 'read'
                ? 'read'
                : extracted.kind === 'no-entry'
                  ? 'not-found'
                  : extracted.kind,
            at: options.now().toISOString(),
            code: null,
          },
          records,
        );
        if (mediaFailure)
          throw mediaFailure instanceof Error
            ? mediaFailure
            : new CliError('MEDIA_FAILED');
        if (options.order) {
          const stored = await options.store.read((tx) =>
            tx.originals.get(row.id),
          );
          let comparison: CanaryComparison;
          try {
            if (!stored) throw new Error('Missing stored original');
            comparison =
              emptyComparison ??
              (extracted.kind === 'read'
                ? await Promise.race([
                    compareFocal(
                      page,
                      stored,
                      extracted.displayText,
                      extracted.displayLinks,
                      gated.has(row.id),
                      extracted.inlineQuote,
                      extracted.statusLinks,
                    ),
                    rateLimitStop,
                  ])
                : await Promise.race([
                    compareNotice(
                      page,
                      extracted.kind === 'no-entry'
                        ? 'not-found'
                        : extracted.kind,
                      extracted.kind === 'tombstone'
                        ? noticeAlignmentFromAnswer(answer.body, row.id)
                        : null,
                    ),
                    rateLimitStop,
                  ]));
          } catch (caught) {
            if (
              caught instanceof CliError &&
              ['PLATFORM_CHECK', 'UNEXPECTED_ACTION', 'CANCELLED'].includes(
                caught.code,
              )
            )
              throw caught;
            comparison = {
              stored: {
                textLength: normalizedLength(
                  extracted.kind === 'read' ? extracted.displayText : '',
                ),
                ...(extracted.kind === 'read'
                  ? expectedFocalMediaCounts(
                      stored?.media ?? [],
                      gated.has(row.id),
                    )
                  : { photos: 0, videos: 0 }),
              },
              shown: { textLength: 0, photos: 0, videos: 0 },
              matches: false,
            };
          }
          await xSelectors.check(page);
          check();
          canaryCounts.push(comparison);
          if (comparison.notices) reports.push({ notices: comparison.notices });
          if (!comparison.matches) {
            await mismatch(comparison, position, reloaded.has(row.id));
          }
        }
        completed++;
        options.session?.progress(
          used,
          completed,
          (await options.store.browserJournal()).attempts.filter(
            (value) => value.runId === runId,
          ),
        );
        if (options.plan.canary && !options.order) {
          confirmation.update({
            phase: 'canary',
            completed,
            result:
              options.lang === 'de'
                ? `Textlänge ${row.original.text?.length ?? 0} → ${records[0]?.text?.length ?? 0}. Medien: ${records[0]?.media.length ?? 0}, davon gespeichert: ${records[0]?.media.filter((media) => media.status === 'stored').length ?? 0}. Beiträge darüber: ${extracted.kind === 'read' ? extracted.above.length : 0}. ${lock.instruction ? 'Seitenstruktur erkannt.' : 'Kein Eintrag in der Antwort.'}`
                : `Text length ${row.original.text?.length ?? 0} -> ${records[0]?.text?.length ?? 0}. Media: ${JSON.stringify(records[0]?.media.map((media) => ({ kind: media.kind, status: media.status })) ?? [])}. Posts above: ${extracted.kind === 'read' ? extracted.above.length : 0}. Structure: ${lock.instruction ?? 'no entry'}`,
          });
          if (
            !(await Promise.race([
              confirmation.wait('continue'),
              cancellation,
              rateLimitStop,
            ]))
          )
            throw new CliError('CANCELLED');
        }
        if (
          budget.used >= budget.runBytes ||
          records.some((record) =>
            record.media.some((media) => media.status === 'run-cap'),
          )
        ) {
          run.endReason = 'size-cap';
          break;
        }
      } catch (caught) {
        let failedSettled = false;
        await writer
          .settle(
            {
              attemptId,
              state: 'failed',
              at: options.now().toISOString(),
              code: caught instanceof CliError ? caught.code : 'READ_FAILED',
            },
            [],
          )
          .then(
            () => {
              failedSettled = true;
            },
            () => undefined,
          );
        if (
          failedSettled &&
          !pageAnswerCompleted &&
          !options.plan.canary &&
          !reloaded.has(row.id) &&
          reloadCount < 3 &&
          caught instanceof CliError &&
          caught.code === 'PLATFORM_CHECK' &&
          caught.reason === 'render-timeout' &&
          opened < pageLimit
        ) {
          check();
          await xSelectors.check(page);
          if (extensionsChanged(before, await profileSnapshot(options.profile)))
            throw new CliError(
              'PLATFORM_CHECK',
              undefined,
              undefined,
              'extensions-changed',
            );
          reloaded.add(row.id);
          reloadCount++;
          reports.push({
            reload: {
              position,
              number: reloadCount,
              waitMs: 60000,
              reason: 'render-timeout',
            },
          });
          options.notice(FILL_RELOAD_NOTICE[options.lang ?? 'en'] + '\n');
          reloadNavigationPending = true;
          options.session?.update({
            phase: 'reload-wait',
            remainingMs: 60000,
            until: new Date(options.now().getTime() + 60000).toISOString(),
            reload: reloadCount,
          });
          await Promise.race([
            boundaryWait(60000),
            cancellation,
            rateLimitStop,
          ]);
          options.session?.update({ phase: 'running' });
          check();
          await xSelectors.check(page);
          candidates.splice(candidateIndex + 1, 0, row);
          continue;
        }
        throw caught;
      }
    }
    run.endReason ??= options.plan.canary && completed > 0 ? 'canary' : 'done';
  } catch (caught) {
    error =
      stop || options.signal.aborted
        ? new CliError('CANCELLED')
        : action
          ? new CliError('UNEXPECTED_ACTION')
          : rateLimited
            ? new CliError('PLATFORM_CHECK', undefined, undefined, 'http-429')
            : caught;
    if (error instanceof CliError && error.code === 'PLATFORM_CHECK')
      stopReason = platformCheckReason(error.reason) ?? 'unspecified';
    run.endReason =
      stop || options.signal.aborted
        ? 'stopped-by-person'
        : caught instanceof CliError && caught.code === 'SHAPE_CHANGED'
          ? 'shape-changed'
          : caught instanceof CliError && caught.code === 'CANCELLED'
            ? 'stopped-by-person'
            : caught instanceof CliError && caught.code === 'PLATFORM_CHECK'
              ? 'platform-check'
              : 'error';
  } finally {
    let reportPath: string | null = null;
    let reportAttempted = false;
    let stopRecorded = false;
    let stopDetails: StopDetails | undefined;
    let stopNoticed = false;
    const recordStop = () => {
      if (
        stopRecorded ||
        (!error &&
          run.endReason !== 'error' &&
          run.endReason !== 'platform-check')
      )
        return;
      stopDetails = errorStop(
        error ??
          (run.endReason === 'platform-check'
            ? new CliError('PLATFORM_CHECK')
            : undefined),
      );
      if (stopDetails.code === 'PLATFORM_CHECK')
        stopReason ??= stopDetails.reason ?? 'unspecified';
      reports.push({ stop: stopDetails });
      stopRecorded = true;
    };
    const writeReport = async () => {
      reportAttempted = true;
      try {
        const directory = await originalDirectory(
          options.workspace,
          options.plan.rows[0]?.id ?? '0',
          true,
        );
        const path = join(directory, '..', `canary-${runId}.json`);
        await writeFile(path, JSON.stringify(reports), {
          flag: reportPath ? 'w' : 'wx',
        });
        reportPath = path;
        options.notice(`Structure report: ${reportPath}\n`);
      } catch (caught) {
        error ??= caught;
        recordStop();
      }
    };
    const noticeStop = () => {
      if (stopDetails && !stopNoticed) {
        options.notice(
          `Stop detail: ${stopDetails.reason ?? stopDetails.code}\n`,
        );
        stopNoticed = true;
      }
    };
    if (gatedPosts.size) {
      const gated = {
        posts: gatedPosts.size,
        mediaItems: [...gatedPosts.values()].reduce(
          (sum, count) => sum + count,
          0,
        ),
      };
      reports.push({ gated });
      options.notice(`Gated media: ${JSON.stringify(gated)}\n`);
    }
    let windowSummary = windows.summary();
    const windowReport = { xWindows: windowSummary };
    if (windowSummary.length) reports.push(windowReport);
    if (longWindow)
      reports.push({ stop: { code: 'daily-cap', reason: 'x-window-long' } });
    recordStop();
    if (
      began &&
      (options.plan.canary ||
        run.endReason === 'shape-changed' ||
        run.endReason === 'platform-check' ||
        error ||
        run.endReason === 'error' ||
        gatedPosts.size ||
        mismatchCount > 0 ||
        reloadCount > 0 ||
        windowSummary.length > 0 ||
        longWindow)
    )
      await writeReport();
    if (began) {
      try {
        await Promise.all([...pendingRequests]);
        let matches = false;
        if (run.endReason === 'canary' && !error && !options.order) {
          confirmation.update({
            phase: 'match',
            result:
              options.lang === 'de'
                ? `Vergleiche die gespeicherten Ergebnisse mit der Seite. Strukturbericht: ${reportPath ?? 'nicht geschrieben'}`
                : `Compare the stored results with the page. Structure report: ${reportPath ?? 'not written'}`,
          });
          matches = await Promise.race([
            confirmation.wait('matches'),
            cancellation,
            rateLimitStop,
          ]);
        }
        readback = 'account-readback';
        let accountRead = false;
        try {
          accountAfter =
            page && !page.isClosed()
              ? await xSelectors.account(
                  page,
                  Math.min(20_000, deps.responseMs),
                )
              : null;
          accountRead = accountAfter !== null;
          if (!accountRead) readback = 'account-readback';
        } catch (caught) {
          accountAfter = null;
          error ??= caught;
          stopReason ??=
            caught instanceof CliError && caught.code === 'PLATFORM_CHECK'
              ? (platformCheckReason(caught.reason) ?? 'account-readback')
              : 'account-readback';
          readback =
            caught instanceof CliError && caught.reason === 'account-handle'
              ? 'account-handle'
              : 'account-readback';
          run.endReason = 'platform-check';
        }
        const after = await profileSnapshot(options.profile);
        const extensionIdsEqual =
          before.extensionIds.length === after.extensionIds.length &&
          before.extensionIds.every((id) => after.extensionIds.includes(id));
        readback = !extensionIdsEqual
          ? 'extensions-changed'
          : !accountRead
            ? readback
            : accountBefore !== accountAfter
              ? 'account-changed'
              : 'unchanged';
        run.profileReport = {
          accountBefore,
          accountAfter,
          extensionsBefore: before.extensions,
          extensionsAfter: after.extensions,
          changedFiles: changedProfileFiles(before, after),
          unexpectedRequests: requests,
        };
        if (
          extensionsChanged(before, after) ||
          accountBefore !== accountAfter
        ) {
          const reason = extensionsChanged(before, after)
            ? 'extensions-changed'
            : 'account-changed';
          error ??= new CliError(
            'PLATFORM_CHECK',
            undefined,
            undefined,
            reason,
          );
          stopReason ??= reason;
          run.endReason = 'platform-check';
        }
        if (rateLimited) {
          error ??= new CliError(
            'PLATFORM_CHECK',
            undefined,
            undefined,
            'http-429',
          );
          run.endReason = 'platform-check';
        }
        await writer.endRun({
          runId,
          endedAt: options.now().toISOString(),
          endReason: run.endReason ?? 'error',
          bodyShapes: run.bodyShapes,
          profileReport: run.profileReport,
        });
        if (options.order && run.endReason === 'canary' && !error) {
          await options.store
            .browserOutcomeWriter()
            .recordAutomaticAcceptance(
              runId,
              options.now().toISOString(),
              canaryCounts,
            );
        }
        const profileReport = await writeExtensionReport(
          options.profile,
          runId,
          before,
          after,
          run.profileReport,
          abortedHosts,
        );
        options.notice(
          `Extensions disabled for this run. Before: ${JSON.stringify(before.extensionIds)}; after: ${JSON.stringify(after.extensionIds)}. Profile report: ${profileReport}\n`,
        );
        if (matches && run.endReason === 'canary' && !error)
          await writer.acceptCanary(runId, options.now().toISOString());
        options.notice(`Read-back: ${JSON.stringify(run.profileReport)}\n`);
      } catch (caught) {
        error ??= caught;
        if (rateLimited) {
          error =
            stop || options.signal.aborted
              ? new CliError('CANCELLED')
              : new CliError(
                  'PLATFORM_CHECK',
                  undefined,
                  undefined,
                  'http-429',
                );
          run.endReason =
            stop || options.signal.aborted
              ? 'stopped-by-person'
              : 'platform-check';
          if (run.profileReport)
            await writer
              .endRun({
                runId,
                endedAt: options.now().toISOString(),
                endReason: run.endReason,
                bodyShapes: run.bodyShapes,
                profileReport: run.profileReport,
              })
              .catch(() => undefined);
        }
        if (!readback) readback = 'account-readback';
        if (
          run.endReason === 'done' ||
          run.endReason === 'canary' ||
          run.endReason === null
        )
          run.endReason = 'error';
      }
    }
    windowSummary = windows.summary();
    windowReport.xWindows = windowSummary;
    if (windowSummary.length && !reports.includes(windowReport))
      reports.push(windowReport);
    recordStop();
    if (stopDetails || (readback && readback !== 'unchanged'))
      reports.push({ readback: { outcome: readback ?? 'not-completed' } });
    if (
      began &&
      (options.plan.canary ||
        run.endReason === 'shape-changed' ||
        run.endReason === 'platform-check' ||
        error ||
        run.endReason === 'error' ||
        (readback && readback !== 'unchanged') ||
        gatedPosts.size ||
        mismatchCount > 0 ||
        reloadCount > 0 ||
        windowSummary.length > 0 ||
        longWindow) &&
      (!reportAttempted ||
        (reportPath &&
          (stopRecorded ||
            (readback && readback !== 'unchanged') ||
            windowSummary.length > 0)))
    )
      await writeReport();
    noticeStop();
    if (longWindow) options.notice('Stop detail: x-window-long\n');
    const finalText = options.order
      ? endText(endReason(run.endReason, error), options.lang, stopReason, {
          readback,
          canary: options.plan.canary,
          ...(longWindow ? { fillStop: 'x-window-long' } : {}),
        }).replace(
          options.lang === 'de'
            ? 'Schließe das X-Fenster, um den Lauf zu beenden.'
            : 'Close the X window to finish.',
          options.lang === 'de'
            ? 'Das Browserfenster wird automatisch geschlossen.'
            : 'The browser window closes automatically.',
        )
      : endText(endReason(run.endReason, error), options.lang, stopReason, {
          readback,
          canary: options.plan.canary,
          ...(longWindow ? { fillStop: 'x-window-long' } : {}),
        });
    try {
      confirmation.update({
        phase: 'ended',
        completed,
        result: finalText,
      });
      if (options.session) {
        const journal = await options.store.browserJournal();
        options.session.progress(
          dailyUsed,
          completed,
          journal.attempts.filter((value) => value.runId === runId),
        );
        options.session.finish(
          run,
          error,
          began
            ? await profileSnapshot(options.profile).catch(() => undefined)
            : undefined,
          longWindow ? 'x-window-long' : undefined,
        );
      }
      options.notice(finalText + '\n');
    } catch (projectionError) {
      error ??= projectionError;
      run.endReason = 'error';
      options.session?.failed(projectionError);
    } finally {
      if (options.order && context) {
        try {
          const origin = new URL(confirmation.url).origin;
          const statusPage = context
            .pages()
            .find(
              (value) =>
                !value.isClosed() && new URL(value.url()).origin === origin,
            );
          if (!statusPage) throw new Error('Confirmation page is not open.');
          await statusPage.bringToFront();
          await statusPage
            .getByText(finalText, { exact: true })
            .waitFor({ state: 'visible', timeout: 3000 });
        } catch {
          options.notice(
            options.lang === 'de'
              ? 'Die Statusseite konnte den Endzustand nicht anzeigen; das Browserfenster wird trotzdem geschlossen.\n'
              : 'The status page could not display the end state; the browser window will still close.\n',
          );
        }
      }
      try {
        if (context) await deps.close(context, Boolean(options.order));
      } catch (caught) {
        error ??= caught;
        const wasRecorded = stopRecorded;
        recordStop();
        if (!wasRecorded && stopRecorded)
          reports.push({ readback: { outcome: readback ?? 'not-completed' } });
        if (began) await writeReport();
        noticeStop();
      } finally {
        try {
          await confirmation.close();
        } catch (caught) {
          error ??= caught;
          const wasRecorded = stopRecorded;
          recordStop();
          if (!wasRecorded && stopRecorded)
            reports.push({
              readback: { outcome: readback ?? 'not-completed' },
            });
          if (began) await writeReport();
          noticeStop();
        } finally {
          options.signal.removeEventListener('abort', stopped);
          process.removeListener('SIGINT', stopped);
          process.removeListener('SIGTERM', stopped);
        }
      }
    }
  }
  if (error)
    throw error instanceof CliError ? error : new CliError('ORIGINALS_FAILED');
  return { completed, runId, endReason: run.endReason };
}
export function runFill(options: FillOptions) {
  return runFillWithDependencies(options, production);
}
