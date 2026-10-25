import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import type {
  BrowserRun as CoreRun,
  BrowserProfileReport,
} from '@socialprune/core';
import type { SQLiteStore } from '../../workspace/sqlite-store.ts';
import type {
  BrowserRun,
  BrowserAttempt,
} from '../../workspace/browser-journal.ts';
import { CliError } from '../../cli/errors.ts';
import { startConfirmation } from '../confirmation.ts';
import type { ConfirmationPort } from '../confirmation-state.ts';
import {
  validateProfile,
  profileInUse,
  profileSnapshot,
  changedProfileFiles,
  writeExtensionReport,
} from '../profile.ts';
import { profileWarning, EXTENSION_NOTICE } from '../copy.ts';
import { dateInZone } from '../pace.ts';
import { productionContext } from './driver.ts';
import type { ContextDependencies } from './driver.ts';
import { contextPages } from './pages.ts';
import { guardInstagramNetwork } from './network.ts';
import { LimitSignals } from './signals.ts';
import { ContextStop } from './report.ts';
import { InstagramDeletePermission } from './delete-permission.ts';
import { instagramWarningKind } from './warning.ts';
import {
  checkInstagramDeletePage,
  instagramDeleteIdentity,
  clickInstagramDelete,
  instagramDeleteUiConfirmed,
  InstagramDeleteStop,
  verifyInstagramComment,
  expandInstagramDeleteComment,
} from './delete-driver.ts';
import { instagramDeleteBudget } from '../../workspace/instagram-delete-pace.ts';
import { instagramDailyCount } from './pace.ts';
import {
  planInstagramDeletion,
  INSTAGRAM_DELETE_WARNING,
  INSTAGRAM_DELETION_PROTOCOL,
} from './delete-plan.ts';
import type { InstagramDeletePlan, InstagramDeleteRow } from './delete-plan.ts';
import { requireXWarningFileClear } from '../../workspace/x-warning-file.ts';

export interface InstagramDeleteOptions {
  store: SQLiteStore;
  workspace: string;
  plan: InstagramDeletePlan;
  profile: string;
  executablePath: string;
  lang: 'en' | 'de';
  list: string;
  verify: boolean;
  perDay?: number;
  now(this: void): Date;
  signal: AbortSignal;
  notice(text: string): void;
}
export interface InstagramDeleteDependencies extends ContextDependencies {
  confirmation: typeof startConfirmation;
  checkPage: typeof checkInstagramDeletePage;
  identity: typeof instagramDeleteIdentity;
  click: typeof clickInstagramDelete;
  uiConfirmed: typeof instagramDeleteUiConfirmed;
  verify: typeof verifyInstagramComment;
  expand: typeof expandInstagramDeleteComment;
}
const production: InstagramDeleteDependencies = {
  ...productionContext,
  confirmation: startConfirmation,
  checkPage: checkInstagramDeletePage,
  identity: instagramDeleteIdentity,
  click: clickInstagramDelete,
  uiConfirmed: instagramDeleteUiConfirmed,
  verify: verifyInstagramComment,
  expand: expandInstagramDeleteComment,
};
/** Production entry has no flags, environment values or endpoints selecting fakes.
 * Tests may inject dependencies only by importing this function. */
