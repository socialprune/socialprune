import { setTimeout as wait } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CliError } from '../cli/errors.ts';
import type { SQLiteStore } from '../workspace/sqlite-store.ts';
import type {
  BrowserAttempt,
  BrowserOutcomeWriter,
  BrowserRun,
  PlannedEntry,
} from '../workspace/browser-journal.ts';
import { startConfirmation } from './confirmation.ts';
import { displayRow, planSummary, planDeletion } from './plan.ts';
import type { DeletePlan } from './plan.ts';
import {
  profileWarning,
  EXTENSION_NOTICE,
  START_STATUS,
  endText,
  endReason,
} from './copy.ts';
import {
  changedProfileFiles,
  profileSnapshot,
  validateProfile,
  extensionsChanged,
  writeExtensionReport,
} from './profile.ts';
import type { BrowserDriver } from './x/driver.ts';
import { productionDriver } from './x/driver.ts';
import { dateInZone, productionPace } from './pace.ts';
import type { Pace } from './pace.ts';
import type { WindowPlacement } from './launch.ts';
import { entryView } from './run-session.ts';
import type { RunSession } from './run-session.ts';
import { cleanDeletions, deletionPace } from './x/delete-pace.ts';
import { XResponseWindows } from './x/rate-windows.ts';
import { errorStop } from './x/fill/report.ts';
import { rateWindow } from './confirmation-state.ts';
import type { XRateWindow } from '@socialprune/core/workspace/desktop-protocol';

