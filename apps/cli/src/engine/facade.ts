import { lstat, mkdir, readdir, readFile, rm, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createWorkspace } from '@socialprune/core/workspace/store';
import {
  DesktopRequestSchema,
  DesktopReplySchema,
  DesktopErrorCodeSchema,
  RunViewSchema,
  RunSettledStateSchema,
  RunJournalCodeSchema,
  RunStopDetailSchema,
  DesktopCliErrorCodeSchema,
  parseDesktopReply,
} from '@socialprune/core/workspace/desktop-protocol';
import type {
  DesktopReply,
  DesktopRequest,
  DesktopRunPlan,
  RunView,
  DesktopPlatform,
} from '@socialprune/core/workspace/desktop-protocol';
import { xGuide } from '@socialprune/adapter-x/guide';
import { instagramGuide } from '@socialprune/adapter-instagram/guide';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { workspacePath } from '../workspace/files.ts';
import {
  importWorkspace,
  exportBackup,
  restoreWorkspace,
} from '../workspace/services.ts';
import { EngineReviewDispatch } from './review-dispatch.ts';
import { CliError } from '../cli/errors.ts';
import {
  planDeletion,
  planSummary,
  planText,
  resolveAccountName,
} from '../browser/plan.ts';
import type { DeletePlan } from '../browser/plan.ts';
import { planFill, fillSummary, fillList } from '../browser/x/fill/plan.ts';
import type { FillPlan } from '../browser/x/fill/plan.ts';
import {
  planContext,
  contextSummary,
  contextList,
} from '../browser/instagram/plan.ts';
import type { ContextPlan } from '../browser/instagram/plan.ts';
import { productionPace, dateInZone } from '../browser/pace.ts';
import { orderPace } from '../browser/x/fill/order.ts';
import { contextPace } from '../browser/instagram/pace.ts';
import { profileWarning, EXTENSION_NOTICE } from '../browser/copy.ts';
import {
  ConfirmationState,
  profileReadback,
  confirmationWarning,
} from '../browser/confirmation-state.ts';
import { dailyCount } from '../browser/runner.ts';
import { instagramDailyCount } from '../browser/instagram/pace.ts';
import type { ConfirmationView } from '../browser/confirmation-state.ts';
import { RunControls } from '../browser/run-controls.ts';
import { entryView } from '../browser/run-session.ts';
import type { RunSession, ActiveRunView } from '../browser/run-session.ts';
import {
  changedProfileFiles,
  validateProfile,
  profileInUse,
  createProfile,
  adoptInstagramProfile,
} from '../browser/profile.ts';
import type { ProfileSnapshot } from '../browser/profile.ts';
import { errorStop } from '../browser/x/fill/report.ts';
import { ContextStop } from '../browser/instagram/report.ts';
import { EngineOptionsSchema, EngineHostMessageSchema } from './host.ts';
import type { DesktopEngine, EngineOptions } from './host.ts';
import type { EngineDependencies } from './dependencies.ts';

export const guides = Object.freeze([xGuide, instagramGuide]);
function code(error: unknown) {
  const result = DesktopErrorCodeSchema.safeParse(
    error && typeof error === 'object' && 'code' in error ? error.code : null,
  );
  return result.success ? result.data : 'ENGINE_UNAVAILABLE';
}
type Planned = {
  request: Extract<DesktopRequest, { type: 'planRun' }>;
  plan: DeletePlan | FillPlan | ContextPlan;
  view: DesktopRunPlan;
};

