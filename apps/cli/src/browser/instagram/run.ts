import type { BrowserContext, Request } from 'playwright-core';
import type {
  BrowserRun,
  BrowserProfileReport,
  InstagramContext,
} from '@socialprune/core';
import { InstagramContextWriter } from '@socialprune/core/workspace/instagram-context-writer';
import { SQLiteStore } from '../../workspace/sqlite-store.ts';
import { CliError } from '../../cli/errors.ts';
import { startConfirmation } from '../confirmation.ts';
import {
  validateProfile,
  profileInUse,
  profileSnapshot,
  extensionsChanged,
  changedProfileFiles,
  writeExtensionReport,
} from '../profile.ts';
import type { ProfileSnapshot } from '../profile.ts';
import { profileWarning, EXTENSION_NOTICE } from '../copy.ts';
import { CONTEXT_STEPS, contextEnd } from './copy.ts';
import {
  planContext,
  contextSummary,
  canaryRows,
  ownerName,
  normalize,
} from './plan.ts';
import type { ContextPlan } from './plan.ts';
import { validateContextOrder } from './order.ts';
import type { ContextOrder } from './order.ts';
import {
  ContextStop,
  ContextStepReportSchema,
  stopDetails,
  stopDetailText,
  AccountReadbackSchema,
  accountClass,
  RuntimeReportSchema,
  PostRetriesSchema,
  errorClass,
  keyPaths,
  pairedCode,
  contextCause,
  ContextCauseSchema,
} from './report.ts';
import type {
  AccountClass,
  ContextCauseStage,
  RuntimeReport,
} from './report.ts';
import {
  productionContext,
  loadList,
  openCandidate,
  reopenCandidate,
  confirmOnPost,
} from './driver.ts';
import type { ContextDependencies } from './driver.ts';
import { pageAnswers, capturePost, writeStructure } from './capture.ts';
import {
  guardInstagramNetwork,
  observeContextRuntime,
  COMMENTS_PATH,
} from './network.ts';
import {
  instagramDailyCount,
  CONTEXT_PACE,
  contextPace,
  paceSummary,
  paceText,
} from './pace.ts';
import { LimitSignals } from './signals.ts';
import { dateInZone } from '../pace.ts';
import {
  automaticCanaryCheck,
  automaticReadbackCheck,
  compareSources,
  canaryAudit,
} from './canary.ts';
import type { CanaryCheck } from './canary.ts';
import {
  CLICK_NAMES,
  POST_SCROLL_ACTION,
  postAddress,
  checkPage,
  outsideProfilePaths,
} from './selectors.ts';
import { PostOpenRetries, POST_REOPEN_WAIT_MS } from './retry.ts';
import { setTimeout as retryPoll } from 'node:timers/promises';
import { contextPages } from './pages.ts';
import { launchRunBrowser } from '../launch.ts';
import type { WindowPlacement } from '../launch.ts';
import { entryView } from '../run-session.ts';
import type { RunSession } from '../run-session.ts';