export interface RunOptions {
  session?: RunSession;
  windowPlacement?: WindowPlacement;
  store: SQLiteStore;
  plan: DeletePlan;
  profile: string;
  executablePath: string;
  verify: boolean;
  perDay?: number;
  list: string;
  include?: ReadonlySet<string>;
  lang: 'en' | 'de';
  signal: AbortSignal;
  now(): Date;
  notice(text: string): void;
}
/** Injected dependencies are used only by the test entrypoint, never by CLI flags or environment. */
export interface RunDependencies {
  pace: Pace;
  confirmationPort: number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  driver: typeof productionDriver;
}
export async function dailyCount(
  store: SQLiteStore,
  account: string,
  mode: 'delete' | 'verify',
  day: string,
  zone: string,
) {
  const journal = await store.browserJournal();
  const runs = new Set(
    journal.runs
      .filter((run) => run.accountKey === account)
      .map((run) => run.runId),
  );
  const precise = journal.runs
    .filter(
      (run) =>
        run.accountKey === account &&
        run.pageOpens !== undefined &&
        dateInZone(run.startedAt, zone) === day,
    )
    .reduce((sum, run) => sum + run.pageOpens!, 0);
  const legacy = new Set(
    journal.runs
      .filter((run) => run.pageOpens === undefined)
      .map((run) => run.runId),
  );
  return (
    precise +
    journal.attempts.filter(
      (a) =>
        runs.has(a.runId) &&
        legacy.has(a.runId) &&
        (a.state === 'sending' ||
          a.action === 'verify' ||
          (a.state === 'not-found' && a.settles === null)) &&
        dateInZone(a.at, zone) === day,
    ).length
  );
}
function inOrder(rows: PlannedEntry[]): PlannedEntry[] {
  const oldest = [...rows].sort(
    (a, b) =>
      a.item.createdAt.localeCompare(b.item.createdAt) ||
      a.item.id.localeCompare(b.item.id),
  );
  const canaries = ['delete-post', 'undo-repost'].flatMap(
    (action) => oldest.find((row) => row.action === action) ?? [],
  );
  return [...canaries, ...oldest.filter((row) => !canaries.includes(row))];
}
export async function runWithDependencies(
  options: RunOptions,
  dependencies: RunDependencies,
) {
  await validateProfile(options.profile);
  const before = await profileSnapshot(options.profile);
  const mode = options.verify ? 'verify' : 'delete';
  const run: BrowserRun = {
    runId: crypto.randomUUID(),
    platform: 'x',
    accountKey: options.plan.accountKey,
    mode,
    planHash: options.verify ? null : options.plan.hash,
    startedAt: options.now().toISOString(),
    endedAt: null,
    endReason: null,
    bodyShapes: {},
    profileReport: null,
    ownerPid: process.pid,
  };
  const writer = options.store.browserOutcomeWriter();
  const summary = planSummary(options.plan, options.lang);
  const confirmation = await (
    options.session?.confirmation ??
    ((initial) => startConfirmation(initial, dependencies.confirmationPort))
  )({
    phase: 'start',
    lang: options.lang,
    expectedHandle: options.plan.handle,
    warning: summary.warning,
    profileWarning:
      profileWarning(options.plan.handle, options.lang) +
      ' ' +
      EXTENSION_NOTICE[options.lang],
    planned: summary.planned,
    bulk: summary.bulk,
    estimateMs: summary.estimateMs,
    list: options.list,
    rows: options.plan.rows
      .slice(0, 20)
      .map((row) => displayRow(row, options.plan.timeZone)),
    completed: 0,
    result: START_STATUS[options.verify ? 'verify' : 'delete'][options.lang],
  });
  let browser: BrowserDriver | undefined;
  let accountBefore: string | null = null,
    accountAfter: string | null = null;
  let began = false;
  let error: unknown;
  let completed = 0;
  let rateLimited = false;
  let longWindow = false;
  const rateController = new AbortController();
  const waitSignal = AbortSignal.any([options.signal, rateController.signal]);
  let rejectRateLimit: (error: CliError) => void = () => {};
  const rateStop = new Promise<never>((_resolve, reject) => {
    rejectRateLimit = reject;
  });
  void rateStop.catch(() => undefined);
  const desktopWindows = new Map<string, XRateWindow>();
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener('abort', abort, { once: true });
  confirmation.onStop(abort);
  const signalHandler = () => controller.abort();
  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);
  const checkStop = () => {
    if (rateLimited)
      throw new CliError('PLATFORM_CHECK', undefined, undefined, 'http-429');
    if (
      options.signal.aborted ||
      controller.signal.aborted ||
      confirmation.stopped
    )
      throw new CliError('CANCELLED');
  };
  try {
    options.session?.before(before, null);
    checkStop();
    options.notice(
      summary.warning + '\n' + profileWarning(options.plan.handle) + '\n',
    );
    options.notice(
      'Extensions are disabled for this run. SocialPrune writes its own profile read-back JSON file with the before/after extension ID sets.\n',
    );
    options.notice(
      'Steps: check the signed-in account, open each planned post, use More/Delete/confirm or Undo repost, then read the profile back.\n',
    );
    const started = confirmation.wait('start');
    browser = await dependencies.driver({
      profile: options.profile,
      executablePath: options.executablePath,
      signal: controller.signal,
      onClosed: () => controller.abort(),
      confirmationOrigin: options.session
        ? undefined
        : new URL(confirmation.url).origin,
      onLaunched: (close) => options.session?.browser(close),
      record: (request) => writer.request(run.runId, request),
      windowPlacement: options.windowPlacement,
      desktop: Boolean(options.session),
      now: () => options.now(),
      onRateLimit() {
        rateLimited = true;
        rejectRateLimit(
          new CliError('PLATFORM_CHECK', undefined, undefined, 'http-429'),
        );
        rateController.abort();
      },
      onWindow(url, headers) {
        if (!options.session) return;
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
            new URL(url).pathname.match(
              /^\/i\/api\/graphql\/[^/]+\/([A-Za-z0-9_]{1,64})\/?$/,
            )?.[1] ?? 'other';
          const window = rateWindow(operation, limit, remaining, reset * 1000);
          desktopWindows.set(
            `${window.operation}|${window.operationName ?? ''}`,
            window,
          );
          options.session.update({ xWindows: [...desktopWindows.values()] });
        }
      },
    });
    if (!options.session)
      await browser.showConfirmation(confirmation.launchUrl);
    options.notice(
      `Confirmation at ${confirmation.url}. Click Start in that window.\n`,
    );
    const cancelWait = new Promise<false>((resolve) =>
      controller.signal.addEventListener('abort', () => resolve(false), {
        once: true,
      }),
    );
    if (!(await Promise.race([started, cancelWait])))
      throw new CliError('CANCELLED');
    checkStop();
    if (
      !options.verify &&
      (
        await planDeletion(
          options.store,
          options.plan.accountKey,
          options.include,
        )
      ).hash !== options.plan.hash
    )
      throw new CliError('STALE_PLAN');
    await writer.begin(run);
    began = true;
    checkStop();
    if (extensionsChanged(before, await profileSnapshot(options.profile)))
      throw new CliError('PLATFORM_CHECK');
    accountBefore = await browser.account();
    checkStop();
    if (accountBefore.toLowerCase() !== options.plan.handle.toLowerCase())
      throw new CliError('ACCOUNT_MISMATCH');
    options.session?.before(before, accountBefore);
    const language = options.session ? await browser.language?.() : undefined;
    const resumeChecks = async () => {
      checkStop();
      if (extensionsChanged(before, await profileSnapshot(options.profile)))
        throw new CliError('PLATFORM_CHECK');
      if (
        (await browser!.account()).toLowerCase() !==
        options.plan.handle.toLowerCase()
      )
        throw new CliError('ACCOUNT_MISMATCH');
      if ((await browser!.language?.()) !== language)
        throw new CliError('PAGE_LANGUAGE');
    };
    const controls = options.session?.controls;
    const boundaryWait = async (ms: number) => {
      if (controls)
        await controls.delay(
          ms,
          (duration, signal) => dependencies.sleep(duration, signal),
          resumeChecks,
          AbortSignal.any([controller.signal, waitSignal]),
          (remaining, next) => options.session?.waiting(remaining, next),
        );
      else
        await dependencies.sleep(
          ms,
          AbortSignal.any([controller.signal, waitSignal]),
        );
    };
    if (extensionsChanged(before, await profileSnapshot(options.profile)))
      throw new CliError('PLATFORM_CHECK');
    const day = dateInZone(options.now(), options.plan.timeZone);
    let used = await dailyCount(
      options.store,
      options.plan.accountKey,
      mode,
      day,
      options.plan.timeZone,
    );
    const priorJournal = await options.store.browserJournal();
    const priorRuns = new Set(
      priorJournal.runs
        .filter((value) => value.accountKey === options.plan.accountKey)
        .map((value) => value.runId),
    );
    const priorStarts = [
      ...priorJournal.runs
        .filter(
          (run) =>
            run.accountKey === options.plan.accountKey && run.lastPageOpenedAt,
        )
        .map((run) => Date.parse(run.lastPageOpenedAt!)),
      ...priorJournal.attempts
        .filter(
          (value) =>
            priorRuns.has(value.runId) &&
            (value.state === 'sending' ||
              value.action === 'verify' ||
              (value.state === 'not-found' && value.settles === null)),
        )
        .map((value) => Date.parse(value.at)),
    ];
    let previousStart: number | null = priorStarts.length
      ? Math.max(...priorStarts)
      : null;
    let batch = 0;
    let lastPace = '';
    const windows = browser.rateWindows ?? new XResponseWindows();
    const effectivePace = async () => {
      if (options.verify) return dependencies.pace;
      const stage = deletionPace(
        cleanDeletions(
          await options.store.browserJournal(),
          options.plan.accountKey,
        ),
        windows,
        options.now().getTime(),
      );
      const pace = {
        ...dependencies.pace,
        // Scale injected clocks with the same production stage ratios.
        intervalMs: Math.ceil(
          (dependencies.pace.intervalMs * stage.intervalMs) / 30000,
        ),
        perDay: Math.min(
          stage.perDay,
          options.perDay ??
            (dependencies.pace.perDay === 200
              ? stage.perDay
              : dependencies.pace.perDay),
        ),
      };
      const paceKey = `${pace.intervalMs}|${pace.perDay}`;
      if (paceKey !== lastPace) {
        options.notice(
          options.lang === 'de'
            ? `Löschtempo: mindestens ${pace.intervalMs / 1000} Sekunden zwischen Einträgen, höchstens ${pace.perDay} pro Kalendertag (${options.plan.timeZone}).\n`
            : `Deletion pace: at least ${pace.intervalMs / 1000} seconds between entries, at most ${pace.perDay} per calendar day (${options.plan.timeZone}).\n`,
        );
        lastPace = paceKey;
      }
      options.session?.update({
        pace: {
          secondsPerStep: pace.intervalMs / 1000,
          batchSize: pace.batchSize,
          batchPauseMs: pace.pauseMs,
        },
        today: {
          date: day,
          timeZone: options.plan.timeZone,
          used,
          cap: pace.perDay,
          unit: 'pages',
          sharedWithXDeleteAndFill: true,
        },
      });
      return pace;
    };
    const windowReady = async () => {
      if (options.verify) return true;
      for (;;) {
        checkStop();
        const window = windows.beforeDeletion(options.now().getTime());
        if (window.kind === 'ready') return true;
        if (window.kind === 'long') {
          longWindow = true;
          run.endReason = 'daily-cap';
          return false;
        }
        options.session?.update({
          phase: 'rate-wait',
          remainingMs: window.ms,
          resetAt: new Date(
            options.now().getTime() + window.ms - 5000,
          ).toISOString(),
        });
        await Promise.race([boundaryWait(window.ms), rateStop]);
        options.session?.update({ phase: 'running' });
      }
    };
    const ready = async () => {
      checkStop();
      const pausedBefore = controls?.pausedMs ?? 0;
      await controls?.checkpoint(resumeChecks, controller.signal);
      if (previousStart !== null)
        previousStart += (controls?.pausedMs ?? 0) - pausedBefore;
      if (extensionsChanged(before, await profileSnapshot(options.profile)))
        throw new CliError('PLATFORM_CHECK');
      if (!(await windowReady())) return false;
      let pace = await effectivePace();
      if (
        dateInZone(options.now(), options.plan.timeZone) !== day ||
        used >= pace.perDay
      ) {
        run.endReason = 'daily-cap';
        return false;
      }
      if (batch >= pace.batchSize) {
        options.session?.update({
          phase: 'batch-pause',
          remainingMs: pace.pauseMs,
          until: new Date(options.now().getTime() + pace.pauseMs).toISOString(),
        });
        await boundaryWait(pace.pauseMs);
        options.session?.update({ phase: 'running' });
        batch = 0;
      }
      for (;;) {
        if (!(await windowReady())) return false;
        pace = await effectivePace();
        const delay =
          previousStart === null
            ? 0
            : Math.max(
                0,
                previousStart + pace.intervalMs - options.now().getTime(),
              );
        if (!delay) break;
        options.session?.update({
          nextStepAt: new Date(options.now().getTime() + delay).toISOString(),
        });
        await boundaryWait(delay);
        checkStop();
      }
      checkStop();
      if (dateInZone(options.now(), options.plan.timeZone) !== day) {
        run.endReason = 'daily-cap';
        return false;
      }
      if (extensionsChanged(before, await profileSnapshot(options.profile)))
        throw new CliError('PLATFORM_CHECK');
      // The page can have delivered another window while the pace timer ran.
      if (!(await windowReady())) return false;
      await controls?.checkpoint(resumeChecks, controller.signal);
      previousStart = options.now().getTime();
      return true;
    };
    if (options.verify) {
      const journal = await options.store.browserJournal();
      const accountRuns = new Set(
        journal.runs
          .filter((value) => value.accountKey === options.plan.accountKey)
          .map((value) => value.runId),
      );
      const candidates = journal.attempts.filter(
        (attempt) =>
          accountRuns.has(attempt.runId) &&
          ((['sending', 'ambiguous'].includes(attempt.state) &&
            !journal.attempts.some(
              (other) => other.settles === attempt.attemptId,
            )) ||
            (attempt.state === 'deleted' &&
              options.now().getTime() - Date.parse(attempt.at) >=
                7 * 86_400_000 &&
              !journal.attempts.some(
                (other) =>
                  other.action === 'verify' &&
                  other.itemId === attempt.itemId &&
                  Date.parse(other.at) >= Date.parse(attempt.at),
              ))),
      );
      for (const attempt of candidates) {
        if (!(await ready())) break;
        const stored = await options.store.read((tx) =>
          tx.items.get(attempt.itemId),
        );
        options.session?.entry(
          stored ? entryView(stored.item, 'verify') : null,
        );
        await writer.pageOpen(run.runId, options.now().toISOString());
        options.session?.progress(
          used + 1,
          completed,
          (await options.store.browserJournal()).attempts.filter(
            (a) => a.runId === run.runId,
          ),
        );
        const state = await browser.inspect(attempt.itemId.slice(2));
        const at = options.now().toISOString();
        if (['sending', 'ambiguous'].includes(attempt.state)) {
          await writer.record({
            attemptId: crypto.randomUUID(),
            runId: run.runId,
            itemId: attempt.itemId,
            action: 'verify',
            state: state === 'gone' ? 'still-gone' : 'not-deleted',
            settles: null,
            at,
            code: null,
          });
          await writer.settle(
            {
              attemptId: crypto.randomUUID(),
              runId: attempt.runId,
              itemId: attempt.itemId,
              action: attempt.action,
              state: state === 'gone' ? 'deleted' : 'not-deleted',
              settles: attempt.attemptId,
              at,
              code: null,
            },
            state === 'gone' ? 'deleted-via-browser' : undefined,
          );
        } else {
          await writer.settle(
            {
              attemptId: crypto.randomUUID(),
              runId: run.runId,
              itemId: attempt.itemId,
              action: 'verify',
              state: state === 'gone' ? 'still-gone' : 'reappeared',
              settles: null,
              at,
              code: null,
            },
            state === 'present' ? 'unknown' : undefined,
          );
        }
        used++;
        batch++;
        completed++;
        options.session?.progress(
          used,
          completed,
          (await options.store.browserJournal()).attempts.filter(
            (a) => a.runId === run.runId,
          ),
        );
      }
    } else {
      const canaries = new Set<string>();
      for (const row of inOrder(options.plan.rows)) {
        if (!(await ready())) break;
        options.session?.entry(entryView(row.item, row.action));
        const withdrawn = await writer.check(
          row,
          run.runId,
          options.now().toISOString(),
          false,
        );
        if (withdrawn) continue;
        await writer.pageOpen(run.runId, options.now().toISOString());
        options.session?.progress(
          used + 1,
          completed,
          (await options.store.browserJournal()).attempts.filter(
            (a) => a.runId === run.runId,
          ),
        );
        const state = await browser.inspect(row.item.id.slice(2));
        if (extensionsChanged(before, await profileSnapshot(options.profile)))
          throw new CliError('PLATFORM_CHECK');
        used++;
        batch++;
        checkStop();
        if (!(await windowReady())) break;
        if (dateInZone(options.now(), options.plan.timeZone) !== day) {
          run.endReason = 'daily-cap';
          break;
        }
        if (state === 'gone') {
          await writer.record({
            attemptId: crypto.randomUUID(),
            runId: run.runId,
            itemId: row.item.id,
            action: row.action,
            state: 'not-found',
            settles: null,
            at: options.now().toISOString(),
            code: null,
          });
          continue;
        }
        checkStop();
        const sending = await writer.check(
          row,
          run.runId,
          options.now().toISOString(),
          true,
        );
        if (sending?.state === 'withdrawn') continue;
        if (!sending) throw new CliError('WORKSPACE_INVALID');
        await deleteOne(writer, browser, row, sending, run, () =>
          options.now(),
        );
        checkStop();
        completed++;
        options.session?.progress(
          used,
          completed,
          (await options.store.browserJournal()).attempts.filter(
            (a) => a.runId === run.runId,
          ),
        );
        confirmation.update({
          completed,
          result:
            options.lang === 'de'
              ? `${completed} Einträge abgeschlossen.`
              : `${completed} entries completed.`,
        });
        options.notice(
          options.lang === 'de'
            ? `${completed} Einträge abgeschlossen.\n`
            : `${completed} entries completed.\n`,
        );
        if (!canaries.has(row.action)) {
          canaries.add(row.action);
          confirmation.update({
            phase: 'canary',
            result:
              options.lang === 'de'
                ? `Die erste Aktion ${row.action === 'delete-post' ? 'Beitrag löschen' : 'Repost rückgängig machen'} ist abgeschlossen. Prüfe den Plattform-Tab, bevor du Weiter klickst. Beitrag: https://x.com/i/web/status/${row.item.id.slice(2)}`
                : `First ${row.action} completed. Check the platform tab before Continue. Post: https://x.com/i/web/status/${row.item.id.slice(2)}`,
          });
          if (
            !(await Promise.race([
              confirmation.wait('continue'),
              cancelWait,
              rateStop,
            ]))
          )
            throw new CliError('CANCELLED');
        }
      }
    }
    run.endReason ??= 'done';
  } catch (caught) {
    error = rateLimited
      ? new CliError('PLATFORM_CHECK', undefined, undefined, 'http-429')
      : caught;
    run.endReason =
      controller.signal.aborted ||
      options.signal.aborted ||
      (caught instanceof CliError && caught.code === 'CANCELLED')
        ? 'stopped-by-person'
        : error instanceof CliError &&
            [
              'PLATFORM_CHECK',
              'ACCOUNT_MISMATCH',
              'PROFILE_INVALID',
              'PAGE_LANGUAGE',
            ].includes(error.code)
          ? 'platform-check'
          : 'error';
  } finally {
    try {
      if (began) {
        try {
          await browser?.flush();
        } catch {
          run.endReason = 'platform-check';
          error ??= new CliError('PLATFORM_CHECK');
        }
        try {
          if (browser && accountBefore) accountAfter = await browser.account();
        } catch {
          error ??= new CliError('PLATFORM_CHECK');
          run.endReason = 'platform-check';
        }
        const after = await profileSnapshot(options.profile);
        const journal = await options.store.browserJournal();
        const requests = journal.requests.filter(
          (request) =>
            request.runId === run.runId &&
            !['DeleteTweet', 'DeleteRetweet'].includes(
              request.path.split('/').at(-1)!,
            ),
        );
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
          (accountBefore && accountBefore !== accountAfter)
        ) {
          run.endReason = 'platform-check';
          error ??= new CliError('PLATFORM_CHECK');
        }
        if (rateLimited) {
          error = new CliError(
            'PLATFORM_CHECK',
            undefined,
            undefined,
            'http-429',
          );
          run.endReason = 'platform-check';
        }
        run.endedAt = options.now().toISOString();
        await writer.finish(run);
        const report = await writeExtensionReport(
          options.profile,
          run.runId,
          before,
          after,
          run.profileReport,
          browser?.abortedHosts,
        );
        if (!options.verify) {
          const detail = error ? errorStop(error) : null;
          const path = join(
            options.profile,
            `socialprune-delete-${run.runId}.json`,
          );
          await writeFile(
            path,
            JSON.stringify({
              xWindows: browser?.rateWindows?.summary() ?? [],
              stop:
                detail ??
                (longWindow
                  ? { code: 'daily-cap', reason: 'x-window-long' }
                  : null),
            }),
            { flag: 'wx' },
          );
          options.notice(`Structure report: ${path}\n`);
        }
        options.notice(
          `Extensions disabled for this run. Before: ${JSON.stringify(before.extensionIds)}; after: ${JSON.stringify(after.extensionIds)}. Profile report: ${report}\n`,
        );
        options.notice(
          `Profile read-back: ${run.profileReport.changedFiles.length} changed files; ${requests.length} unexpected request records. The website's own code may send side requests.\n`,
        );
        for (const file of run.profileReport.changedFiles)
          options.notice(`Profile file: ${file}\n`);
        for (const request of requests)
          options.notice(
            `${request.method} ${request.host}${request.path} ${request.status ?? 'no response'}\n`,
          );
      }
    } catch (readbackError) {
      error ??= readbackError;
      run.endReason = 'error';
      options.notice(
        'Profile or journal read-back did not finish. The durable request journal remains available; no automatic retry will run.\n',
      );
    } finally {
      try {
        if (error) {
          const detail = errorStop(error);
          options.notice(`Stop detail: ${detail.reason ?? detail.code}\n`);
        } else if (longWindow) options.notice('Stop detail: x-window-long\n');
        if (browser?.rateWindows)
          options.notice(
            `X windows: ${JSON.stringify(browser.rateWindows.summary())}\n`,
          );
        confirmation.update({
          phase: 'ended',
          completed,
          result: endText(
            endReason(run.endReason ?? 'stopped-by-person', error),
            options.lang,
          ),
        });
        if (options.session) {
          const journal = await options.store.browserJournal();
          const used = await dailyCount(
            options.store,
            options.plan.accountKey,
            mode,
            dateInZone(options.now(), options.plan.timeZone),
            options.plan.timeZone,
          );
          options.session.progress(
            used,
            completed,
            journal.attempts.filter((a) => a.runId === run.runId),
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
        options.notice(
          endText(
            endReason(run.endReason ?? 'stopped-by-person', error),
            options.lang,
          ) + '\n',
        );
      } catch (projectionError) {
        error ??= projectionError;
        run.endReason = 'error';
        options.session?.failed(projectionError);
      } finally {
        try {
          if (browser) await browser.close();
        } finally {
          try {
            await confirmation.close();
          } finally {
            options.signal.removeEventListener('abort', abort);
            process.removeListener('SIGINT', signalHandler);
            process.removeListener('SIGTERM', signalHandler);
          }
        }
      }
    }
  }
  // Production keeps its visible window until the person closes it. Tests close
  // their disposable context through their injected driver after the read-back.
  if (error && run.endReason !== 'stopped-by-person')
    throw error instanceof CliError ? error : new CliError('RUN_STOPPED');
  return {
    runId: began ? run.runId : null,
    completed,
    endReason: run.endReason ?? 'stopped-by-person',
  };
}
async function deleteOne(
  writer: BrowserOutcomeWriter,
  browser: BrowserDriver,
  row: PlannedEntry,
  sending: BrowserAttempt,
  run: BrowserRun,
  now: () => Date,
) {
  let answer: Awaited<ReturnType<BrowserDriver['delete']>>;
  try {
    answer = await browser.delete(row.item.id.slice(2), row.action);
  } catch (error) {
    await writer.settle({
      attemptId: crypto.randomUUID(),
      runId: run.runId,
      itemId: row.item.id,
      action: row.action,
      state:
        error instanceof CliError && error.code === 'PLATFORM_CHECK'
          ? 'failed'
          : 'ambiguous',
      settles: sending.attemptId,
      at: now().toISOString(),
      code: error instanceof CliError ? error.code : 'BROWSER_INTERRUPTED',
    });
    throw error;
  }
  if (answer.state === 'deleted' && answer.receipt) {
    const first = run.bodyShapes[row.action];
    if (first && JSON.stringify(first) !== JSON.stringify(answer.receipt.shape))
      answer = { ...answer, state: 'failed', code: 'SHAPE_CHANGED' };
    else run.bodyShapes[row.action] ??= answer.receipt.shape;
  }
  await writer.settle(
    {
      attemptId: crypto.randomUUID(),
      runId: run.runId,
      itemId: row.item.id,
      action: row.action,
      state: answer.state,
      settles: sending.attemptId,
      at: now().toISOString(),
      code: answer.code,
      ...(answer.receipt ? { receipt: answer.receipt } : {}),
    },
    answer.state === 'deleted' ? 'deleted-via-browser' : undefined,
  );
  if (answer.state !== 'deleted')
    throw new CliError(
      answer.code === 'CONFIRMATION_MISSING' ? 'DELETE_FAILED' : 'RUN_STOPPED',
    );
}
export async function runBrowser(options: RunOptions) {
  const pace = productionPace(
    options.verify ? 'verify' : 'delete',
    options.perDay === undefined ? {} : { perDay: options.perDay },
  );
  return runWithDependencies(options, {
    pace,
    confirmationPort: 0,
    sleep: async (ms, signal) => {
      await wait(ms, undefined, { signal });
    },
    driver: productionDriver,
  });
}