/** Production and generated test entries choose dependencies in separate graphs. */
export async function createEngine(
  raw: EngineOptions,
  deps: EngineDependencies,
): Promise<DesktopEngine> {
  const options = EngineOptionsSchema.parse(raw);
  const root = resolve(options.dataFolder),
    workspace = join(root, 'workspace');
  await mkdir(root, { recursive: true });
  let store: SQLiteStore | undefined,
    dispatch: EngineReviewDispatch | undefined;
  let planned: Planned | undefined,
    state: ConfirmationState | undefined,
    controls: RunControls | undefined;
  let view: RunView = { phase: 'idle', version: 0 };
  let task: Promise<unknown> | undefined;
  let taskActive = false;
  let closeBrowser: (() => Promise<void>) | undefined;
  let closing = false;
  const signal = new AbortController();
  const listeners = new Set<(view: RunView) => void>();
  const profile = (platform: DesktopPlatform) =>
    join(root, 'profiles', platform);
  const broadcast = (value: RunView) => {
    view = RunViewSchema.parse(value);
    for (const listener of listeners) listener(structuredClone(view));
  };
  const active = () => taskActive || !['idle', 'ended'].includes(view.phase);
  const getStore = async () => {
    if (!store) {
      const target = await workspacePath(workspace, true);
      store = await SQLiteStore.open(target.path, {
        initial: target.exists
          ? undefined
          : createWorkspace({ now: deps.now() }),
      });
      dispatch = await EngineReviewDispatch.fromStore(store);
    }
    return store;
  };
  const release = async () => {
    await dispatch?.close();
    dispatch = undefined;
    store = undefined;
  };
  const profileStatus = async (platform: DesktopPlatform) => {
    const directory = profile(platform),
      exists = Boolean(await lstat(directory).catch(() => null));
    const ready =
      exists &&
      (await validateProfile(directory, platform).then(
        () => true,
        () => false,
      ));
    const inUse = exists && (await profileInUse(directory));
    return {
      platform,
      exists,
      ready,
      inUse,
      browser: null,
      canAdopt:
        platform === 'instagram' &&
        exists &&
        !ready &&
        !inUse &&
        Boolean(await lstat(join(directory, 'Local State')).catch(() => null)),
    };
  };
  const planRun = async (
    request: Planned['request'],
  ): Promise<DesktopRunPlan> => {
    if (active()) throw new CliError('WORKSPACE_BUSY');
    const db = await getStore();
    const plan =
      request.mode === 'context'
        ? await planContext(db, request.accountKey)
        : request.mode === 'fill'
          ? await planFill(db, request.accountKey)
          : await planDeletion(db, request.accountKey);
    plan.handle = resolveAccountName(plan.handle, request.handle).handle;
    if (!plan.handle)
      throw new CliError(
        request.platform === 'x'
          ? 'ACCOUNT_NAME_MISSING'
          : 'INSTAGRAM_ACCOUNT_NAME_MISSING',
      );
    const summary =
      request.mode === 'context'
        ? contextSummary(plan as ContextPlan, options.lang)
        : request.mode === 'fill'
          ? fillSummary(plan as FillPlan, options.lang)
          : planSummary(plan as DeletePlan, options.lang);
    let rows =
      request.mode === 'context'
        ? (plan as ContextPlan).rows.map(({ item }) =>
            entryView(item, 'confirm-comment'),
          )
        : request.mode === 'fill'
          ? []
          : (plan as DeletePlan).rows.map(({ item, action }) =>
              entryView(item, request.mode === 'verify' ? 'verify' : action),
            );
    if (request.mode === 'fill') {
      const own = await db.read(async (tx) => {
        const result = [];
        for await (const { item } of tx.items.iterate())
          if (item.account.key === request.accountKey) result.push(item);
        return result;
      });
      rows = (plan as FillPlan).rows.flatMap((row) => {
        const item = own.find(
          (item) =>
            item.reference.replyToId === row.id ||
            item.reference.quotedId === row.id,
        );
        return item ? [entryView(item, 'read-post')] : [];
      });
    }
    // Verification uses the runner's journal eligibility, not deletion candidates.
    let count = plan.rows.length;
    if (request.mode === 'verify') {
      const journal = await db.browserJournal();
      const runs = new Set(
        journal.runs
          .filter((run) => run.accountKey === request.accountKey)
          .map((run) => run.runId),
      );
      const candidates = journal.attempts.filter(
        (attempt) =>
          runs.has(attempt.runId) &&
          ((['sending', 'ambiguous'].includes(attempt.state) &&
            !journal.attempts.some(
              (other) => other.settles === attempt.attemptId,
            )) ||
            (attempt.state === 'deleted' &&
              deps.now().getTime() - Date.parse(attempt.at) >= 7 * 86400000 &&
              !journal.attempts.some(
                (other) =>
                  other.action === 'verify' &&
                  other.itemId === attempt.itemId &&
                  Date.parse(other.at) >= Date.parse(attempt.at),
              ))),
      );
      count = candidates.length;
      rows = await db.read(async (tx) => {
        const result = [];
        for (const attempt of candidates) {
          const item = await tx.items.get(attempt.itemId);
          if (item) result.push(entryView(item.item, 'verify'));
        }
        return result;
      });
    }
    const result: DesktopRunPlan = {
      platform: request.platform,
      mode: request.mode,
      accountKey: request.accountKey,
      expectedHandle: plan.handle,
      planHash: plan.hash,
      planned: count,
      marked:
        request.mode === 'context'
          ? (plan as ContextPlan).rows.filter((row) => row.marked).length
          : request.mode === 'delete'
            ? count
            : 0,
      bulk: request.mode === 'delete' && 'bulk' in summary ? summary.bulk : 0,
      estimateMs: summary.estimateMs,
      canary:
        request.mode === 'verify'
          ? false
          : 'canary' in plan
            ? plan.canary
            : true,
      rows: rows.slice(0, 20),
    };
    planned = { request, plan, view: result };
    return result;
  };
  const startRun = async (
    request: Extract<DesktopRequest, { type: 'startRun' }>,
  ) => {
    if (active()) throw new CliError('WORKSPACE_BUSY');
    if (!planned || planned.plan.hash !== request.planHash)
      throw new CliError('STALE_PLAN');
    const selection = planned,
      db = await getStore(),
      plan = selection.plan,
      mode = selection.request.mode;
    if (mode === 'delete' && (plan as DeletePlan).originalsPending)
      throw new CliError('ORIGINALS_PENDING');
    await validateProfile(
      profile(selection.request.platform),
      selection.request.platform,
    );
    const executablePath = await deps.browser(request.browser);
    const p =
      mode === 'context'
        ? contextPace(undefined, selection.view.canary)
        : mode === 'fill'
          ? orderPace()
          : productionPace(mode);
    const batchSize = 'batchSize' in p ? p.batchSize : p.batch;
    const warning =
      mode === 'context'
        ? contextSummary(plan as ContextPlan, options.lang).warning
        : mode === 'fill'
          ? fillSummary(plan as FillPlan, options.lang).warning
          : planSummary(plan as DeletePlan, options.lang).warning;
    const journal = await db.browserJournal();
    const timeZone = mode === 'fill' ? 'Europe/Berlin' : plan.timeZone;
    const day = dateInZone(deps.now(), timeZone);
    const used =
      mode === 'context'
        ? (await instagramDailyCount(db, plan.accountKey, deps.now(), timeZone))
            .used
        : await dailyCount(
            db,
            plan.accountKey,
            mode === 'verify' ? 'verify' : 'delete',
            day,
            timeZone,
          );
    if (view.phase === 'ended') await task;
    const initial: ActiveRunView = {
      phase: 'awaiting-warning',
      version: view.version + 1,
      runId: crypto.randomUUID(),
      platform: selection.view.platform,
      mode,
      accountKey: plan.accountKey,
      expectedHandle: plan.handle,
      planHash: plan.hash,
      canary: selection.view.canary,
      pauseRequested: false,
      progress: {
        planned: selection.view.planned,
        completed: 0,
        marked: selection.view.marked,
        bulk: selection.view.bulk,
        settled: Object.fromEntries(
          RunSettledStateSchema.options.map((key) => [key, 0]),
        ) as ActiveRunView['progress']['settled'],
      },
      today: {
        date: day,
        timeZone,
        used,
        cap: p.perDay,
        unit: mode === 'context' ? 'steps' : 'pages',
        sharedWithXDeleteAndFill: mode !== 'context',
      },
      pace: {
        secondsPerStep: p.intervalMs / 1000,
        batchSize,
        batchPauseMs: p.pauseMs,
      },
      nextStepAt: null,
      currentEntry: null,
      journal: [],
      xWindows: [],
      instagram: null,
      warning: confirmationWarning(
        warning,
        journal.runs.some((run) => run.platform === selection.view.platform),
      ),
      profile: {
        canChange: [
          profileWarning(plan.handle, options.lang),
          EXTENSION_NOTICE[options.lang],
        ],
        before: null,
        readback: null,
      },
      browserWindow: {
        browser: request.browser,
        placement: options.windowPlacement ? 'beside' : 'own-size',
      },
    };
    const legacy: Omit<ConfirmationView, 'version'> = {
      phase: 'start',
      warning,
      profileWarning: initial.profile.canChange.join('\n'),
      planned: initial.progress.planned,
      bulk: initial.progress.bulk,
      estimateMs: selection.view.estimateMs,
      list: '',
      rows: [],
      completed: 0,
      result: '',
      platform: initial.platform,
      lang: options.lang,
      expectedHandle: plan.handle,
    };
    state = new ConfirmationState(legacy, initial);
    const owner = state;
    owner.subscribe(broadcast);
    const failRun = (error: unknown) => {
      const current = owner.runView as ActiveRunView;
      const parsed = DesktopCliErrorCodeSchema.safeParse(code(error));
      owner.updateRun({
        phase: 'ended',
        pauseRequested: false,
        nextStepAt: null,
        profile: {
          ...current.profile,
          readback:
            current.profile.readback ??
            profileReadback({
              profileObserved: false,
              accountBefore: current.profile.before?.account ?? null,
              accountAfter: null,
              extensionIdsBefore: current.profile.before?.extensionIds ?? [],
              extensionIdsAfter: current.profile.before?.extensionIds ?? [],
              extensionIdsAdded: [],
              extensionIdsRemoved: [],
              changedFiles: [],
              unexpectedRequests: [],
            }),
        },
        end: {
          at: deps.now().toISOString(),
          reason: 'error',
          detail: 'other',
          cliCode: parsed.success ? parsed.data : 'RUN_STOPPED',
        },
      });
    };
    const recoverFailedProjection = (error: unknown) => {
      try {
        failRun(error);
      } catch {
        // No read-back was observed. If even the error view is invalid, retire
        // that projection rather than keeping a completed session active.
        view = { phase: 'idle', version: view.version + 1 };
        for (const listener of listeners) {
          try {
            listener(structuredClone(view));
          } catch {
            /* A subscriber must not reject the runner's finalization. */
          }
        }
      }
    };
    let interruptedWait: Record<string, unknown> | undefined;
    let pausedAt = 0;
    controls = new RunControls(deps.now, (phase, pending) => {
      const current = owner.runView;
      if (phase?.phase === 'paused') {
        pausedAt = deps.now().getTime();
        if (
          ['batch-pause', 'rate-wait', 'reload-wait'].includes(current.phase)
        ) {
          const { phase, ...fields } = current;
          interruptedWait = {
            phase,
            ...Object.fromEntries(
              Object.entries(fields).filter(([key]) =>
                ['remainingMs', 'until', 'resetAt', 'reload'].includes(key),
              ),
            ),
          };
        }
      }
      const patch =
        phase?.phase === 'running' && interruptedWait
          ? interruptedWait
          : { ...(phase ?? {}) };
      if (phase?.phase === 'running' && interruptedWait) {
        const elapsed = deps.now().getTime() - pausedAt;
        for (const key of ['until', 'resetAt'])
          if (typeof patch[key] === 'string')
            patch[key] = new Date(
              Date.parse(patch[key]) + elapsed,
            ).toISOString();
        interruptedWait = undefined;
      }
      owner.updateRun({ ...patch, pauseRequested: pending });
    });
    let before: ProfileSnapshot | undefined;
    const startConfirmed = owner.wait('start');
    const session: RunSession = {
      controls,
      browser(close) {
        closeBrowser = close;
        if (closing)
          void Promise.resolve().then(close).catch(recoverFailedProjection);
      },
      failed: recoverFailedProjection,
      confirmation(initial) {
        owner.update({
          warning: initial.warning,
          profileWarning: initial.profileWarning,
        });
        return Promise.resolve({
          url: 'app://socialprune/',
          launchUrl: 'app://socialprune/',
          get stopped() {
            return owner.stopped;
          },
          update: (update) => owner.update(update),
          wait: (action) =>
            action === 'start'
              ? Promise.resolve(!owner.stopped)
              : owner.wait(action),
          onStop: (listener) => owner.onStop(listener),
          close: () => owner.close(),
        });
      },
      before(snapshot, account) {
        before = snapshot;
        const current = owner.runView as ActiveRunView;
        owner.updateRun({
          profile: {
            ...current.profile,
            before: { account, extensionIds: snapshot.extensionIds },
          },
        });
      },
      entry: (currentEntry) =>
        owner.updateRun({ currentEntry, nextStepAt: null }),
      progress(used, completed, attempts) {
        const current = owner.runView as ActiveRunView;
        const settled = { ...current.progress.settled };
        for (const key of RunSettledStateSchema.options)
          settled[key] = attempts.filter(
            (attempt) => attempt.state === key,
          ).length;
        owner.updateRun({
          today: { ...current.today, used },
          progress: { ...current.progress, completed, settled },
          journal: attempts.slice(-10).map((attempt) => ({
            at: attempt.at,
            action: attempt.action,
            outcome: attempt.state,
            code: RunJournalCodeSchema.safeParse(attempt.code).success
              ? attempt.code
              : null,
          })),
        });
      },
      update: (value) => owner.updateRun(value),
      waiting(remainingMs, nextStepAt) {
        const current = owner.runView;
        owner.updateRun({
          nextStepAt,
          ...(['batch-pause', 'reload-wait', 'rate-wait'].includes(
            current.phase,
          )
            ? {
                remainingMs,
                ...(current.phase === 'rate-wait' ? {} : { until: nextStepAt }),
              }
            : {}),
        });
      },
      instagram: (instagram) => owner.updateRun({ instagram }),
      finish(run, error, after, detail) {
        const current = owner.runView as ActiveRunView;
        const report = run.profileReport;
        const readback = profileReadback({
          profileObserved: Boolean(after),
          accountBefore: report?.accountBefore ?? null,
          accountAfter: report?.accountAfter ?? null,
          extensionIdsBefore: before?.extensionIds ?? [],
          extensionIdsAfter: after?.extensionIds ?? before?.extensionIds ?? [],
          extensionIdsAdded:
            after?.extensionIds.filter(
              (id) => !before?.extensionIds.includes(id),
            ) ?? [],
          extensionIdsRemoved:
            after && before
              ? before.extensionIds.filter(
                  (id) => !after.extensionIds.includes(id),
                )
              : [],
          changedFiles:
            before && after ? changedProfileFiles(before, after) : [],
          unexpectedRequests: (report?.unexpectedRequests ?? []).map(
            (value) => ({
              method: value.method,
              host: value.host,
              path: value.path,
              status: value.status,
              operation: value.operation ?? null,
            }),
          ),
        });
        const details =
          error instanceof ContextStop
            ? error.token
            : (errorStop(error).reason ?? errorStop(error).code);
        const cli = DesktopCliErrorCodeSchema.safeParse(code(error));
        owner.updateRun({
          phase: 'ended',
          pauseRequested: false,
          nextStepAt: null,
          profile: { ...current.profile, readback },
          end: {
            at: deps.now().toISOString(),
            reason: run.endReason ?? 'error',
            detail:
              detail ?? (error ? RunStopDetailSchema.parse(details) : null),
            cliCode: error ? (cli.success ? cli.data : 'RUN_STOPPED') : null,
          },
        });
      },
    };
    broadcast(owner.runView);
    const common = {
      store: db,
      profile: profile(selection.view.platform),
      executablePath,
      list: '',
      signal: signal.signal,
      now: deps.now,
      notice: () => {},
      lang: options.lang,
      session,
      windowPlacement: options.windowPlacement,
    };
    taskActive = true;
    task = (async () => {
      if (!(await startConfirmed) || signal.signal.aborted)
        throw new CliError('CANCELLED');
      const text =
        mode === 'context'
          ? contextList(plan as ContextPlan)
          : mode === 'fill'
            ? fillList(plan as FillPlan)
            : planText(plan as DeletePlan, options.lang);
      const list = join(workspace, `${mode}-${plan.hash}.txt`);
      const existing = await readFile(list, 'utf8').catch(() => null);
      if (existing !== null && existing !== text)
        throw new CliError('STALE_PLAN');
      if (existing === null) {
        const file = await open(list, 'wx');
        try {
          await file.writeFile(text);
          await file.sync();
        } finally {
          await file.close();
        }
      }
      if (mode === 'context')
        return deps.context({
          ...common,
          list,
          plan: plan as ContextPlan,
          workspace,
          include: new Set(),
          limit: 200,
        });
      if (mode === 'fill')
        return deps.fill({
          ...common,
          list,
          plan: plan as FillPlan,
          workspace,
          include: new Set(),
          limit: 200,
          maxVideoBytes: 1024 ** 3,
          maxRunBytes: 20 * 1024 ** 3,
        });
      return deps.delete({
        ...common,
        list,
        plan: plan as DeletePlan,
        verify: mode === 'verify',
      });
    })()
      .catch((error) => {
        if (owner.runView.phase !== 'ended') {
          try {
            session.finish(
              {
                endReason:
                  owner.stopped || signal.signal.aborted
                    ? 'stopped-by-person'
                    : 'error',
                profileReport: null,
              },
              error,
            );
          } catch {
            recoverFailedProjection(error);
          }
        }
      })
      .finally(() => {
        taskActive = false;
        closeBrowser = undefined;
      });
    return owner.runView;
  };
  async function handle(raw: unknown): Promise<DesktopReply> {
    const candidate =
      raw && typeof raw === 'object' && 'request' in raw ? raw.request : null;
    const requestId =
      candidate &&
      typeof candidate === 'object' &&
      'requestId' in candidate &&
      typeof candidate.requestId === 'string' &&
      candidate.requestId.length &&
      candidate.requestId.length <= 512
        ? candidate.requestId
        : 'invalid-request';
    try {
      if (closing) throw new CliError('NOT_AVAILABLE');
      const message = EngineHostMessageSchema.parse(raw);
      const request = DesktopRequestSchema.parse(message.request);
      const id = request.requestId;
      let reply: DesktopReply;
      switch (request.type) {
        case 'openLink':
        case 'dataFolderOpen':
          throw new CliError('INVALID_ARGUMENTS');
        case 'runView':
          reply = { type: 'runView', requestId: id, view };
          break;
        case 'planRun':
          reply = {
            type: 'runPlanned',
            requestId: id,
            plan: await planRun(request),
          };
          break;
        case 'startRun':
          reply = {
            type: 'runStarted',
            requestId: id,
            view: await startRun(request),
          };
          break;
        case 'runAction':
          if (!state || !controls) throw new CliError('INVALID_ARGUMENTS');
          state.action(
            request.runId,
            request.version,
            request.action,
            controls,
          );
          reply = {
            type: 'runActionResult',
            requestId: id,
            view: state.runView,
          };
          break;
        case 'browsers': {
          const browsers: ('edge' | 'chrome')[] = [];
          for (const browser of ['edge', 'chrome'] as const)
            if (
              await deps.browser(browser).then(
                () => true,
                () => false,
              )
            )
              browsers.push(browser);
          reply = {
            type: 'browsersFound',
            requestId: id,
            browsers,
            preferred: browsers[0] ?? null,
          };
          break;
        }
        case 'profileStatus':
          reply = {
            type: 'profileStatus',
            requestId: id,
            profile: await profileStatus(request.platform),
          };
          break;
        case 'profileSetup':
          if (active()) throw new CliError('WORKSPACE_BUSY');
          await createProfile(profile(request.platform), request.platform);
          await deps.setup({
            platform: request.platform,
            profile: profile(request.platform),
            executablePath: await deps.browser(request.browser),
            signal: signal.signal,
            notice: () => {},
          });
          reply = {
            type: 'profileSetupResult',
            requestId: id,
            profile: {
              ...(await profileStatus(request.platform)),
              browser: request.browser,
            },
          };
          break;
        case 'profileAdopt':
          if (active()) throw new CliError('WORKSPACE_BUSY');
          await adoptInstagramProfile(
            profile('instagram'),
            deps.now().toISOString(),
          );
          reply = {
            type: 'profileAdoptResult',
            requestId: id,
            profile: await profileStatus('instagram'),
          };
          break;
        case 'profileForget':
          if (active()) throw new CliError('WORKSPACE_BUSY');
          await validateProfile(profile(request.platform), request.platform);
          if (await profileInUse(profile(request.platform)))
            throw new CliError('PROFILE_INVALID');
          await rm(profile(request.platform), { recursive: true });
          reply = {
            type: 'profileForgetResult',
            requestId: id,
            profile: await profileStatus(request.platform),
          };
          break;
        case 'importExport':
        case 'backupExport':
        case 'backupRestore': {
          if (active()) throw new CliError('WORKSPACE_BUSY');
          const selection = message.selection;
          const call = { workspace, signal: signal.signal, now: deps.now };
          if (request.type === 'importExport') {
            if (
              !selection ||
              selection.type !== 'importExport' ||
              !selection.paths
            ) {
              reply = {
                type: 'exportImported',
                requestId: id,
                result: { status: 'cancelled' },
              };
              break;
            }
            await release();
            const result = await importWorkspace({
              ...call,
              paths: selection.paths,
            });
            await getStore();
            const accounts = await dbAccounts();
            reply = {
              type: 'exportImported',
              requestId: id,
              result: {
                status: 'imported',
                items: result.data.items,
                duplicates: Math.max(
                  0,
                  result.data.items -
                    result.data.added -
                    result.data.updated -
                    result.data.conflicts,
                ),
                accounts,
                partial: result.partial,
              },
            };
          } else if (request.type === 'backupExport') {
            if (
              !selection ||
              selection.type !== 'backupExport' ||
              !selection.path
            ) {
              reply = {
                type: 'backupExported',
                requestId: id,
                result: { status: 'cancelled' },
              };
              break;
            }
            await getStore();
            await release();
            const result = await exportBackup({ ...call, out: selection.path });
            reply = {
              type: 'backupExported',
              requestId: id,
              result: {
                status: 'exported',
                bytes: result.data.bytes ?? 0,
                mediaFiles: 0,
                mediaBytes: 0,
              },
            };
          } else {
            if (
              !selection ||
              selection.type !== 'backupRestore' ||
              !selection.path
            ) {
              reply = {
                type: 'backupRestored',
                requestId: id,
                result: { status: 'cancelled' },
              };
              break;
            }
            await release();
            const result = await restoreWorkspace({
              ...call,
              file: selection.path,
            });
            reply = {
              type: 'backupRestored',
              requestId: id,
              result: { status: 'restored', items: result.data.counts.items },
            };
          }
          break;
        }
        case 'dataFolderInfo': {
          const size = async (path: string): Promise<number> => {
            const stat = await lstat(path).catch(() => null);
            if (!stat || stat.isSymbolicLink()) return 0;
            if (stat.isFile()) return stat.size;
            let bytes = 0;
            for (const entry of await readdir(path))
              bytes += await size(join(path, entry));
            return bytes;
          };
          reply = {
            type: 'dataFolderInfo',
            requestId: id,
            folder: {
              path: root,
              storeBuild: options.storeBuild,
              folders: await Promise.all(
                (
                  [
                    ['workspace', workspace],
                    ['profile-x', profile('x')],
                    ['profile-instagram', profile('instagram')],
                    ['logs', join(root, 'logs')],
                  ] as const
                ).map(async ([kind, path]) => ({
                  kind,
                  bytes: await size(path),
                })),
              ),
            },
          };
          break;
        }
        default:
          await getStore();
          {
            const replies = await dispatch!.run(request, signal.signal);
            const failure = replies.find((reply) => reply.type === 'failed');
            reply =
              failure?.type === 'failed'
                ? { type: 'desktopFailed', requestId: id, code: failure.code }
                : { type: 'reviewReply', requestId: id, replies };
          }
      }
      return parseDesktopReply(request, reply);
    } catch (error) {
      return DesktopReplySchema.parse({
        type: 'desktopFailed',
        requestId,
        code:
          error instanceof Error && error.name === 'ZodError'
            ? 'INVALID_ARGUMENTS'
            : code(error),
      });
    }
  }
  async function dbAccounts() {
    await getStore();
    return store!.read(async (tx) => {
      const keys = new Set<string>();
      for await (const imported of tx.imports.iterate())
        for (const account of imported.accounts) keys.add(account.key);
      return keys.size;
    });
  }
  let commands: Promise<unknown> = Promise.resolve();
  const queued = (raw: unknown): Promise<DesktopReply> => {
    const stop = EngineHostMessageSchema.safeParse(raw);
    if (
      stop.success &&
      stop.data.request.type === 'runAction' &&
      stop.data.request.action === 'stop'
    )
      return handle(stop.data);
    const result = commands.then(() => handle(raw));
    commands = result.catch(() => undefined);
    return result;
  };
  return {
    request: (request) => queued({ request }),
    handleHost: queued,
    onRunView(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      closing = true;
      signal.abort();
      controls?.stop();
      await state?.close();
      await closeBrowser?.();
      await commands;
      await task;
      await release();
      listeners.clear();
    },
  };
}
