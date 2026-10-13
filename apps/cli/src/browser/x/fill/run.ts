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
} from '../../copy.ts';
import { xSelectors } from '../selectors.ts';
import { statusUrl, X_ORIGIN, X_ALLOWED_HOSTS } from '../driver.ts';
import { restrictOrigins } from '../../network.ts';
import { FillOrderSchema } from './order.ts';
import type { FillOrder } from './order.ts';
import { compareFocal, compareNotice } from './compare.ts';
import type { CanaryComparison } from './compare.ts';
import { dateInZone } from '../../pace.ts';
import { SQLiteStore } from '../../../workspace/sqlite-store.ts';
import { CliError } from '../../../cli/errors.ts';
import { planFill, fillSummary } from './plan.ts';
import type { FillPlan } from './plan.ts';
import { isPostAnswer, unexpectedAction } from './read.ts';
import { extract } from './extract.ts';
import { structureReport } from './report.ts';
import { SyndicationClient } from '../../../originals/syndication.ts';
import { storeOriginalMedia } from '../../../originals/store-media.ts';
import { cleanupParts, originalDirectory } from '../../../originals/media.ts';
import { productionMedia } from '../../../originals/video.ts';
import type { MediaDependencies } from '../../../originals/video.ts';
import { setTimeout as sleep } from 'node:timers/promises';

