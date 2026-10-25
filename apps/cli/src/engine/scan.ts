import { mkdir, open, rename, rm, lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loopback, parseSource } from '@socialprune/classify';
import {
  loadSourceConfig,
  sourceKeyPath,
  inGitTree,
} from '@socialprune/classify/node';
import {
  DesktopScanSetupSchema,
  DesktopScanViewSchema,
  DesktopCliErrorCodeSchema,
} from '@socialprune/core/workspace/desktop-protocol';
import type {
  DesktopRequest,
  DesktopScanSetup,
  DesktopScanPlan,
  DesktopScanView,
} from '@socialprune/core/workspace/desktop-protocol';
import { checkScanSource, runScan } from '../workspace/services.ts';
import type { RunControls } from '../browser/run-controls.ts';
import { CliError } from '../cli/errors.ts';

export type ScanCommand = Extract<
  DesktopRequest,
  {
    type:
      | 'scanKey'
      | 'scanSource'
      | 'scanCheck'
      | 'scanPlan'
      | 'scanStart'
      | 'scanView'
      | 'scanAction';
  }
>;
export class EngineScan {
  private readonly source: string;
  private keyFile: string | null = null;
  private setup: DesktopScanSetup | undefined;
  private plan: DesktopScanPlan | undefined;
  private canaryPlan: string | undefined;
  private controller: AbortController | undefined;
  private controls: RunControls | undefined;
  private task: Promise<void> | undefined;
  private checking: ReturnType<typeof checkScanSource> | undefined;
  private busy = false;
  view: DesktopScanView = DesktopScanViewSchema.parse({
    phase: 'idle',
    version: 0,
    runId: null,
    pauseRequested: false,
    planHash: null,
    limit: null,
    canResume: false,
    planned: 0,
    stored: 0,
    remaining: 0,
    requests: 0,
    retries: 0,
    secondPassEntries: 0,
    batchSize: 1,
    tokens: {
      promptTokens: null,
      cachedPromptTokens: null,
      completionTokens: null,
    },
    stopCode: null,
  });
  private readonly workspace: string;
  private readonly now: () => Date;
  private readonly Control: typeof RunControls;
  constructor(workspace: string, now: () => Date, Control: typeof RunControls) {
    this.workspace = workspace;
    this.now = now;
    this.Control = Control;
    this.source = join(workspace, 'suggestion-source.json');
  }
  get active() {
    return this.busy || !['idle', 'ended'].includes(this.view.phase);
  }
  private update(patch: Partial<DesktopScanView>) {
    this.view = DesktopScanViewSchema.parse({
      ...this.view,
      ...patch,
      version: this.view.version + 1,
    });
  }
  async handle(request: ScanCommand, selectedKey?: string | null) {
    const requestId = request.requestId;
    if (request.type === 'scanView')
      return { type: 'scanView' as const, requestId, view: this.view };
    if (request.type === 'scanAction') {
      if (
        request.runId !== this.view.runId ||
        !this.controls ||
        !this.controller ||
        this.view.phase === 'ended'
      )
        throw new CliError('INVALID_ARGUMENTS');
      if (request.action === 'stop') {
        this.controller.abort();
        this.controls.stop();
        this.update({ phase: 'ending', pauseRequested: false });
      } else {
        if (request.version !== this.view.version)
          throw new CliError('INVALID_ARGUMENTS');
        if (request.action === 'pause' && this.view.phase === 'running')
          this.controls.requestPause();
        else if (request.action === 'resume' && this.view.phase === 'paused')
          this.controls.resume();
        else throw new CliError('INVALID_ARGUMENTS');
      }
      return { type: 'scanAction' as const, requestId, view: this.view };
    }
    if (this.active) throw new CliError('WORKSPACE_BUSY');
    if (request.type === 'scanKey') {
      if (request.clear || selectedKey) {
        this.keyFile = request.clear ? null : selectedKey!;
        this.setup = undefined;
        this.plan = undefined;
        this.canaryPlan = undefined;
      }
      return { type: 'scanKey' as const, requestId, keyFile: this.keyFile };
    }
    this.busy = true;
    try {
      if (request.type === 'scanSource') {
        if (await inGitTree(this.source))
          throw new CliError('SOURCE_PATH_REFUSED');
        const config = parseSource({
          schemaVersion: 1,
          name: 'desktop',
          baseUrl: request.baseUrl,
          model: request.model,
          profile: request.profile,
          entriesPerRequest: request.entriesPerRequest,
          ...(this.keyFile ? { keyFile: this.keyFile } : {}),
        });
        await mkdir(dirname(this.source), { recursive: true });
        const parent = await lstat(dirname(this.source));
        const existing = await lstat(this.source).catch((error: unknown) => {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            return null;
          throw error;
        });
        if (
          !parent.isDirectory() ||
          parent.isSymbolicLink() ||
          existing?.isSymbolicLink() ||
          (await inGitTree(
            join(await realpath(dirname(this.source)), 'source.json'),
          ))
        )
          throw new CliError('SOURCE_PATH_REFUSED');
        const temporary = this.source + '.' + crypto.randomUUID() + '.tmp';
        try {
          const file = await open(temporary, 'wx', 0o600);
          try {
            await file.writeFile(JSON.stringify(config, null, 2) + '\n');
            await file.sync();
          } finally {
            await file.close();
          }
          await rename(temporary, this.source);
        } finally {
          await rm(temporary, { force: true });
        }
        this.plan = undefined;
        this.canaryPlan = undefined;
        this.setup = DesktopScanSetupSchema.parse({
          origin: new URL(config.baseUrl).origin,
          model: config.model,
          keyFile: sourceKeyPath(config, this.source),
          local: loopback(new URL(config.baseUrl).hostname),
          modelListed: null,
          answeringModel: null,
          structuredOutput: null,
          usageReported: null,
          cachedTokensReported: null,
          entriesPerRequest: config.entriesPerRequest,
        });
        return { type: 'scanSource' as const, requestId, setup: this.setup };
      }
      if (!this.setup) throw new CliError('ENDPOINT_NOT_CONFIRMED');
      if (request.type === 'scanCheck') {
        this.plan = undefined;
        this.canaryPlan = undefined;
        this.controller = new AbortController();
        this.checking = checkScanSource({
          source: this.source,
          signal: this.controller.signal,
          progress: () => {},
        });
        const result = await this.checking;
        this.setup = DesktopScanSetupSchema.parse({
          ...this.setup,
          modelListed: result.data.modelListed,
          answeringModel: result.data.recordedCheck
            ? result.data.answeringModel
            : null,
          structuredOutput: result.data.structuredOutput,
          usageReported: result.data.usageReported,
          cachedTokensReported: result.data.cachedTokensReported,
        });
        return { type: 'scanCheck' as const, requestId, setup: this.setup };
      }
      if (!this.setup.answeringModel || !this.setup.structuredOutput)
        throw new CliError('ENDPOINT_NOT_CONFIRMED');
      if (request.type === 'scanPlan') {
        const result = await runScan({
          workspace: this.workspace,
          source: this.source,
          account: request.accountKey,
          dryRun: true,
          signal: new AbortController().signal,
          now: this.now,
          progress: () => {},
        });
        if (!result.data.dryRun || !result.data.entries)
          throw new CliError('STALE_PLAN');
        this.plan = {
          accountKey: request.accountKey,
          planHash: result.data.plan,
          planned: result.data.entries.planned,
          skipped: result.data.entries.skipped.currentSource,
          uniqueTexts: result.data.entries.uniqueTexts,
          requests: result.data.requests.planned,
          alreadyDecided: result.data.entries.alreadyDecided,
        };
        return { type: 'scanPlan' as const, requestId, plan: this.plan };
      }
      if (
        request.origin !== this.setup.origin ||
        request.answeringModel !== this.setup.answeringModel ||
        !request.agreed
      )
        throw new CliError('ENDPOINT_NOT_CONFIRMED');
      if (
        !this.plan ||
        request.planHash !== this.plan.planHash ||
        (request.resume && this.canaryPlan !== request.planHash)
      )
        throw new CliError('STALE_PLAN');
      // Revalidate offline before reporting a run as started. runScan repeats all
      // checks before its own request, including source/criteria/account hashes.
      const config = await loadSourceConfig(this.source);
      if (
        config.check?.answeringModel !== request.answeringModel ||
        config.check.origin !== request.origin
      )
        throw new CliError('ENDPOINT_NOT_CONFIRMED');
      const checked = await runScan({
        workspace: this.workspace,
        source: this.source,
        account: this.plan.accountKey,
        dryRun: true,
        signal: new AbortController().signal,
        now: this.now,
        progress: () => {},
      });
      if (checked.data.plan !== request.planHash)
        throw new CliError('STALE_PLAN');
      await this.task;
      const limit = request.resume ? null : 50;
      const planned = Math.min(
        checked.data.entries?.planned ?? 0,
        limit ?? Infinity,
      );
      this.controller = new AbortController();
      const signal = this.controller.signal;
      this.update({
        phase: 'running',
        runId: crypto.randomUUID(),
        planHash: request.planHash,
        limit,
        planned,
        stored: 0,
        remaining: planned,
        requests: 0,
        retries: 0,
        secondPassEntries: 0,
        batchSize: config.entriesPerRequest,
        tokens: {
          promptTokens: null,
          cachedPromptTokens: null,
          completionTokens: null,
        },
        pauseRequested: false,
        canResume: false,
        stopCode: null,
      });
      this.controls = new this.Control(this.now, (phase, pending) =>
        this.update({
          ...(phase ? { phase: phase.phase } : {}),
          pauseRequested: pending,
        }),
      );
      const controls = this.controls;
      const checkpoint = async (requestSignal: AbortSignal) => {
        await controls.checkpoint(async () => {}, requestSignal);
        requestSignal.throwIfAborted();
      };
      // Return the bounded running view before the asynchronous run settles.
      const initial = structuredClone(this.view);
      const run = {
        workspace: this.workspace,
        source: this.source,
        account: this.plan.accountKey,
        plan: request.planHash,
        confirmEndpoint: request.origin,
        confirmModel: request.answeringModel,
        ...(limit ? { limit } : {}),
        signal,
        now: this.now,
      };
      this.task = Promise.resolve()
        .then(async () => {
          const result = await runScan({
            ...run,
            controls: {
              checkpoint,
              wait: (seconds, waitSignal) =>
                controls.delay(
                  seconds * 1000,
                  async (ms, sleepSignal) => {
                    await new Promise<void>((resolve, reject) => {
                      const abort = () => {
                        clearTimeout(timer);
                        reject(new CliError('RUN_STOPPED'));
                      };
                      const timer = setTimeout(() => {
                        sleepSignal.removeEventListener('abort', abort);
                        resolve();
                      }, ms);
                      if (sleepSignal.aborted) abort();
                      else
                        sleepSignal.addEventListener('abort', abort, {
                          once: true,
                        });
                    });
                  },
                  async () => {},
                  waitSignal,
                ),
            },
            progress: (text) => {
              // Human CLI sharing lines and any unrecognized JSON stay in engine.
              try {
                const value: unknown = JSON.parse(text);
                if (value && typeof value === 'object' && 'stored' in value) {
                  const parsed = DesktopScanViewSchema.safeParse({
                    ...this.view,
                    ...Object.fromEntries(
                      Object.entries(value).filter(([key]) =>
                        [
                          'stored',
                          'remaining',
                          'requests',
                          'retries',
                          'secondPassEntries',
                          'batchSize',
                          'tokens',
                        ].includes(key),
                      ),
                    ),
                  });
                  if (parsed.success) this.update(parsed.data);
                }
              } catch {
                /* Not aggregate progress. */
              }
            },
          });
          const code = DesktopCliErrorCodeSchema.safeParse(
            result.data.stopDetail,
          );
          if (!result.data.stopDetail) this.canaryPlan = request.planHash;
          this.update({
            phase: 'ended',
            pauseRequested: false,
            canResume:
              this.canaryPlan === request.planHash &&
              (checked.data.entries?.planned ?? 0) > this.view.stored,
            stopCode: signal.aborted
              ? 'RUN_STOPPED'
              : code.success
                ? code.data
                : result.data.stopDetail
                  ? 'SCAN_FAILED'
                  : null,
          });
        })
        .catch((error: unknown) => {
          const parsed = DesktopCliErrorCodeSchema.safeParse(
            error instanceof CliError ? error.code : null,
          );
          this.update({
            phase: 'ended',
            pauseRequested: false,
            canResume:
              this.canaryPlan === request.planHash &&
              (checked.data.entries?.planned ?? 0) > this.view.stored,
            stopCode: signal.aborted
              ? 'RUN_STOPPED'
              : parsed.success
                ? parsed.data
                : 'SCAN_FAILED',
          });
        });
      return { type: 'scanStart' as const, requestId, view: initial };
    } finally {
      this.busy = false;
    }
  }
  async close() {
    this.controller?.abort();
    this.controls?.stop();
    await this.task;
    await this.checking?.catch(() => {});
  }
}