export interface ContextOptions {
  session?: RunSession;
  windowPlacement?: WindowPlacement;
  store: SQLiteStore;
  plan: ContextPlan;
  workspace: string;
  profile: string;
  executablePath: string;
  list: string;
  include: ReadonlySet<string>;
  exclude?: ReadonlySet<string>;
  limit: number;
  order?: ContextOrder;
  signal: AbortSignal;
  lang: 'en' | 'de';
  now(): Date;
  notice(text: string): void;
}
export async function runContextWithDependencies(
  options: ContextOptions,
  deps: ContextDependencies,
) {
  validateContextOrder(options.order, options.plan.handle, options.plan.canary);
  const pace = contextPace(options.order, options.plan.canary, {
    ...CONTEXT_PACE,
    ...deps.pace,
  });
  const limitSignals = new LimitSignals();
  const postRetries = new PostOpenRetries();
  let activeReady: { postMs: number } | undefined;
  let accountBeforeClass: AccountClass | undefined;
  let accountAfterClass: AccountClass = 'absent';
  deps = {
    ...deps,
    navigated: (kind, elapsed) => {
      limitSignals.navigated(kind, elapsed);
      if (kind === 'post' && activeReady)
        activeReady.postMs = Math.max(0, Math.round(elapsed));
    },
    accountObserved: (value) => {
      accountBeforeClass ??= value;
      accountAfterClass = value;
    },
  };
  if (
    (
      await planContext(
        options.store,
        options.plan.accountKey,
        options.include,
        options.exclude,
      )
    ).hash !== options.plan.hash
  )
    throw new CliError('STALE_PLAN');
  await validateProfile(options.profile, 'instagram');
  if (await profileInUse(options.profile))
    throw new CliError('PROFILE_INVALID');
  const before = await profileSnapshot(options.profile),
    summary = contextSummary(options.plan, options.lang, pace);
  const confirmation = await (
    options.session?.confirmation ??
    ((initial) => startConfirmation(initial, deps.port))
  )({
    platform: 'instagram',
    lang: options.lang,
    phase: options.order ? 'running' : 'start',
    expectedHandle: options.plan.handle,
    warning: summary.warning,
    profileWarning:
      profileWarning(options.plan.handle, options.lang) +
      ' ' +
      CONTEXT_STEPS[options.lang] +
      ' ' +
      EXTENSION_NOTICE[options.lang] +
      ' ' +
      paceText(pace, options.lang),
    planned: summary.planned,
    marked: summary.marked,
    bulk: 0,
    estimateMs: summary.estimateMs,
    list: options.list,
    rows: options.plan.rows.slice(0, 20).map(({ item, marked }) => ({
      itemId: item.id,
      date: item.createdAt,
      firstLine: item.text.split(/[\r\n]/, 1)[0],
      owner: item.reference.ownerHandle,
      marked,
    })),
    completed: 0,
    result:
      options.lang === 'de'
        ? 'Dieser Lauf liest nur. Die erste Stichprobe endet vor einem vollständigen Lauf.'
        : 'This run only reads. The first canary ends before a full run.',
  });
  const writer = new InstagramContextWriter(options.store),
    runId = crypto.randomUUID();
  const report: {
    steps: unknown[];
    confirmations: { post: number; list: number };
    stop?: ReturnType<typeof stopDetails>;
    cause?: ReturnType<typeof contextCause>;
    readback?: unknown;
    abortedHosts?: Record<string, number>;
    finalization?: { stage: string; stop: ReturnType<typeof stopDetails> }[];
    pace: ReturnType<typeof paceSummary>;
    limits?: ReturnType<LimitSignals['summary']>;
    pages?: { startupClosed: number; unexpectedOpened: number };
    rows: { emptySkipped: number; otherName: number };
    runtime: RuntimeReport;
    retries: ReturnType<PostOpenRetries['summary']>;
  } = {
    steps: [],
    confirmations: { post: 0, list: 0 },
    retries: { used: 0, entries: [] },
    pace: paceSummary(pace),
    rows: { emptySkipped: 0, otherName: 0 },
    runtime: {
      pageCrashes: 0,
      browserDisconnects: 0,
      unexpectedPageCloses: 0,
      browserObserved: false,
      observationFailed: false,
      events: [],
    },
  };
  const checks: CanaryCheck[] = [];
  const checkedAttempts = new Map<string, CanaryCheck>();
  const checkedItemIds: string[] = [];
  const chosen = options.plan.canary
    ? canaryRows(options.plan)
    : options.plan.rows;
  const automatic = Boolean(options.order && options.plan.canary);
  let context: BrowserContext | undefined,
    network: Awaited<ReturnType<typeof guardInstagramNetwork>> | undefined;
  let pages: ReturnType<typeof contextPages> | undefined;
  let runtime: ReturnType<typeof observeContextRuntime> | undefined;
  let began = false,
    stopped = false,
    closed = false,
    completed = 0,
    steps = 0,
    commentsTried = 0,
    error: unknown;
  let endReason: NonNullable<BrowserRun['endReason']> = 'done',
    accountBefore: string | null = null,
    accountAfter: string | null = null;
  let pendingAttempt: string | undefined;
  let stage: ContextCauseStage = 'run';
  const recordCause = (caught: unknown, at: ContextCauseStage) => {
    if (!(caught instanceof CliError) && !report.cause)
      report.cause = contextCause(caught, runId, at, steps);
  };
  const profileNames: string[] = [];
  let cancel!: () => void;
  const cancelled = new Promise<false>((resolve) => {
    cancel = () => resolve(false);
  });
  const waits = new AbortController();
  let networkFailure: ContextStop | undefined;
  let interrupt!: () => void;
  const interrupted = new Promise<void>((resolve) => {
    interrupt = resolve;
  });
  const stop = () => {
    stopped = true;
    waits.abort();
    cancel();
  };
  confirmation.onStop(stop);
  options.signal.addEventListener('abort', stop, { once: true });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const guard = () => {
    if (networkFailure) throw networkFailure;
    network?.check();
    pages?.check();
    if (closed) throw new ContextStop('PLATFORM_CHECK', 'browser-closed');
    if (stopped || options.signal.aborted)
      throw new ContextStop('CANCELLED', 'stopped');
  };
  const sleep = deps.sleep.bind(deps);
  const pause = async (ms: number) => {
    try {
      await Promise.race([sleep(ms, waits.signal), cancelled, interrupted]);
    } catch (caught) {
      guard();
      throw caught;
    }
    guard();
  };
  deps = { ...deps, sleep: (ms) => pause(ms) };
  const checkpoint = async () => {
    guard();
    if (extensionsChanged(before, await profileSnapshot(options.profile)))
      throw new ContextStop(
        options.order && options.plan.canary
          ? 'CANARY_CHECK_FAILED'
          : 'PLATFORM_CHECK',
        'extensions-added',
      );
  };
  const platformStop = (caught: ContextStop) => {
    networkFailure ??= caught;
    waits.abort();
    interrupt();
    network?.stop(caught);
  };
  let answers: ReturnType<typeof pageAnswers> | undefined;
  let postRequests:
    ReturnType<NonNullable<typeof network>['beginPostRequests']> | undefined;
  let answerReport: (() => void) | undefined;
  let observedAfter: ProfileSnapshot | undefined;
  let observedReport: BrowserProfileReport | null = null;
  const rejectIncomplete = () => {
    if (automatic) throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
  };
  const assertAutomaticCanary = async () => {
    if (!automatic || completed !== 5 || checkedAttempts.size !== 5)
      throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
    await options.store.read(async (tx) => {
      const attempts = [];
      for await (const attempt of tx.browserAttempts.iterate())
        if (attempt.runId === runId) attempts.push(attempt);
      const sends = attempts.filter((attempt) => attempt.state === 'sending');
      const settled = attempts.filter((attempt) => attempt.settles !== null);
      if (
        sends.length > 15 ||
        sends.length !== settled.length ||
        attempts.length !== sends.length + settled.length ||
        settled.filter((attempt) => attempt.state === 'confirmed').length !== 5
      )
        throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
      const ids = new Set<string>();
      for (const send of sends) {
        const settlements = attempts.filter(
            (attempt) => attempt.settles === send.attemptId,
          ),
          check = checkedAttempts.get(send.attemptId);
        if (
          !send.itemId ||
          send.action !== 'confirm-comment' ||
          send.settles !== null ||
          ids.has(send.itemId) ||
          !chosen.some(({ item }) => item.id === send.itemId) ||
          settlements.length !== 1 ||
          settlements[0]!.action !== 'confirm-comment' ||
          settlements[0]!.itemId !== send.itemId ||
          (settlements[0]!.state !== 'confirmed' &&
            settlements[0]!.state !== 'unavailable' &&
            settlements[0]!.state !== 'unconfirmed' &&
            settlements[0]!.state !== 'not-listed')
        )
          throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
        if (settlements[0]!.state === 'confirmed') {
          const record = await tx.instagramContext.get(send.itemId);
          if (
            !check ||
            !record ||
            record.runId !== runId ||
            record.attemptId !== send.attemptId
          )
            throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
          automaticCanaryCheck(check);
        } else if (check)
          throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
        ids.add(send.itemId);
      }
    });
  };
  try {
    stage = 'run-start';
    options.session?.before(before, null);
    options.notice(summary.warning + '\n');
    const start = options.order
      ? Promise.resolve(true)
      : confirmation.wait('start');
    // Launch itself can resume signed-in pages. Give their guarded requests a
    // durable run identity before opening the context, not after manual Start.
    await options.store.read(async (tx) => {
      for await (const run of tx.browserRuns.iterate())
        if (run.accountKey === options.plan.accountKey && !run.endedAt) {
          if (!run.ownerPid) throw new CliError('WORKSPACE_BUSY');
          let alive = true;
          try {
            process.kill(run.ownerPid, 0);
          } catch (caught) {
            if (
              caught &&
              typeof caught === 'object' &&
              'code' in caught &&
              caught.code === 'ESRCH'
            )
              alive = false;
          }
          if (alive) throw new CliError('WORKSPACE_BUSY');
        }
    });
    await writer.startRun({
      runId,
      accountKey: options.plan.accountKey,
      planHash: options.plan.hash,
      startedAt: options.now().toISOString(),
      canary: options.plan.canary,
      ownerPid: process.pid,
    });
    began = true;
    if (options.order)
      await options.store
        .browserOutcomeWriter()
        .recordContextOrder(runId, options.order.sha256);
    stage = 'browser-launch';
    context = await deps.launch(options.profile, options.executablePath);
    stage = 'browser-setup';
    runtime = observeContextRuntime(context, () => ({ step: steps, stage }));
    options.session?.browser(() => {
      runtime?.closing();
      return context!.close();
    });
    network = await guardInstagramNetwork(
      context,
      options.session ? '' : new URL(confirmation.url).origin,
      (value) => options.store.browserOutcomeWriter().request(runId, value),
      deps.policy,
      limitSignals,
      platformStop,
      (page) => (pages ? pages.allowed(page) : Promise.resolve(true)),
    );
    pages = contextPages(context, platformStop);
    report.pages = pages.counts;
    context.once('close', () => {
      closed = true;
      cancel();
    });
    const local = await pages.startupPage();
    runtime.own(local);
    await network.flush();
    guard();
    await context.setOffline(false);
    if (!options.session) await local.goto(confirmation.launchUrl);
    options.notice(`Confirmation: ${confirmation.url}\n`);
    stage = 'start';
    if (
      !(await Promise.race([start, cancelled, interrupted.then(() => false)]))
    ) {
      guard();
      throw new ContextStop('CANCELLED', 'stopped');
    }
    guard();
    if (
      (
        await planContext(
          options.store,
          options.plan.accountKey,
          options.include,
          options.exclude,
        )
      ).hash !== options.plan.hash
    )
      throw new CliError('STALE_PLAN');
    stage = 'checkpoint';
    await checkpoint();
    const page = options.session ? local : await pages.newPage();
    runtime.own(page);
    answers = pageAnswers(page, deps.policy);
    const day = dateInZone(options.now(), options.plan.timeZone),
      prior = await instagramDailyCount(
        options.store,
        options.plan.accountKey,
        options.now(),
        options.plan.timeZone,
      );
    let used = prior.used,
      last = prior.last,
      batch = prior.used ? ((prior.used - 1) % pace.batch) + 1 : 0;
    const controls = options.session?.controls;
    const resumeChecks = async () => {
      // The next counted, paced list step verifies account and language before
      // opening a post. Resume itself must not navigate an uncounted page.
      stage = 'checkpoint';
      await checkpoint();
    };
    const boundaryWait = async (ms: number) => {
      if (controls) {
        await Promise.race([
          controls.delay(
            ms,
            (duration, localSignal) =>
              sleep(duration, AbortSignal.any([waits.signal, localSignal])),
            resumeChecks,
            waits.signal,
            (remaining, next) => options.session?.waiting(remaining, next),
          ),
          interrupted,
        ]);
        guard();
      } else await pause(ms);
    };
    const max = Math.min(
      options.limit,
      options.order?.value.maxSteps ?? 600,
      Math.max(0, pace.perDay - prior.used),
    );
    outer: for (const row of chosen) {
      if (options.plan.canary && completed === 5) break;
      if (steps >= max) {
        rejectIncomplete();
        if (used >= pace.perDay) endReason = 'daily-cap';
        break;
      }
      if (
        used >= pace.perDay ||
        dateInZone(options.now(), options.plan.timeZone) !== day
      ) {
        rejectIncomplete();
        endReason = 'daily-cap';
        break;
      }
      stage = 'checkpoint';
      await checkpoint();
      options.session?.entry(entryView(row.item, 'confirm-comment'));
      const attemptId = crypto.randomUUID();
      stage = 'attempt';
      await writer.sending({
        runId,
        attemptId,
        itemId: row.item.id,
        at: options.now().toISOString(),
      });
      pendingAttempt = attemptId;
      let settled = false;
      let reopening: ReturnType<PostOpenRetries['begin']> = null;
      let reopenTarget: string | null = null;
      let lastUnconfirmed: 'owner' | 'time' | 'text' | 'several' | 'not-shown' =
        'not-shown';
      for (let candidate = 0; candidate < 3; candidate++) {
        postRequests?.close();
        stage = 'pace';
        const pausedBefore = controls?.pausedMs ?? 0;
        await controls?.checkpoint(resumeChecks, waits.signal);
        last += (controls?.pausedMs ?? 0) - pausedBefore;
        if (
          used >= pace.perDay ||
          dateInZone(options.now(), options.plan.timeZone) !== day ||
          steps >= max
        ) {
          stage = 'settlement';
          await writer.settle({
            attemptId,
            state: 'unconfirmed',
            code: lastUnconfirmed,
            at: options.now().toISOString(),
          });
          pendingAttempt = undefined;
          rejectIncomplete();
          endReason =
            used >= pace.perDay ||
            dateInZone(options.now(), options.plan.timeZone) !== day
              ? 'daily-cap'
              : 'done';
          break outer;
        }
        if (batch >= pace.batch) {
          if (pace.pauseMs) {
            options.session?.update({
              phase: 'batch-pause',
              remainingMs: pace.pauseMs,
              until: new Date(
                options.now().getTime() + pace.pauseMs,
              ).toISOString(),
            });
            await boundaryWait(pace.pauseMs);
            options.session?.update({ phase: 'running' });
          }
          batch = 0;
        }
        const wait = last + pace.intervalMs - options.now().getTime();
        if (wait > 0) {
          options.session?.update({
            nextStepAt: new Date(options.now().getTime() + wait).toISOString(),
          });
          await boundaryWait(wait);
        }
        stage = 'checkpoint';
        await checkpoint();
        if (dateInZone(options.now(), options.plan.timeZone) !== day) {
          stage = 'settlement';
          await writer.settle({
            attemptId,
            state: 'unconfirmed',
            code: lastUnconfirmed,
            at: options.now().toISOString(),
          });
          pendingAttempt = undefined;
          rejectIncomplete();
          endReason = 'daily-cap';
          break outer;
        }
        await controls?.checkpoint(resumeChecks, waits.signal);
        stage = 'attempt';
        await writer.step(runId, options.now().toISOString());
        if (candidate === 0 && !reopening) commentsTried++;
        steps++;
        used++;
        batch++;
        last = options.now().getTime();
        if (reopening) reopening.retryStep = steps;
        options.session?.progress(
          used,
          completed,
          (await options.store.browserJournal()).attempts.filter(
            (value) => value.runId === runId,
          ),
        );
        answers.reset(options.plan.canary);
        answerReport = undefined;
        const rowCounts = { emptySkipped: 0, otherName: 0 };
        stage = 'list-read';
        const list = await (async () => {
          try {
            return await loadList(
              page,
              row.item,
              options.plan.handle,
              deps,
              guard,
              options.plan.canary && steps === 1,
              options.now(),
              rowCounts,
            );
          } finally {
            report.rows.emptySkipped += rowCounts.emptySkipped;
            report.rows.otherName += rowCounts.otherName;
          }
        })();
        if (accountBefore === null) accountBeforeClass = 'expected';
        accountBefore ??= list.account;
        accountAfter = list.account;
        options.session?.before(before, accountBefore);
        await network?.flush();
        stage = 'answers';
        await answers.flush(deps.responseMs);
        const stepReport: Record<string, unknown> = {
          ready: { postMs: 0 },
          filterByLists: true,
          rows: list.rowCount,
          emptySkipped: list.emptySkipped,
          otherName: list.otherName,
          candidates: list.candidates.length,
          scrollLoads: list.scrollLoads,
          expansionClicks: 0,
          expansionScrolls: 0,
          confirmed: false,
          roles: ['button', 'dialog', 'combobox'],
          controls: [
            ...CLICK_NAMES,
            POST_SCROLL_ACTION,
            'date-year-list',
            'date-month-list',
            'date-day-list',
          ],
          fields: {},
          listPairing: answers.bodies.some(pairedCode),
          oldestWithinWeek: list.oldestWithinWeek,
        };
        report.steps.push(stepReport);
        answers.reset(options.plan.canary);
        answerReport = options.plan.canary
          ? () => {
              stepReport.secondSource = answers!.summary(
                postAddress(page.url(), deps.origin)?.code ?? null,
              );
            }
          : undefined;
        answerReport?.();
        profileNames.push(list.account);
        if (list.full || !list.candidates[candidate]) {
          stage = 'settlement';
          await writer.settle({
            attemptId,
            state: 'not-listed',
            code: list.full ? 'window-full' : 'no-row',
            at: options.now().toISOString(),
          });
          pendingAttempt = undefined;
          settled = true;
          stepReport.result = list.full ? 'window-full' : 'no-row';
          break;
        }
        stage = 'post-open';
        activeReady = { postMs: 0 };
        stepReport.ready = activeReady;
        const openedAt = performance.now();
        postRequests = network.beginPostRequests(page);
        const postRequestsForStep = postRequests;
        Object.defineProperty(stepReport, 'postRequests', {
          enumerable: true,
          get: () => postRequestsForStep.summary(),
        });
        let opened: boolean;
        let target: string | null = reopenTarget;
        const navigation = (request: Request) => {
          if (
            !request.isNavigationRequest() ||
            request.frame() !== page.mainFrame()
          )
            return;
          const address = postAddress(request.url(), deps.origin);
          if (
            address &&
            new URL(request.url()).origin === new URL(deps.origin).origin
          )
            target = new URL(`/${address.kind}/${address.code}`, deps.origin)
              .href;
        };
        page.on('request', navigation);
        try {
          opened =
            reopening && reopenTarget
              ? await reopenCandidate(page, reopenTarget, deps, guard)
              : await openCandidate(
                  page,
                  list.candidates[candidate]!.index,
                  deps,
                  guard,
                );
          if (reopening) reopening.outcome = 'ready';
          reopening = null;
          reopenTarget = null;
        } catch (caught) {
          activeReady.postMs = Math.max(
            0,
            Math.round(performance.now() - openedAt),
          );
          if (reopening && errorClass(caught) === 'timeout')
            reopening.outcome = 'timeout';
          const retry = postRetries.begin(
            caught,
            [row.item.id, ...(target ? [target] : [])],
            steps,
            options.plan.canary,
            target !== null &&
              used < pace.perDay &&
              steps < max &&
              dateInZone(options.now(), options.plan.timeZone) === day,
          );
          if (!retry) throw caught;
          guard();
          await checkPage(page);
          await checkpoint();
          stage = 'post-open';
          const startedWait = options.now().getTime();
          const watcher = new AbortController();
          const checkWaitingPage = async () => {
            guard();
            await checkPage(page);
            if (
              new URL(page.url()).pathname.replace(/\/$/, '') === COMMENTS_PATH
            ) {
              const value = accountClass(
                options.plan.handle,
                await outsideProfilePaths(page),
              );
              accountAfterClass = value;
              if (value !== 'expected')
                throw new ContextStop('ACCOUNT_MISMATCH', 'account-changed');
            }
          };
          let crash!: () => void;
          const crashed = new Promise<never>((_resolve, reject) => {
            crash = () => {
              const failure = new Error();
              failure.name = 'PageCrashedError';
              reject(failure);
            };
            page.once('crash', crash);
          });
          const watch = (async () => {
            for (;;) {
              await retryPoll(250, undefined, { signal: watcher.signal });
              await checkWaitingPage();
            }
          })();
          options.session?.update({
            phase: 'running',
            remainingMs: POST_REOPEN_WAIT_MS,
            until: new Date(
              options.now().getTime() + POST_REOPEN_WAIT_MS,
            ).toISOString(),
          });
          try {
            await Promise.race([
              boundaryWait(POST_REOPEN_WAIT_MS),
              watch,
              crashed,
            ]);
            await checkWaitingPage();
            await checkpoint();
          } finally {
            retry.waitedMs = Math.max(
              0,
              Math.round(options.now().getTime() - startedWait),
            );
            watcher.abort();
            page.off('crash', crash);
            // Its rejection is already observed by Promise.race; do not wait
            // for a locator read after another stop has won the race.
          }
          reopening = retry;
          reopenTarget = target;
          candidate--;
          continue;
        } finally {
          if (activeReady && activeReady.postMs === 0)
            activeReady.postMs = Math.max(
              0,
              Math.round(performance.now() - openedAt),
            );
          activeReady = undefined;
          page.off('request', navigation);
        }
        if (!opened) {
          stage = 'settlement';
          await writer.settle({
            attemptId,
            state: 'unavailable',
            code: null,
            at: options.now().toISOString(),
          });
          pendingAttempt = undefined;
          settled = true;
          stepReport.result = 'unavailable';
          break;
        }
        stage = 'post-read';
        const read = await confirmOnPost(
          page,
          row.item,
          options.plan.handle,
          deps,
          guard,
        );
        stepReport.expansionClicks = read.expandClicks;
        stepReport.expansionScrolls = read.expansionScrolls;
        stepReport.ownerCount = read.post.ownerCount;
        if (options.plan.canary) {
          await answers.flush(deps.responseMs);
          stepReport.secondSource = answers.summary(read.post.code);
        }
        await checkpoint();
        const fromList =
          read.result.state === 'unconfirmed' &&
          read.result.code === 'not-shown' &&
          list.candidates.length === 1 &&
          list.candidates[0]!.username.toLowerCase() ===
            options.plan.handle.toLowerCase() &&
          normalize(list.candidates[0]!.text) === normalize(row.item.text) &&
          read.post.ownerCount === 1 &&
          read.post.ownerMatchesProfile &&
          ownerName(read.post.owner) ===
            ownerName(row.item.reference.ownerHandle ?? '');
        if (read.result.state !== 'confirmed' && !fromList) {
          lastUnconfirmed = read.result.code;
          stepReport.result = read.result.code;
          if (candidate + 1 < Math.min(list.candidates.length, 3)) continue;
          const code =
            list.candidates.length > 3 ? 'several' : read.result.code;
          stage = 'settlement';
          await writer.settle({
            attemptId,
            state: 'unconfirmed',
            code,
            at: options.now().toISOString(),
          });
          pendingAttempt = undefined;
          settled = true;
          if (options.plan.canary && code === 'owner')
            Object.assign(stepReport, {
              ownerLinksOneAccount: read.post.ownerCount === 1,
              ownerEqualsExport:
                ownerName(read.post.owner) ===
                ownerName(row.item.reference.ownerHandle ?? ''),
              firstProfileNamesOwner: read.post.ownerMatchesProfile,
            });
          break;
        }
        stage = 'capture';
        const captures = await (deps.capture ?? capturePost)(
          options.workspace,
          read.post.code,
          read.post.element,
          read.source,
          answers.images,
          deps.policy,
        );
        const record: InstagramContext = {
          itemId: row.item.id,
          accountKey: options.plan.accountKey,
          ...(read.result.state === 'confirmed'
            ? {
                confirmedBy: 'post' as const,
                comment: {
                  id: read.result.comment.id,
                  createdAt: read.result.comment.createdAt,
                  expandClicks: read.expandClicks,
                },
              }
            : {
                confirmedBy: 'list' as const,
                comment: {
                  id: null,
                  createdAt: null,
                  expandClicks: read.expandClicks,
                },
              }),
          post: {
            kind: read.post.kind,
            code: read.post.code,
            owner: read.post.owner,
            ownerCount: read.post.ownerCount,
            createdAt: read.post.createdAt,
            caption: read.post.caption,
            captionComplete: read.post.captionComplete,
          },
          image: captures.image,
          screenshot: captures.screenshot,
          confirmedAt: options.now().toISOString(),
          runId,
          attemptId,
        };
        stage = 'answers';
        await answers.flush(deps.responseMs);
        if (options.plan.canary)
          stepReport.secondSource = answers.summary(read.post.code);
        await checkpoint();
        stage = 'compare';
        const check: CanaryCheck = {
          confirmed: true,
          fields: compareSources(record, read.source, answers.bodies),
          ownerShown: Boolean(read.post.owner),
          timeShown: read.post.createdAt !== null,
          imageStored: record.image.status === 'stored',
          screenshotStored: record.screenshot.status === 'stored',
        };
        if (options.plan.canary) checks.push(check);
        Object.assign(stepReport, {
          confirmed: true,
          result: 'confirmed',
          confirmedBy: record.confirmedBy,
          fields: check.fields,
          ownerShown: check.ownerShown,
          timeShown: check.timeShown,
          image: { status: record.image.status, bytes: captures.imageBytes },
          screenshot: {
            status: record.screenshot.status,
            bytes: captures.shotBytes,
          },
          paths: [...new Set(answers.bodies.flatMap((body) => keyPaths(body)))],
        });
        stage = 'canary-check';
        if (options.order && options.plan.canary) automaticCanaryCheck(check);
        stage = 'settlement';
        await writer.confirm(record);
        if (automatic) {
          checkedAttempts.set(attemptId, check);
          checkedItemIds.push(row.item.id);
        }
        pendingAttempt = undefined;
        settled = true;
        completed++;
        report.confirmations[record.confirmedBy]++;
        break;
      }
      if (!settled) throw new ContextStop('CONTEXT_FAILED', 'post-structure');
      stage = 'progress';
      options.session?.progress(
        used,
        completed,
        (await options.store.browserJournal()).attempts.filter(
          (value) => value.runId === runId,
        ),
      );
      options.session?.instagram(limitSignals.summary());
      if (options.plan.canary && !options.order) {
        const continuing = confirmation.wait('continue');
        confirmation.update({
          phase: 'canary',
          completed,
          result: JSON.stringify(report.steps.at(-1)),
        });
        if (
          !(await Promise.race([
            continuing,
            cancelled,
            interrupted.then(() => false),
          ]))
        ) {
          guard();
          throw new ContextStop('CANCELLED', 'stopped');
        }
      } else
        confirmation.update({
          completed,
          result:
            options.lang === 'de'
              ? `${steps} Schritte gelesen, ${completed} Kommentare bestätigt.`
              : `${steps} steps read, ${completed} comments confirmed.`,
        });
    }
    if (options.plan.canary && commentsTried === 15 && completed < 5)
      throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
    stage = 'canary-check';
    if (automatic && chosen.length) await assertAutomaticCanary();
    if (options.plan.canary && report.steps.length > 0 && endReason === 'done')
      endReason = 'canary';
  } catch (caught) {
    recordCause(caught, stage);
    error = caught;
    endReason =
      caught instanceof CliError && caught.code === 'CANCELLED'
        ? 'stopped-by-person'
        : caught instanceof CliError &&
            caught.code === 'INSTAGRAM_SHAPE_CHANGED'
          ? 'shape-changed'
          : caught instanceof CliError && caught.code === 'PLATFORM_CHECK'
            ? 'platform-check'
            : 'error';
  } finally {
    let matches = false,
      reportPath: string | undefined;
    let persistedCause: ReturnType<typeof contextCause> | undefined;
    let announcedCause: ReturnType<typeof contextCause> | undefined;
    let persistedRuntime = -1;
    type FinalStage =
      | 'answers'
      | 'settlement'
      | 'network'
      | 'manual-match'
      | 'snapshot'
      | 'read-back'
      | 'structure-report'
      | 'extension-report'
      | 'automatic-check'
      | 'audit'
      | 'end-run'
      | 'acceptance'
      | 'browser-close'
      | 'confirmation-close';
    const retain = (caught: unknown, at: ContextCauseStage = 'projection') => {
      if (error !== undefined) return;
      recordCause(caught, at);
      error = caught;
      endReason =
        caught instanceof CliError && caught.code === 'CANCELLED'
          ? 'stopped-by-person'
          : caught instanceof CliError &&
              caught.code === 'INSTAGRAM_SHAPE_CHANGED'
            ? 'shape-changed'
            : caught instanceof CliError && caught.code === 'PLATFORM_CHECK'
              ? 'platform-check'
              : 'error';
    };
    const finalize = async (
      at: FinalStage,
      action: () => Promise<void> | void,
    ): Promise<boolean> => {
      stage = at;
      try {
        await action();
        return true;
      } catch (caught) {
        retain(caught, at);
        (report.finalization ??= []).push({
          stage: at,
          stop: stopDetails(caught),
        });
        return false;
      }
    };
    const structure = async () => {
      if (error) report.stop = stopDetails(error);
      report.limits = limitSignals.summary();
      report.retries = PostRetriesSchema.parse(postRetries.summary());
      report.runtime =
        runtime?.summary() ?? RuntimeReportSchema.parse(report.runtime);
      const runtimeVersion = runtime?.version ?? 0;
      reportPath = await writeStructure(
        options.workspace,
        runId,
        {
          ...report,
          steps: report.steps.map((step) =>
            ContextStepReportSchema.parse(step),
          ),
          ...(report.cause
            ? { cause: ContextCauseSchema.parse(report.cause) }
            : {}),
        },
        Boolean(reportPath),
      );
      persistedCause = report.cause;
      persistedRuntime = runtimeVersion;
    };
    await finalize('answers', async () => {
      postRequests?.close();
      await answers?.flush(deps.responseMs);
      answerReport?.();
      answers?.dispose();
    });
    if (began) {
      if (pendingAttempt)
        await finalize('settlement', async () => {
          await writer.settle({
            attemptId: pendingAttempt!,
            state: 'failed',
            at: options.now().toISOString(),
            code: error instanceof CliError ? error.code : 'CONTEXT_FAILED',
          });
          pendingAttempt = undefined;
        });
      await finalize('network', async () => {
        await network?.flush();
        await pages?.flush();
      });
      if (endReason === 'canary' && !error && !options.order && completed > 0) {
        const written = await finalize('structure-report', structure);
        if (written)
          await finalize('manual-match', async () => {
            options.notice(`Structure report: ${reportPath}\n`);
            const accepting = confirmation.wait('matches');
            confirmation.update({
              phase: 'match',
              result:
                options.lang === 'de'
                  ? 'Vergleiche die Beiträge mit der Prüfung. Passt akzeptiert die Stichprobe; Passt nicht lehnt sie ab.'
                  : 'Compare the posts with review. Matches accepts the canary; Does not match rejects it.',
            });
            matches = await Promise.race([
              accepting,
              cancelled,
              interrupted.then(() => false),
            ]);
            if (networkFailure) throw networkFailure;
            if (!matches) endReason = 'stopped-by-person';
          });
      }
      await finalize('network', async () => {
        await network?.flush();
      });
      let after: ProfileSnapshot | undefined;
      await finalize('snapshot', async () => {
        after = await profileSnapshot(options.profile);
        observedAfter = after;
      });
      const added =
        after?.extensionIds.filter((id) => !before.extensionIds.includes(id))
          .length ?? 0;
      const removed = after
        ? before.extensionIds.filter((id) => !after!.extensionIds.includes(id))
            .length
        : 0;
      await finalize('read-back', () => {
        if (automatic && endReason === 'canary' && !error)
          automaticReadbackCheck(
            accountBefore,
            accountAfter,
            added,
            removed,
            0,
          );
        else if (
          added ||
          accountBefore?.toLowerCase() !== accountAfter?.toLowerCase()
        )
          throw new ContextStop(
            'PLATFORM_CHECK',
            added ? 'extensions-added' : 'account-changed',
          );
      });
      const profileReport: BrowserProfileReport = {
        // These names come only from the last loaded list, never the open post.
        accountBefore,
        accountAfter,
        extensionsBefore: before.extensions,
        extensionsAfter: after?.extensions ?? before.extensions,
        changedFiles: after ? changedProfileFiles(before, after) : [],
        unexpectedRequests: network?.requests ?? [],
      };
      observedReport = profileReport;
      const bodyShapes: Record<string, string[]> = after
        ? {}
        : { profileReadback: ['unavailable'] };
      const groups = new Map<string, number>();
      for (const request of profileReport.unexpectedRequests) {
        const shape = `${request.method}|${request.operation ?? '*'}`;
        groups.set(shape, (groups.get(shape) ?? 0) + 1);
      }
      report.readback = {
        ...AccountReadbackSchema.parse({
          accountBeforeClass: accountBeforeClass ?? 'absent',
          accountAfterClass,
        }),
        accountSame:
          accountBefore !== null &&
          accountBefore.toLowerCase() === accountAfter?.toLowerCase() &&
          profileNames.every(
            (name) => name.toLowerCase() === accountBefore?.toLowerCase(),
          ),
        profileObserved: Boolean(after),
        extensionsAdded: after ? added : null,
        extensionsRemoved: after ? removed : null,
        changedFiles: after ? profileReport.changedFiles.length : null,
        operations: [
          ...new Set(
            profileReport.unexpectedRequests
              .map((request) => request.operation)
              .filter(Boolean),
          ),
        ],
        requestGroups: [...groups].map(([shape, count]) => ({ shape, count })),
        readingRequestsNotice:
          'Instagram sends non-GET requests while reading. This rule does not identify every write.',
      };
      report.abortedHosts = network?.abortedHosts ?? {};
      await finalize('network', async () => {
        await network?.flush();
      });
      if (automatic && !error)
        await finalize('automatic-check', assertAutomaticCanary);
      await finalize('structure-report', structure);
      await finalize('extension-report', async () => {
        // A failed snapshot must not masquerade as an unchanged profile. The
        // read-back report explicitly marks the last-known fallback as unobserved.
        await writeExtensionReport(
          options.profile,
          runId,
          before,
          after ?? before,
          { ...profileReport, profileObserved: Boolean(after) },
          network?.abortedHosts,
          'instagram',
        );
      });
      let ended = false,
        accepted = false;
      await finalize('network', async () => {
        await network?.flush();
      });
      await finalize('structure-report', structure);
      if (automatic && endReason === 'canary' && !error) {
        accepted = await finalize('acceptance', async () => {
          guard();
          await options.store
            .browserOutcomeWriter()
            .recordContextAudit(
              runId,
              canaryAudit(checks, added, removed, 0),
              undefined,
              true,
              {
                at: options.now().toISOString(),
                itemIds: checkedItemIds,
                profileReport,
              },
            );
          ended = true;
        });
      }
      if (options.order && !accepted)
        await finalize('audit', async () => {
          await options.store
            .browserOutcomeWriter()
            .recordContextAudit(
              runId,
              canaryAudit(
                checks,
                added,
                removed,
                error instanceof CliError && error.code === 'UNEXPECTED_ACTION'
                  ? 1
                  : 0,
              ),
              error instanceof CliError
                ? error.code
                : error
                  ? 'CONTEXT_FAILED'
                  : undefined,
            );
        });
      if (!ended)
        ended = await finalize('end-run', async () => {
          await writer.endRun({
            runId,
            endedAt: options.now().toISOString(),
            endReason,
            bodyShapes,
            profileReport,
          });
        });
      if (
        ended &&
        !options.order &&
        endReason === 'canary' &&
        !error &&
        matches
      )
        await finalize('acceptance', async () => {
          await writer.acceptCanary(runId, options.now().toISOString());
        });
      if (error) await finalize('structure-report', structure);
      options.notice(`Read-back: ${JSON.stringify(report.readback)}\n`);
    }
    if (error) {
      report.stop = stopDetails(error);
      options.notice(
        `Stop detail: ${stopDetailText(error)}${report.cause ? `; stage=${report.cause.stage}; step=${report.cause.step}; run=${report.cause.runId}` : ''}${report.stop.errorClass ? `; pageCrashes=${report.runtime.pageCrashes}; browserDisconnects=${report.runtime.browserDisconnects}; unexpectedPageCloses=${report.runtime.unexpectedPageCloses}` : ''}; retriesUsed=${report.retries.used}; retries=${JSON.stringify(report.retries.entries)}\n`,
      );
      announcedCause = report.cause;
    }
    if (reportPath) options.notice(`Structure report: ${reportPath}\n`);
    const text = contextEnd(endReason, options.lang, Boolean(options.order));
    stage = 'projection';
    try {
      confirmation.update({ phase: 'ended', completed, result: text });
      options.session?.instagram(limitSignals.summary());
      options.session?.progress(
        (
          await instagramDailyCount(
            options.store,
            options.plan.accountKey,
            options.now(),
            options.plan.timeZone,
          )
        ).used,
        completed,
        (await options.store.browserJournal()).attempts.filter(
          (value) => value.runId === runId,
        ),
      );
      options.session?.finish(
        { endReason, profileReport: observedReport },
        error,
        observedAfter,
      );
      options.notice(text + '\n');
    } catch (projectionError) {
      retain(projectionError);
      options.session?.failed(projectionError);
    } finally {
      waits.abort();
      await finalize('browser-close', async () => {
        if (options.order) runtime?.closing();
        if (context) await deps.close(context, Boolean(options.order));
      });
      network?.dispose();
      pages?.dispose();
      await finalize('confirmation-close', () => confirmation.close());
      options.signal.removeEventListener('abort', stop);
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
    if (report.cause && persistedCause !== report.cause)
      await finalize('structure-report', structure);
    runtime?.dispose();
    if (runtime && persistedRuntime !== runtime.version)
      await finalize('structure-report', structure);
    if (report.cause && announcedCause !== report.cause) {
      report.stop = stopDetails(error);
      options.notice(
        `Stop detail: ${stopDetailText(error)}; stage=${report.cause.stage}; step=${report.cause.step}; run=${report.cause.runId}${report.stop.errorClass ? `; pageCrashes=${report.runtime.pageCrashes}; browserDisconnects=${report.runtime.browserDisconnects}; unexpectedPageCloses=${report.runtime.unexpectedPageCloses}` : ''}; retriesUsed=${report.retries.used}; retries=${JSON.stringify(report.retries.entries)}\n`,
      );
    }
  }
  if (error)
    throw error instanceof CliError ? error : new CliError('CONTEXT_FAILED');
  return {
    completed,
    steps: options.plan.canary ? commentsTried : steps,
    runId,
    endReason,
  };
}
export function runContext(options: ContextOptions) {
  return runContextWithDependencies(
    options,
    options.windowPlacement
      ? {
          ...productionContext,
          launch: (profile, executable) =>
            launchRunBrowser(
              profile,
              executable,
              options.windowPlacement,
              true,
            ),
        }
      : productionContext,
  );
}