export async function runInstagramDeletion(
  options: InstagramDeleteOptions,
  deps: InstagramDeleteDependencies = production,
) {
  const { store, plan, now } = options;
  if (
    !options.verify &&
    (await planInstagramDeletion(store, plan.accountKey, now())).hash !==
      plan.hash
  )
    throw new CliError('STALE_PLAN');
  await validateProfile(options.profile, 'instagram');
  if (await profileInUse(options.profile))
    throw new CliError('PROFILE_INVALID');
  const writer = store.browserOutcomeWriter();
  writer.bindXWarningProfile(options.profile, 'instagram');
  const admit = async () => {
    if (options.verify) return;
    await writer.mirrorXWarning(plan.accountKey, options.profile, 'instagram');
    await requireXWarningFileClear(
      options.profile,
      now().toISOString(),
      plan.timeZone,
      'instagram',
    );
    await writer.requireXWarningClear(
      plan.accountKey,
      now().toISOString(),
      plan.timeZone,
      'instagram',
    );
  };
  await admit();
  const perDay = options.perDay ?? 50;
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > 50)
    throw new CliError('INVALID_ARGUMENTS');
  const initialPages = await instagramDailyCount(
    store,
    plan.accountKey,
    now(),
    plan.timeZone,
  );
  const initialAttempts = await instagramDeleteBudget(
    store,
    plan.accountKey,
    now(),
    plan.timeZone,
  );
  if (
    initialPages.used >= 200 ||
    (!options.verify && initialAttempts.used >= perDay)
  )
    return {
      runId: null,
      completed: 0,
      unverified: 0,
      endReason: 'daily-cap' as const,
      code: null,
    };
  const before = await profileSnapshot(options.profile);
  const run: BrowserRun = {
    runId: crypto.randomUUID(),
    platform: 'instagram',
    accountKey: plan.accountKey,
    mode: options.verify ? 'verify' : 'delete',
    planHash: plan.hash,
    startedAt: now().toISOString(),
    endedAt: null,
    endReason: null,
    bodyShapes: { 'deletion-protocol': [INSTAGRAM_DELETION_PROTOCOL] },
    profileReport: null,
    ownerPid: process.pid,
    pageOpens: 0,
    pageDays: {},
    pageZone: plan.timeZone,
  };
  let confirmation: ConfirmationPort | undefined,
    context: BrowserContext | undefined;
  let pages: ReturnType<typeof contextPages> | undefined;
  let network: Awaited<ReturnType<typeof guardInstagramNetwork>> | undefined;
  let page: Page | undefined,
    statusPage: Page | undefined,
    sending: BrowserAttempt | undefined;
  let began = false,
    finalClick = false,
    stopped = false,
    completed = 0,
    checked = false;
  let error: unknown,
    endReason: NonNullable<BrowserRun['endReason']> = 'done';
  let warning: CoreRun['instagramWarning'];
  let observedBefore: string | null = null,
    observedAfter: string | null = null,
    unverified = 0;
  const limits = new LimitSignals(),
    permission = new InstagramDeletePermission();
  let asyncFailure: ContextStop | undefined;
  const warningWrites = new Set<Promise<void>>();
  const retainWarning = (
    kind: NonNullable<CoreRun['instagramWarning']>['kind'],
  ) => {
    warning ??= { kind, at: now().toISOString(), zone: plan.timeZone };
    if (!began) return;
    const writing = writer.recordXWarning(
      run.runId,
      warning.at,
      warning.zone,
      warning.kind,
      'instagram',
    );
    warningWrites.add(writing);
    void writing.then(
      () => warningWrites.delete(writing),
      (caught: unknown) => {
        warningWrites.delete(writing);
        error ??= caught;
      },
    );
  };
  let wake!: () => void;
  const interrupted = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const abort = new AbortController();
  const stop = () => {
    stopped = true;
    abort.abort();
    wake();
  };
  const fail = (caught: unknown) => {
    if (error === undefined) error = caught;
    const kind =
      network?.warning ??
      instagramWarningKind(caught) ??
      (asyncFailure ? instagramWarningKind(asyncFailure) : undefined);
    if (kind && !warning) retainWarning(kind);
    endReason =
      warning ||
      (caught instanceof CliError && caught.code === 'PLATFORM_CHECK')
        ? 'platform-check'
        : caught instanceof CliError && caught.code === 'CANCELLED'
          ? 'stopped-by-person'
          : 'error';
  };
  const guard = () => {
    if (asyncFailure) throw asyncFailure;
    network?.check();
    pages?.check();
    if (stopped || options.signal.aborted) throw new CliError('CANCELLED');
  };
  const checkpoint = async () => {
    guard();
    const zone = await store.read(
      async (tx) =>
        (await tx.meta.get()).settings.timeZone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    if (zone !== plan.timeZone) throw new CliError('STALE_PLAN');
    if (
      (await profileSnapshot(options.profile)).extensionIds.some(
        (id) => !before.extensionIds.includes(id),
      )
    )
      throw new ContextStop('PLATFORM_CHECK', 'extensions-added');
    if (page && page.url() !== 'about:blank') {
      await deps.checkPage(page, plan.handle);
      observedBefore ??= plan.handle;
    }
    guard();
  };
  const pause = async (ms: number) => {
    await Promise.race([deps.sleep(ms, abort.signal), interrupted]);
    guard();
  };
  const waitIdentity = async (owned: Page, row: InstagramDeleteRow) => {
    const deadline = performance.now() + deps.responseMs;
    let stableAt: number | undefined;
    for (;;) {
      await checkpoint();
      try {
        await deps.identity(owned, row, plan.handle, deps.origin);
        if (stableAt !== undefined && performance.now() - stableAt >= 500)
          return;
        stableAt ??= performance.now();
      } catch (caught) {
        if (!(
          caught instanceof CliError &&
          caught.code === 'INSTAGRAM_SHAPE_CHANGED'
        ))
          throw caught;
        stableAt = undefined;
      }
      if (performance.now() >= deadline)
        throw new CliError('INSTAGRAM_SHAPE_CHANGED');
      await pause(100);
    }
  };
  const settle = async (
    state: 'deleted' | 'ambiguous' | 'failed',
    code: string | null,
  ) => {
    if (!sending) return;
    const receipt = permission.result();
    await writer.settle(
      {
        attemptId: crypto.randomUUID(),
        runId: sending.runId,
        itemId: sending.itemId,
        action: sending.action,
        state,
        settles: sending.attemptId,
        at: now().toISOString(),
        code,
        ...(receipt
          ? {
              receipt: {
                method: receipt.method,
                path: receipt.path,
                status: receipt.status,
                shape: receipt.shape,
              },
            }
          : {}),
      },
      state === 'deleted' ? 'deleted-via-browser' : undefined,
    );
    sending = undefined;
  };
  options.signal.addEventListener('abort', stop, { once: true });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    options.notice(INSTAGRAM_DELETE_WARNING[options.lang] + '\n');
    confirmation = await deps.confirmation(
      {
        platform: 'instagram',
        lang: options.lang,
        phase: 'start',
        expectedHandle: plan.handle,
        planned: plan.rows.length,
        marked: plan.rows.length,
        bulk: 0,
        estimateMs:
          Math.max(0, plan.rows.length - 1) * 30000 +
          Math.floor(Math.max(0, plan.rows.length - 1) / 10) * 900000,
        list: options.list,
        rows: plan.rows.slice(0, 20).map((r) => ({
          itemId: r.item.id,
          watchedCanary: !options.verify && plan.canary && r === plan.rows[0],
          date: r.item.createdAt,
          firstLine: r.item.text.split(/\r?\n/, 1)[0],
        })),
        warning: INSTAGRAM_DELETE_WARNING[options.lang],
        profileWarning:
          profileWarning(plan.handle, options.lang) +
          ' ' +
          EXTENSION_NOTICE[options.lang] +
          (options.lang === 'de'
            ? ` Öffnet gespeicherte Beiträge, prüft eigene Kommentare und öffnet nur deren Options-Menü und Delete. Schreibt Protokoll und gegebenenfalls socialprune-instagram-warning.json. 30 Sekunden Abstand, 15 Minuten nach zehn Versuchen, höchstens ${perDay} Versuche am Tag.`
            : ` Opens stored posts, checks own comments and uses only their Options menu and Delete. Writes the journal and, on a warning, socialprune-instagram-warning.json. 30 seconds between starts, 15 minutes after ten attempts, at most ${perDay} attempts a day.`),
        completed: 0,
        result: options.verify
          ? options.lang === 'de'
            ? 'Nur nachsehen, keine Löschklicks.'
            : 'Read-only verification. No deletion clicks.'
          : plan.canary
            ? options.lang === 'de'
              ? `Kommentar zum Zuschauen: ${plan.rows[0]?.item.id ?? ''}. Weiter bestätigt deine Kontrolle und beendet den Lauf. Es startet kein Hauptlauf.`
              : `Watched comment: ${plan.rows[0]?.item.id ?? ''}. Continue ends this canary; it does not start a main run.`
            : options.lang === 'de'
              ? 'Starte den angezeigten Löschplan.'
              : 'Start the displayed deletion plan.',
      },
      deps.port,
    );
    confirmation.onStop(stop);
    await writer.begin(run);
    began = true;
    context = await deps.launch(options.profile, options.executablePath);
    pages = contextPages(context, (caught) => {
      asyncFailure = caught;
      wake();
    });
    network = await guardInstagramNetwork(
      context,
      new URL(confirmation.url).origin,
      (request) => writer.request(run.runId, request),
      deps.policy,
      limits,
      (caught) => {
        asyncFailure = caught;
        const kind = instagramWarningKind(caught);
        if (kind) retainWarning(kind);
        wake();
      },
      (owned) => pages!.allowed(owned),
      options.verify ? undefined : permission,
      true,
    );
    const status = await pages.startupPage();
    statusPage = status;
    await context.setOffline(false);
    await status.goto(confirmation.launchUrl);
    options.notice('Confirmation is open in the local browser page.\n');
    if (
      !(await Promise.race([
        confirmation.wait('start'),
        interrupted.then(() => false),
      ]))
    ) {
      guard();
      throw new CliError('CANCELLED');
    }
    guard();
    await admit();
    if (
      !options.verify &&
      (await planInstagramDeletion(store, plan.accountKey, now())).hash !==
        plan.hash
    )
      throw new CliError('STALE_PLAN');
    page = await pages.newPage();
    page.setDefaultTimeout(deps.responseMs);
    context.on('close', stop);
    if (options.verify) {
      const tasks = await verificationRows(store, plan.accountKey, now());
      for (const task of tasks) {
        guard();
        if (dateInZone(now(), plan.timeZone) !== plan.day) {
          endReason = 'daily-cap';
          break;
        }
        const count = await instagramDailyCount(
          store,
          plan.accountKey,
          now(),
          plan.timeZone,
        );
        if (count.used >= 200) {
          endReason = 'daily-cap';
          break;
        }
        if (count.last)
          await pause(Math.max(0, count.last + 30000 - now().getTime()));
        await writer.pageOpen(run.runId, now().toISOString(), plan.timeZone);
        await page.goto(
          new URL(
            `/${task.row.context.post.kind}/${task.row.context.post.code}/c/${task.row.context.comment.id}/`,
            deps.origin,
          ).href,
          { waitUntil: 'domcontentloaded', timeout: deps.responseMs },
        );
        await checkpoint();
        await deps.expand(page, task.row, plan.handle, deps.origin, checkpoint);
        const observation = await deps.verify(
          page,
          task.row,
          plan.handle,
          deps.origin,
        );
        await checkpoint();
        if (observation === 'unverified') {
          await writer.record({
            attemptId: crypto.randomUUID(),
            runId: run.runId,
            itemId: task.row.item.id,
            action: 'verify',
            state: 'not-found',
            settles: null,
            at: now().toISOString(),
            code: null,
          });
          unverified++;
          continue;
        }
        if (task.pending) {
          await writer.record({
            attemptId: crypto.randomUUID(),
            runId: run.runId,
            itemId: task.row.item.id,
            action: 'verify',
            state: 'not-deleted',
            settles: null,
            at: now().toISOString(),
            code: null,
          });
          await writer.settle({
            ...task.pending,
            attemptId: crypto.randomUUID(),
            state: 'not-deleted',
            settles: task.pending.attemptId,
            at: now().toISOString(),
            code: null,
          });
        } else {
          await writer.settle(
            {
              attemptId: crypto.randomUUID(),
              runId: run.runId,
              itemId: task.row.item.id,
              action: 'verify',
              state: 'reappeared',
              settles: null,
              at: now().toISOString(),
              code: null,
            },
            'unknown',
          );
        }
        completed++;
      }
      if (unverified > 0)
        options.notice(
          options.lang === 'de'
            ? `${unverified} Kommentare bleiben ungeklärt. Nicht sichtbar ist kein Löschbeleg; ein unklarer Versuch bleibt gesperrt.\n`
            : `${unverified} comments remain unverified. Not visible is not deletion proof; unresolved attempts remain blocked.\n`,
        );
    } else {
      const selected = plan.canary ? plan.rows.slice(0, 1) : plan.rows;
      for (const row of selected) {
        guard();
        await admit();
        if (dateInZone(now(), plan.timeZone) !== plan.day) {
          endReason = 'daily-cap';
          break;
        }
        const budget = await instagramDeleteBudget(
          store,
          plan.accountKey,
          now(),
          plan.timeZone,
        );
        const reading = await instagramDailyCount(
          store,
          plan.accountKey,
          now(),
          plan.timeZone,
        );
        if (budget.used >= perDay || reading.used >= 200) {
          endReason = 'daily-cap';
          break;
        }
        await pause(
          Math.max(budget.wait, reading.last + 30000 - now().getTime(), 0),
        );
        if (dateInZone(now(), plan.timeZone) !== plan.day) {
          endReason = 'daily-cap';
          break;
        }
        if (
          (await writer.check(row, run.runId, now().toISOString(), false))
            ?.state === 'withdrawn'
        )
          throw new CliError('RUN_STOPPED');
        await writer.pageOpen(run.runId, now().toISOString(), plan.timeZone);
        await page.goto(
          new URL(
            `/${row.context.post.kind}/${row.context.post.code}/c/${row.context.comment.id}/`,
            deps.origin,
          ).href,
          { waitUntil: 'domcontentloaded', timeout: deps.responseMs },
        );
        await checkpoint();
        await deps.expand(page, row, plan.handle, deps.origin, checkpoint);
        await waitIdentity(page, row);
        await checkpoint();
        sending =
          (await writer.check(row, run.runId, now().toISOString(), true)) ??
          undefined;
        if (!sending || sending.state !== 'sending')
          throw new CliError('RUN_STOPPED');
        finalClick = false;
        await deps.click(page, row, plan.handle, deps.origin, async () => {
          await checkpoint();
          await admit();
          if (dateInZone(now(), plan.timeZone) !== plan.day)
            throw new CliError('STALE_PLAN');
          await writer.requireInstagramDecision(row);
          permission.arm({
            page: page!,
            origin: deps.origin,
            account: plan.handle,
            postCode: row.context.post.code,
            commentId: row.context.comment.id,
            attemptId: sending!.attemptId,
            beforeRequest: async () => {
              await checkpoint();
              await admit();
              await writer.requireInstagramDecision(row);
              if (dateInZone(now(), plan.timeZone) !== plan.day)
                throw new CliError('STALE_PLAN');
            },
          });
          finalClick = true;
        });
        const deadline = performance.now() + deps.responseMs;
        let confirmed = false;
        while (performance.now() < deadline) {
          await checkpoint();
          const receipt = permission.result();
          if (receipt && !receipt.accepted)
            throw new InstagramDeleteStop('receipt-unconfirmed');
          if (receipt?.accepted && (await deps.uiConfirmed(page))) {
            confirmed = true;
            break;
          }
          await pause(100);
        }
        if (!confirmed) throw new InstagramDeleteStop('receipt-unconfirmed');
        await network.flush();
        await checkpoint();
        // Receipt admission accepts only the exact {status:'ok'} shape.
        // Any unconfirmed attempt re-arms the next watched canary in the plan.
        run.bodyShapes['delete-comment'] = permission.result()!.shape;
        await settle('deleted', null);
        permission.disarm();
        finalClick = false;
        completed++;
        confirmation.update({ completed, phase: 'running' });
        if (plan.canary) {
          confirmation.update({
            phase: 'canary',
            result:
              options.lang === 'de'
                ? 'Ein Kommentar bestätigt. Prüfe das Ergebnis. Weiter hält deine Kontrolle fest und beendet den Lauf; kein weiterer Kommentar wird gelöscht.'
                : 'One comment confirmed. Check it. Continue records this check and ends; no further comment will be deleted.',
          });
          checked = await Promise.race([
            confirmation.wait('continue'),
            interrupted.then(() => false),
          ]);
          guard();
          if (!checked) throw new CliError('CANCELLED');
          endReason = 'canary';
          break;
        }
      }
    }
    await checkpoint();
  } catch (caught) {
    fail(caught);
  } finally {
    if (sending) {
      try {
        await settle(
          finalClick ? 'ambiguous' : 'failed',
          error instanceof CliError ? error.code : 'DELETE_FAILED',
        );
      } catch (caught) {
        fail(caught);
      }
    }
    permission.disarm();
    const finalize = async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (caught) {
        fail(caught);
      }
    };
    await finalize(async () => {
      await network?.flush();
      await pages?.flush();
    });
    await finalize(async () => {
      await Promise.all([...warningWrites]);
    });
    if (network?.warning && !warning) {
      warning = {
        kind: network.warning,
        at: now().toISOString(),
        zone: plan.timeZone,
      };
      endReason = 'platform-check';
    }
    if (page && !page.isClosed())
      await finalize(async () => {
        await deps.checkPage(page!, plan.handle);
        observedAfter = plan.handle;
      });
    let after: Awaited<ReturnType<typeof profileSnapshot>> | undefined;
    await finalize(async () => {
      after = await profileSnapshot(options.profile);
      if (after.extensionIds.some((id) => !before.extensionIds.includes(id)))
        throw new ContextStop('PLATFORM_CHECK', 'extensions-added');
    });
    const profileReport: BrowserProfileReport = {
      accountBefore: observedBefore,
      accountAfter: observedAfter,
      extensionsBefore: before.extensions,
      extensionsAfter: after?.extensions ?? before.extensions,
      changedFiles: after ? changedProfileFiles(before, after) : [],
      unexpectedRequests: network?.requests ?? [],
    };
    if (after)
      await finalize(() =>
        writeExtensionReport(
          options.profile,
          run.runId,
          before,
          after!,
          profileReport,
          network?.abortedHosts,
          'instagram',
        ),
      );
    options.notice(
      `Profile read-back: observed=${Boolean(after)}; changedFiles=${profileReport.changedFiles.length}; extensionsBefore=${before.extensions}; extensionsAfter=${after?.extensions ?? 'unknown'}; requests=${profileReport.unexpectedRequests.length}.\n`,
    );
    await finalize(async () => {
      const directory = join(options.workspace, 'context', 'instagram');
      await mkdir(directory, { recursive: true });
      const file = await open(
        join(directory, `delete-${run.runId}.json`),
        'wx',
      );
      try {
        await file.writeFile(
          JSON.stringify({
            runId: run.runId,
            mode: run.mode,
            completed,
            unverified,
            pace: {
              secondsPerStep: 30,
              attemptsPerBatch: 10,
              pauseSeconds: 900,
              perDay,
            },
            canary: plan.canary,
            accepted: checked,
            endReason,
            stop:
              error instanceof CliError
                ? error.code
                : error
                  ? 'DELETE_FAILED'
                  : null,
            warning: warning?.kind ?? null,
            limits: limits.summary(),
            pages: pages?.counts ?? null,
            abortedHosts: network?.abortedHosts ?? {},
            profileReadback: {
              observed: Boolean(after),
              added:
                after?.extensionIds.filter(
                  (id) => !before.extensionIds.includes(id),
                ).length ?? null,
              changed: profileReport.changedFiles.length,
            },
          }),
        );
        await file.sync();
      } finally {
        await file.close();
      }
    });
    await finalize(() => {
      confirmation?.update({
        phase: 'ended',
        completed,
        result:
          options.lang === 'de'
            ? `Instagram-Lauf beendet (${endReason}). Schließe das Plattformfenster. Es laufen keine weiteren Schritte.`
            : `Instagram ${options.verify ? 'verification' : 'deletion'} ended: ${endReason}. Close the platform window. No further steps will run.`,
      });
      return Promise.resolve();
    });
    options.notice(`Run ended: ${endReason}. Close the Instagram window.\n`);
    if (error)
      options.notice(
        `Stop detail: ${error instanceof ContextStop ? error.token : error instanceof InstagramDeleteStop ? error.detail : error instanceof CliError ? error.code : 'DELETE_FAILED'}\n`,
      );
    if (began && warning)
      await finalize(() =>
        writer.recordXWarning(
          run.runId,
          warning!.at,
          warning!.zone,
          warning!.kind,
          'instagram',
        ),
      );
    const closeStatus = () => {
      void statusPage?.close().catch((caught: unknown) => {
        fail(caught);
      });
    };
    if (page?.isClosed()) closeStatus();
    else page?.once('close', closeStatus);
    await finalize(async () => {
      if (context) await deps.close(context, false);
    });
    page?.off('close', closeStatus);
    await finalize(async () => {
      await network?.flush();
    });
    network?.dispose();
    pages?.dispose();
    await finalize(async () => {
      await confirmation?.close();
    });
    if (began) {
      if (warning)
        await finalize(() =>
          writer.recordXWarning(
            run.runId,
            warning!.at,
            warning!.zone,
            warning!.kind,
            'instagram',
          ),
        );
      try {
        await writer.finish({
          ...run,
          endedAt: now().toISOString(),
          endReason,
          bodyShapes: {
            ...run.bodyShapes,
            ...(error instanceof CliError ? { stop: [error.code] } : {}),
          },
          profileReport,
          ...(warning ? { instagramWarning: warning } : {}),
        });
        if (checked && !error && endReason === 'canary')
          await writer.acceptInstagramDeleteCanary(
            run.runId,
            now().toISOString(),
          );
      } finally {
        options.signal.removeEventListener('abort', stop);
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
      }
    }
    options.signal.removeEventListener('abort', stop);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
  return {
    runId: run.runId,
    completed,
    unverified,
    endReason,
    code:
      error instanceof CliError ? error.code : error ? 'DELETE_FAILED' : null,
  };
}