export interface FillOptions {
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
  launch(profile: string, executablePath: string): Promise<BrowserContext>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  close(context: BrowserContext, automatic?: boolean): Promise<void>;
}
export const FILL_PACE = Object.freeze({
  intervalMs: 30000,
  batch: 20,
  pauseMs: 900000,
  perDay: 200,
});
const production: FillDependencies = {
  origin: X_ORIGIN,
  port: 0,
  responseMs: 30000,
  intervalMs: FILL_PACE.intervalMs,
  batch: FILL_PACE.batch,
  pauseMs: FILL_PACE.pauseMs,
  media: productionMedia,
  syndication: new SyndicationClient(),
  async launch(profile, executablePath) {
    const { chromium } = await import('playwright-core');
    return chromium.launchPersistentContext(profile, {
      executablePath,
      headless: false,
      // Keep the browser sandbox on and every Playwright automation sign visible.
      chromiumSandbox: true,
      args: ['--enable-automation'],
      serviceWorkers: 'block',
      ignoreDefaultArgs: ['--disable-infobars'],
    });
  },
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
): Promise<{ body: unknown; state: 'present' | 'gone' }> {
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
  await xSelectors.rendered(
    page,
    page
      .getByTestId('SideNav_AccountSwitcher_Button')
      .or(page.getByTestId('error-detail')),
    Math.min(20_000, deps.responseMs),
  );
  const answer = await response;
  if (
    answer &&
    (answer.status() !== 200 ||
      !answer.headers()['content-type']?.startsWith('application/json'))
  )
    throw new CliError('PLATFORM_CHECK');
  if (!answer) {
    const state = await xSelectors.state(page, id);
    if (state === 'gone') return { body: null, state };
    throw new CliError('PLATFORM_CHECK');
  }
  const length = answer.headers()['content-length'];
  if (length && Number(length) > 8 * 1024 ** 2)
    throw new CliError('SHAPE_CHANGED');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bytes = await Promise.race([
    answer.body(),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new CliError('PLATFORM_CHECK')),
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
      classified.kind === 'tombstone' || classified.kind === 'unavailable'
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
  const summary = fillSummary(options.plan, options.lang),
    confirmation = await startConfirmation(
      {
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
          (options.mediaNotice ?? ''),
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
      },
      deps.port,
    );
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
  const abortedHosts: Record<string, number> = {};
  let context: BrowserContext | undefined,
    page: Page | undefined,
    accountBefore: string | null = null,
    accountAfter: string | null = null,
    began = false,
    completed = 0,
    stop = false,
    action = false,
    error: unknown;
  let cancelWait: () => void = () => {};
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
  };
  try {
    options.notice(summary.warning + '\n');
    const started = options.order
      ? Promise.resolve(true)
      : confirmation.wait('start');
    context = await deps.launch(options.profile, options.executablePath);
    const allowed =
      deps.origin === X_ORIGIN
        ? X_ALLOWED_HOSTS.map((host) => `https://${host}`)
        : [deps.origin];
    allowed.push(new URL(confirmation.url).origin);
    await restrictOrigins(context, allowed, abortedHosts);
    context.once('close', stopped);
    const local = context.pages()[0] ?? (await context.newPage());
    await local.goto(confirmation.launchUrl);
    options.notice(`Confirmation: ${confirmation.url}\n`);
    if (!(await Promise.race([started, cancellation])))
      throw new CliError('CANCELLED');
    check();
    if (
      (await planFill(options.store, options.plan.accountKey, options.include))
        .hash !== options.plan.hash
    )
      throw new CliError('STALE_PLAN');
    const active = await options.store.browserJournal();
    for (const prior of active.runs)
      if (prior.accountKey === options.plan.accountKey && !prior.endedAt) {
        if (!prior.ownerPid) throw new CliError('WORKSPACE_BUSY');
        let alive = true;
        try {
          process.kill(prior.ownerPid, 0);
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ESRCH'
          )
            alive = false;
        }
        if (alive) throw new CliError('WORKSPACE_BUSY');
      }
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
      throw new CliError('PLATFORM_CHECK');
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
    page = await context.newPage();
    // /home is used once for the account check. Read-back uses the current page.
    await page.goto(deps.origin + '/home', { waitUntil: 'domcontentloaded' });
    accountBefore = await xSelectors.account(
      page,
      Math.min(20_000, deps.responseMs),
    );
    if (accountBefore.toLowerCase() !== options.plan.handle.toLowerCase())
      throw new CliError('ACCOUNT_MISMATCH');
    check();
    await cleanupParts(options.workspace);
    const day = dateInZone(options.now(), options.plan.timeZone);
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
          if (dateInZone(run.startedAt, options.plan.timeZone) === day)
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
          dateInZone(attempt.at, options.plan.timeZone) === day
        ) {
          used++;
          last = Math.max(last, Date.parse(attempt.at));
        }
      for await (const attempt of tx.browserAttempts.iterate())
        if (
          accounts.has(attempt.runId) &&
          attempt.state === 'sending' &&
          dateInZone(attempt.at, options.plan.timeZone) === day
        )
          lastBatch.push(Date.parse(attempt.at));
    });
    lastBatch.sort((a, b) => a - b);
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
        options.order?.value.maxPages ?? 200,
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
    for (const row of candidates) {
      check();
      if (extensionsChanged(before, await profileSnapshot(options.profile)))
        throw new CliError('PLATFORM_CHECK');
      const existing = await options.store.read((tx) =>
        tx.originals.get(row.id),
      );
      if (
        existing?.signedIn?.runId === runId &&
        existing.signedIn.status === 'read'
      )
        continue;
      if (
        used >= FILL_PACE.perDay ||
        dateInZone(options.now(), options.plan.timeZone) !== day
      ) {
        run.endReason = 'daily-cap';
        break;
      }
      if (batch >= deps.batch) {
        await Promise.race([
          deps.sleep(deps.pauseMs, mediaSignal),
          cancellation,
        ]);
        batch = 0;
      }
      const delay = last + deps.intervalMs - options.now().getTime();
      if (delay > 0)
        await Promise.race([deps.sleep(delay, mediaSignal), cancellation]);
      check();
      if (dateInZone(options.now(), options.plan.timeZone) !== day) {
        run.endReason = 'daily-cap';
        break;
      }
      if (extensionsChanged(before, await profileSnapshot(options.profile)))
        throw new CliError('PLATFORM_CHECK');
      const attemptId = crypto.randomUUID();
      await writer.sending({
        attemptId,
        runId,
        originalId: row.id,
        at: options.now().toISOString(),
      });
      last = options.now().getTime();
      used++;
      batch++;
      try {
        const answer = await pageAnswer(page, row.id, deps);
        if (extensionsChanged(before, await profileSnapshot(options.profile)))
          throw new CliError('PLATFORM_CHECK');
        check();
        const extracted =
          answer.body === null
            ? { kind: 'no-entry' as const }
            : extract(answer.body, row.id, lock);
        if (answer.body !== null)
          reports.push(
            structureReport(
              answer.body,
              extracted.kind === 'shape-changed'
                ? extracted.path
                : extracted.kind === 'no-entry' && answer.state !== 'gone'
                  ? 'no-entry'
                  : undefined,
            ),
          );
        if (extracted.kind === 'shape-changed')
          throw new CliError('SHAPE_CHANGED');
        if (extracted.kind === 'no-entry' && answer.state !== 'gone')
          throw new CliError('SHAPE_CHANGED');
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
              !options.include.has(post.id)
            )
              continue;
            const record: Original = {
              ...post,
              media: post.media.map((media) => {
                const stored = old?.media.find(
                  (value) =>
                    value.n === media.n &&
                    value.kind === media.kind &&
                    value.url === media.url &&
                    value.status === 'stored',
                );
                return stored
                  ? {
                      ...media,
                      status: stored.status,
                      file: stored.file,
                      poster: stored.poster,
                      bytes: stored.bytes,
                    }
                  : media;
              }),
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
        if (options.order) {
          const stored = await options.store.read((tx) =>
            tx.originals.get(row.id),
          );
          let comparison: CanaryComparison;
          try {
            if (!stored) throw new Error('Missing stored original');
            comparison =
              extracted.kind === 'read'
                ? await compareFocal(page, stored)
                : await compareNotice(
                    page,
                    extracted.kind === 'no-entry'
                      ? 'not-found'
                      : extracted.kind,
                  );
          } catch {
            comparison = {
              stored: {
                textLength: stored?.text?.length ?? 0,
                photos:
                  stored?.media.filter((media) => media.kind === 'photo')
                    .length ?? 0,
                videos:
                  stored?.media.filter((media) => media.kind !== 'photo')
                    .length ?? 0,
              },
              shown: { textLength: 0, photos: 0, videos: 0 },
              matches: false,
            };
          }
          canaryCounts.push(comparison);
          if (!comparison.matches) {
            await options.store
              .browserOutcomeWriter()
              .recordCanaryMismatch(runId, canaryCounts);
            options.notice(`Canary counts: ${JSON.stringify(canaryCounts)}\n`);
            throw new CliError('CANARY_MISMATCH');
          }
        }
        if (mediaFailure)
          throw mediaFailure instanceof Error
            ? mediaFailure
            : new CliError('MEDIA_FAILED');
        completed++;
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
            !(await Promise.race([confirmation.wait('continue'), cancellation]))
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
          .catch(() => undefined);
        throw caught;
      }
    }
    run.endReason ??= options.plan.canary && completed > 0 ? 'canary' : 'done';
  } catch (caught) {
    error = stop || options.signal.aborted ? new CliError('CANCELLED') : caught;
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
    if (began && (options.plan.canary || run.endReason === 'shape-changed')) {
      try {
        const directory = await originalDirectory(
          options.workspace,
          options.plan.rows[0]?.id ?? '0',
          true,
        );
        reportPath = join(directory, '..', `canary-${runId}.json`);
        await writeFile(reportPath, JSON.stringify(reports), { flag: 'wx' });
        options.notice(`Structure report: ${reportPath}\n`);
      } catch (caught) {
        error ??= caught;
      }
    }
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
          ]);
        }
        try {
          accountAfter =
            page && !page.isClosed()
              ? await xSelectors.account(
                  page,
                  Math.min(20_000, deps.responseMs),
                )
              : null;
        } catch (caught) {
          accountAfter = null;
          error ??= caught;
          run.endReason = 'platform-check';
        }
        const after = await profileSnapshot(options.profile);
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
          error ??= new CliError('PLATFORM_CHECK');
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
      }
    }
    const finalText = options.order
      ? endText(endReason(run.endReason, error), options.lang).replace(
          options.lang === 'de'
            ? 'Schließe das X-Fenster, um den Lauf zu beenden.'
            : 'Close the X window to finish.',
          options.lang === 'de'
            ? 'Das Browserfenster wird automatisch geschlossen.'
            : 'The browser window closes automatically.',
        )
      : endText(endReason(run.endReason, error), options.lang);
    confirmation.update({
      phase: 'ended',
      completed,
      result: finalText,
    });
    options.notice(finalText + '\n');
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
    } finally {
      try {
        await confirmation.close();
      } finally {
        options.signal.removeEventListener('abort', stopped);
        process.removeListener('SIGINT', stopped);
        process.removeListener('SIGTERM', stopped);
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
