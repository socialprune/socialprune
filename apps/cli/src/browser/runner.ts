import { setTimeout as wait } from 'node:timers/promises';
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
import { profileWarning } from './copy.ts';
import {
  changedProfileFiles,
  profileSnapshot,
  validateProfile,
} from './profile.ts';
import type { BrowserDriver } from './x/driver.ts';
import { productionDriver } from './x/driver.ts';
import { dateInZone, productionPace } from './pace.ts';
import type { Pace } from './pace.ts';

export interface RunOptions {
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
async function dailyCount(
  store: SQLiteStore,
  account: string,
  mode: 'delete' | 'verify',
  day: string,
  zone: string,
) {
  const journal = await store.browserJournal();
  const runs = new Set(
    journal.runs
      .filter((run) => run.accountKey === account && run.mode === mode)
      .map((run) => run.runId),
  );
  return journal.attempts.filter(
    (a) =>
      runs.has(a.runId) &&
      (mode === 'delete'
        ? ['sending', 'not-found'].includes(a.state)
        : a.action === 'verify') &&
      dateInZone(a.at, zone) === day,
  ).length;
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
  if (before.extensions) throw new CliError('PROFILE_INVALID');
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
  const confirmation = await startConfirmation(
    {
      phase: 'start',
      warning: summary.warning,
      profileWarning: profileWarning(options.plan.handle),
      planned: summary.planned,
      bulk: summary.bulk,
      estimateMs: summary.estimateMs,
      list: options.list,
      rows: options.plan.rows
        .slice(0, 20)
        .map((row) => displayRow(row, options.plan.timeZone)),
      completed: 0,
      result: options.verify
        ? 'Read-only verification. No deletion clicks.'
        : 'Watch the first entry of each action before continuing.',
    },
    dependencies.confirmationPort,
  );
  let browser: BrowserDriver | undefined;
  let accountBefore: string | null = null,
    accountAfter: string | null = null;
  let began = false;
  let error: unknown;
  let completed = 0;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal.addEventListener('abort', abort, { once: true });
  confirmation.onStop(abort);
  const signalHandler = () => controller.abort();
  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);
  const checkStop = () => {
    if (
      options.signal.aborted ||
      controller.signal.aborted ||
      confirmation.stopped
    )
      throw new CliError('CANCELLED');
  };
  try {
    checkStop();
    options.notice(
      summary.warning + '\n' + profileWarning(options.plan.handle) + '\n',
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
      confirmationOrigin: new URL(confirmation.url).origin,
      record: (request) => writer.request(run.runId, request),
    });
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
    accountBefore = await browser.account();
    checkStop();
    if (accountBefore.toLowerCase() !== options.plan.handle.toLowerCase())
      throw new CliError('ACCOUNT_MISMATCH');
    if ((await profileSnapshot(options.profile)).extensions)
      throw new CliError('PROFILE_INVALID');
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
        .filter(
          (value) =>
            value.accountKey === options.plan.accountKey && value.mode === mode,
        )
        .map((value) => value.runId),
    );
    const priorStarts = priorJournal.attempts
      .filter(
        (value) =>
          priorRuns.has(value.runId) &&
          (mode === 'delete'
            ? ['sending', 'not-found'].includes(value.state)
            : value.action === 'verify'),
      )
      .map((value) => Date.parse(value.at));
    let previousStart: number | null = priorStarts.length
      ? Math.max(...priorStarts)
      : null;
    let batch = 0;
    const pace = dependencies.pace;
    const ready = async () => {
      checkStop();
      if (
        dateInZone(options.now(), options.plan.timeZone) !== day ||
        used >= pace.perDay
      ) {
        run.endReason = 'daily-cap';
        return false;
      }
      if (batch >= pace.batchSize) {
        await dependencies.sleep(pace.pauseMs, controller.signal);
        batch = 0;
      }
      const delay =
        previousStart === null
          ? 0
          : Math.max(
              0,
              previousStart + pace.intervalMs - options.now().getTime(),
            );
      if (delay) await dependencies.sleep(delay, controller.signal);
      checkStop();
      if (dateInZone(options.now(), options.plan.timeZone) !== day) {
        run.endReason = 'daily-cap';
        return false;
      }
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
      }
    } else {
      const canaries = new Set<string>();
      for (const row of inOrder(options.plan.rows)) {
        if (!(await ready())) break;
        const withdrawn = await writer.check(
          row,
          run.runId,
          options.now().toISOString(),
          false,
        );
        if (withdrawn) continue;
        const state = await browser.inspect(row.item.id.slice(2));
        checkStop();
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
          used++;
          batch++;
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
        used++;
        batch++;
        await deleteOne(writer, browser, row, sending, run, () =>
          options.now(),
        );
        completed++;
        confirmation.update({
          completed,
          result: `${completed} entries completed.`,
        });
        options.notice(`${completed} entries completed.\n`);
        if (!canaries.has(row.action)) {
          canaries.add(row.action);
          confirmation.update({
            phase: 'canary',
            result: `First ${row.action} completed. Check the platform tab before Continue. Post: https://x.com/i/web/status/${row.item.id.slice(2)}`,
          });
          if (
            !(await Promise.race([confirmation.wait('continue'), cancelWait]))
          )
            throw new CliError('CANCELLED');
        }
      }
    }
    run.endReason ??= 'done';
  } catch (caught) {
    error = caught;
    run.endReason =
      controller.signal.aborted ||
      options.signal.aborted ||
      (caught instanceof CliError && caught.code === 'CANCELLED')
        ? 'stopped-by-person'
        : caught instanceof CliError &&
            ['PLATFORM_CHECK', 'ACCOUNT_MISMATCH', 'PROFILE_INVALID'].includes(
              caught.code,
            )
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
          after.extensions ||
          (accountBefore && accountBefore !== accountAfter)
        ) {
          run.endReason = 'platform-check';
          error ??= new CliError('PLATFORM_CHECK');
        }
        run.endedAt = options.now().toISOString();
        await writer.finish(run);
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
      confirmation.update({
        phase: 'ended',
        completed,
        result: `Run ended: ${run.endReason ?? 'stopped-by-person'}. Close the browser window to finish.`,
      });
      await confirmation.close();
      options.signal.removeEventListener('abort', abort);
      process.removeListener('SIGINT', signalHandler);
      process.removeListener('SIGTERM', signalHandler);
    }
  }
  // Production keeps its visible window until the person closes it. Tests close
  // their disposable context through their injected driver after the read-back.
  if (browser) await browser.close();
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
  if (answer.state !== 'deleted') throw new CliError('RUN_STOPPED');
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