export async function verificationRows(
  store: SQLiteStore,
  account: string,
  now: Date,
) {
  const journal = await store.browserJournal();
  return store.read(async (tx) => {
    const rows: { row: InstagramDeleteRow; pending?: BrowserAttempt }[] = [];
    for await (const context of tx.instagramContext.iterate()) {
      if (
        context.accountKey !== account ||
        context.confirmedBy !== 'post' ||
        context.ownerCheck !== 'matched-export'
      )
        continue;
      const stored = await tx.items.get(context.itemId);
      if (!stored) continue;
      const own = journal.attempts.filter(
        (a) => a.itemId === context.itemId && a.action === 'delete-comment',
      );
      const pending = own.find(
        (a) =>
          ['sending', 'ambiguous'].includes(a.state) &&
          !own.some((b) => b.settles === a.attemptId),
      );
      const deleted = own.findLast((a) => a.state === 'deleted');
      if (
        !pending &&
        (!deleted ||
          now.getTime() - Date.parse(deleted.at) < 7 * 86400000 ||
          journal.attempts.some(
            (a) =>
              a.itemId === context.itemId &&
              a.action === 'verify' &&
              ['still-gone', 'reappeared'].includes(a.state) &&
              Date.parse(a.at) >= Date.parse(deleted.at),
          ))
      )
        continue;
      let decision;
      for await (const event of tx.decisionEvents.iterate())
        if (event.itemId === context.itemId) decision = event;
      if (!decision) continue;
      rows.push({
        row: { item: stored.item, decision, context, action: 'delete-comment' },
        ...(pending ? { pending } : {}),
      });
    }
    return rows;
  });
}
