import type { BrowserContext } from 'playwright-core';
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
import { planContext, contextSummary, canaryRows } from './plan.ts';
import type { ContextPlan } from './plan.ts';
import { validateContextOrder } from './order.ts';
import type { ContextOrder } from './order.ts';
import { ContextStop, stopDetails, keyPaths, pairedCode } from './report.ts';
import {
  productionContext,
  loadList,
  openCandidate,
  confirmOnPost,
} from './driver.ts';
import type { ContextDependencies } from './driver.ts';
import { pageAnswers, capturePost, writeStructure } from './capture.ts';
import { guardInstagramNetwork } from './network.ts';
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
import { CLICK_NAMES } from './selectors.ts';
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
  deps = {
    ...deps,
    navigated: (kind, elapsed) => {
      limitSignals.navigated(kind, elapsed);
    },
  };
  if (
    (await planContext(options.store, options.plan.accountKey, options.include))
      .hash !== options.plan.hash
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
    stop?: ReturnType<typeof stopDetails>;
    readback?: unknown;
    abortedHosts?: Record<string, number>;
    finalization?: { stage: string; stop: ReturnType<typeof stopDetails> }[];
    pace: ReturnType<typeof paceSummary>;
    limits?: ReturnType<LimitSignals['summary']>;
    pages?: { startupClosed: number; unexpectedOpened: number };
    rows: { emptySkipped: number };
  } = { steps: [], pace: paceSummary(pace), rows: { emptySkipped: 0 } };
  const checks: CanaryCheck[] = [];
  const checkedAttempts = new Map<string, CanaryCheck>();
  const chosen = options.plan.canary
    ? canaryRows(options.plan)
    : options.plan.rows;
  const automatic = Boolean(options.order && options.plan.canary);
  let context: BrowserContext | undefined,
    network: Awaited<ReturnType<typeof guardInstagramNetwork>> | undefined;
  let pages: ReturnType<typeof contextPages> | undefined;
  let began = false,
    stopped = false,
    closed = false,
    completed = 0,
    steps = 0,
    error: unknown;
  let endReason: NonNullable<BrowserRun['endReason']> = 'done',
    accountBefore: string | null = null,
    accountAfter: string | null = null;
  let pendingAttempt: string | undefined;
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
  let observedAfter: ProfileSnapshot | undefined;
  let observedReport: BrowserProfileReport | null = null;
  const rejectIncomplete = () => {
    if (automatic) throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
  };
  const assertAutomaticCanary = async () => {
    if (
      !automatic ||
      chosen.length < 1 ||
      completed !== chosen.length ||
      checkedAttempts.size !== chosen.length
    )
      throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
    await options.store.read(async (tx) => {
      const attempts = [];
      for await (const attempt of tx.browserAttempts.iterate())
        if (attempt.runId === runId) attempts.push(attempt);
      const sends = attempts.filter((attempt) => attempt.state === 'sending');
      if (sends.length !== chosen.length)
        throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
      const ids = new Set<string>();
      for (const send of sends) {
        const settlements = attempts.filter(
            (attempt) => attempt.settles === send.attemptId,
          ),
          check = checkedAttempts.get(send.attemptId);
        if (
          !send.itemId ||
          ids.has(send.itemId) ||
          !chosen.some(({ item }) => item.id === send.itemId) ||
          settlements.length !== 1 ||
          settlements[0]!.state !== 'confirmed' ||
          !check
        )
          throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
        automaticCanaryCheck(check);
        ids.add(send.itemId);
      }
    });
  };
  try {
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
    context = await deps.launch(options.profile, options.executablePath);
    options.session?.browser(() => context!.close());
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
    await network.flush();
    guard();
    await context.setOffline(false);
    if (!options.session) await local.goto(confirmation.launchUrl);
    options.notice(`Confirmation: ${confirmation.url}\n`);
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
        )
      ).hash !== options.plan.hash
    )
      throw new CliError('STALE_PLAN');
    await checkpoint();
    const page = options.session ? local : await pages.newPage();
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
      await checkpoint();
      options.session?.entry(entryView(row.item, 'confirm-comment'));
      const attemptId = crypto.randomUUID();
      await writer.sending({
        runId,
        attemptId,
        itemId: row.item.id,
        at: options.now().toISOString(),
      });
      pendingAttempt = attemptId;
      let settled = false;
      let lastUnconfirmed: 'owner' | 'time' | 'text' | 'several' | 'not-shown' =
        'not-shown';
      for (let candidate = 0; candidate < 3; candidate++) {
        const pausedBefore = controls?.pausedMs ?? 0;
        await controls?.checkpoint(resumeChecks, waits.signal);
        last += (controls?.pausedMs ?? 0) - pausedBefore;
        if (
          used >= pace.perDay ||
          dateInZone(options.now(), options.plan.timeZone) !== day ||
          steps >= max
        ) {
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
        await checkpoint();
        if (dateInZone(options.now(), options.plan.timeZone) !== day) {
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
        await writer.step(runId, options.now().toISOString());
        steps++;
        used++;
        batch++;
        last = options.now().getTime();
        options.session?.progress(
          used,
          completed,
          (await options.store.browserJournal()).attempts.filter(
            (value) => value.runId === runId,
          ),
        );
        answers.reset(options.plan.canary);
        const rowCounts = { emptySkipped: 0 };
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
          }
        })();
        accountBefore ??= list.account;
        accountAfter = list.account;
        options.session?.before(before, accountBefore);
        await network?.flush();
        await answers.flush(deps.responseMs);
        const stepReport: Record<string, unknown> = {
          filterByLists: true,
          rows: list.rowCount,
          emptySkipped: list.emptySkipped,
          candidates: list.candidates.length,
          scrollLoads: list.scrollLoads,
          expansionClicks: 0,
          confirmed: false,
          roles: ['button', 'dialog', 'combobox'],
          controls: [
            ...CLICK_NAMES,
            'date-year-list',
            'date-month-list',
            'date-day-list',
          ],
          fields: {},
          listPairing: answers.bodies.some(pairedCode),
          oldestWithinWeek: list.oldestWithinWeek,
        };
        report.steps.push(stepReport);
        profileNames.push(list.account);
        if (list.full || !list.candidates[candidate]) {
          await writer.settle({
            attemptId,
            state: 'not-listed',
            code: list.full ? 'window-full' : 'no-row',
            at: options.now().toISOString(),
          });
          pendingAttempt = undefined;
          settled = true;
          stepReport.result = list.full ? 'window-full' : 'no-row';
          if (options.order && options.plan.canary)
            throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
          break;
        }
        answers.reset(options.plan.canary);
        if (
          !(await openCandidate(
            page,
            list.candidates[candidate]!.index,
            deps,
            guard,
          ))
        ) {
          await writer.settle({
            attemptId,
            state: 'unavailable',
            code: null,
            at: options.now().toISOString(),
          });
          pendingAttempt = undefined;
          settled = true;
          stepReport.result = 'unavailable';
          if (options.order && options.plan.canary)
            throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
          break;
        }
        const read = await confirmOnPost(
          page,
          row.item,
          options.plan.handle,
          deps,
          guard,
        );
        stepReport.expansionClicks = read.expandClicks;
        stepReport.ownerCount = read.post.ownerCount;
        await checkpoint();
        if (read.result.state !== 'confirmed') {
          lastUnconfirmed = read.result.code;
          stepReport.result = read.result.code;
          if (candidate + 1 < Math.min(list.candidates.length, 3)) continue;
          const code =
            list.candidates.length > 3 ? 'several' : read.result.code;
          await writer.settle({
            attemptId,
            state: 'unconfirmed',
            code,
            at: options.now().toISOString(),
          });
          pendingAttempt = undefined;
          settled = true;
          if (options.order && options.plan.canary)
            throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
          break;
        }
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
          post: {
            kind: read.post.kind,
            code: read.post.code,
            owner: read.post.owner,
            ownerCount: read.post.ownerCount,
            createdAt: read.post.createdAt,
            caption: read.post.caption,
            captionComplete: read.post.captionComplete,
          },
          comment: {
            id: read.result.comment.id,
            createdAt: read.result.comment.createdAt,
            expandClicks: read.expandClicks,
          },
          image: captures.image,
          screenshot: captures.screenshot,
          confirmedAt: options.now().toISOString(),
          runId,
          attemptId,
        };
        await answers.flush(deps.responseMs);
        await checkpoint();
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
        if (options.order && options.plan.canary) automaticCanaryCheck(check);
        await writer.confirm(record);
        if (automatic) checkedAttempts.set(attemptId, check);
        pendingAttempt = undefined;
        settled = true;
        completed++;
        break;
      }
      if (!settled) throw new ContextStop('CONTEXT_FAILED', 'post-structure');
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
    if (automatic && chosen.length) await assertAutomaticCanary();
    if (options.plan.canary && report.steps.length > 0 && endReason === 'done')
      endReason = 'canary';
  } catch (caught) {
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
    const retain = (caught: unknown) => {
      if (error !== undefined) return;
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
      stage: FinalStage,
      action: () => Promise<void> | void,
    ): Promise<boolean> => {
      try {
        await action();
        return true;
      } catch (caught) {
        retain(caught);
        (report.finalization ??= []).push({ stage, stop: stopDetails(caught) });
        return false;
      }
    };
    const structure = async () => {
      if (error) report.stop = stopDetails(error);
      report.limits = limitSignals.summary();
      reportPath = await writeStructure(
        options.workspace,
        runId,
        report,
        Boolean(reportPath),
      );
    };
    await finalize('answers', () => {
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
                itemIds: chosen.map(({ item }) => item.id),
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
      options.notice(`Stop detail: ${report.stop.token}\n`);
    }
    if (reportPath) options.notice(`Structure report: ${reportPath}\n`);
    const text = contextEnd(endReason, options.lang, Boolean(options.order));
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
        if (context) await deps.close(context, Boolean(options.order));
      });
      network?.dispose();
      pages?.dispose();
      await finalize('confirmation-close', () => confirmation.close());
      options.signal.removeEventListener('abort', stop);
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  }
  if (error)
    throw error instanceof CliError ? error : new CliError('CONTEXT_FAILED');
  return { completed, steps, runId, endReason };
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
