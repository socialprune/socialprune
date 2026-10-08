import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { chromium } from '@playwright/test';
import type { Browser, BrowserContext, Worker } from '@playwright/test';
import type { ArchiveEntry, GeneratorManifest } from './measure-archive.ts';
import { bytes, cpuLoad, delay, execute, stop, web } from './measure-system.ts';

export const origin = 'http://127.0.0.1:4175';
const url = `${origin}/socialprune/#/import`;
interface Sample {
  at: number;
  workingBytes: number;
  privateBytes: number;
  processes: number[];
}
interface ProcessInfo {
  id: number;
  type: string;
}
interface ReadRange {
  start: number;
  end: number;
}
interface Trace {
  selectionAt: number | null;
  terminalAt: number | null;
  terminalType: string | null;
  abortAt: number | null;
  abortProgress: number | null;
  messages: { type: string; items: number | null }[];
  policy: string[];
  policyDetails: {
    directive: string;
    source: string;
    line: number;
    sample: string;
  }[];
}
interface StoreCounts {
  tables: Record<string, number>;
  importStatuses: { complete: number; incomplete: number; other: number };
}

async function storeCounts(
  worker: Worker,
  workspaceId: string,
): Promise<StoreCounts> {
  return worker.evaluate(async (id) => {
    const name = `sp-ws-${id}`;
    if (
      !(await indexedDB.databases()).some((database) => database.name === name)
    )
      throw new Error('Measured workspace database does not exist.');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(new Error('Readback open failed.'));
      open.onupgradeneeded = () => {
        open.transaction?.abort();
        reject(new Error('Measurement readback cannot create a database.'));
      };
    });
    try {
      const names = Array.from(db.objectStoreNames);
      const tx = db.transaction(names, 'readonly');
      const finished = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(new Error('Readback failed.'));
      });
      const counts = names.map(
        (table) =>
          new Promise<[string, number]>((resolve, reject) => {
            const request = tx.objectStore(table).count();
            request.onsuccess = () => resolve([table, request.result]);
            request.onerror = () => reject(new Error('Count failed.'));
          }),
      );
      const statuses = { complete: 0, incomplete: 0, other: 0 };
      const cursor = tx.objectStore('imports').openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const status = (row.value as { status: string }).status;
        if (status === 'complete' || status === 'incomplete')
          statuses[status]++;
        else statuses.other++;
        row.continue();
      };
      const tables = Object.fromEntries(await Promise.all(counts));
      await finished;
      return { tables, importStatuses: statuses };
    } finally {
      db.close();
    }
  }, workspaceId);
}

async function installReadAudit(worker: Worker) {
  await worker.evaluate(() => {
    const reads: { start: number; end: number }[] = [];
    Reflect.set(globalThis, '__measurementReads', reads);
    const slice = Object.getOwnPropertyDescriptor(Blob.prototype, 'slice')!
      .value as Blob['slice'];
    Blob.prototype.slice = function (
      this: Blob,
      start = 0,
      end = this.size,
      contentType?: string,
    ) {
      const normalize = (value: number) =>
        Math.min(this.size, value < 0 ? Math.max(this.size + value, 0) : value);
      reads.push({ start: normalize(start), end: normalize(end) });
      return slice.call(this, start, end, contentType);
    };
  });
}

export async function measure(
  name: string,
  archive: string,
  manifest: GeneratorManifest,
  abort: boolean,
  padding: ArchiveEntry[],
  signal: AbortSignal,
) {
  const load = await cpuLoad(signal);
  console.error(`${name} start CPU ${load.totalCpuPercent.toFixed(2)}%`);
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let sampler: ChildProcess | undefined;
  let profilePath: string | undefined;
  let profilesBeforeClose = 0;
  const abortCleanup: { closed: Promise<void> | null } = { closed: null };
  const onAbort = () => {
    if (browser) abortCleanup.closed = browser.close();
  };
  signal.addEventListener('abort', onAbort, { once: true });
  let inventory: ProcessInfo[] = [];
  const samples: Sample[] = [];
  const samplerState: { failure: Error | null } = { failure: null };
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--enable-automation'],
    });
    signal.throwIfAborted();
    const processSession = await browser.newBrowserCDPSession();
    const commandLine = await processSession.send(
      'Browser.getBrowserCommandLine',
    );
    profilePath = commandLine.arguments
      .find((argument) => argument.startsWith('--user-data-dir='))
      ?.slice('--user-data-dir='.length);
    if (!profilePath || relative(tmpdir(), profilePath).startsWith('..'))
      throw new Error('Disposable Chromium profile was not identified.');
    context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const network = {
      requests: 0,
      external: [] as string[],
      failed: [] as string[],
    };
    const errors: string[] = [];
    context.on('request', (request) => {
      network.requests++;
      if (new URL(request.url()).origin !== origin)
        network.external.push(request.url());
    });
    context.on('requestfailed', (request) =>
      network.failed.push(request.url()),
    );
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(
      (halfway) => {
        const trace: Trace = {
          selectionAt: null,
          terminalAt: null,
          terminalType: null,
          abortAt: null,
          abortProgress: null,
          messages: [],
          policy: [],
          policyDetails: [],
        };
        Reflect.set(globalThis, '__measurementTrace', trace);
        document.addEventListener(
          'change',
          (event) => {
            if (
              event.target instanceof HTMLInputElement &&
              event.target.dataset.testid === 'archives'
            )
              trace.selectionAt = performance.now();
          },
          true,
        );
        document.addEventListener('securitypolicyviolation', (event) => {
          trace.policy.push(event.effectiveDirective);
          trace.policyDetails.push({
            directive: event.effectiveDirective,
            source: event.sourceFile,
            line: event.lineNumber,
            sample: event.sample,
          });
        });
        const NativeWorker = Worker;
        globalThis.Worker = class extends NativeWorker {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            this.addEventListener(
              'message',
              (
                event: MessageEvent<{
                  type: string;
                  id?: number;
                  items?: number;
                }>,
              ) => {
                if (event.data.id === undefined) return;
                const type = event.data.type;
                trace.messages.push({ type, items: event.data.items ?? null });
                if (['summary', 'aborted', 'error'].includes(type)) {
                  trace.terminalAt = performance.now();
                  trace.terminalType = type;
                }
                if (
                  halfway > 0 &&
                  type === 'progress' &&
                  (event.data.items ?? 0) >= halfway &&
                  trace.abortProgress === null
                ) {
                  trace.abortProgress = event.data.items ?? 0;
                  // Trigger on a committed-batch progress event, not a Node poll
                  // that can race completion. Only the real app button is used.
                  const button = document.querySelector<HTMLButtonElement>(
                    '[data-testid="abort-button"]',
                  );
                  if (!button || button.disabled)
                    throw new Error('Abort is not enabled halfway.');
                  button.click();
                }
              },
            );
          }
          override postMessage(
            message: unknown,
            transferOrOptions?: Transferable[] | StructuredSerializeOptions,
          ) {
            if ((message as { type?: string }).type === 'abort')
              trace.abortAt = performance.now();
            if (Array.isArray(transferOrOptions))
              super.postMessage(message, transferOrOptions);
            else super.postMessage(message, transferOrOptions);
          }
        };
      },
      abort ? Math.ceil(manifest.count / 2) : 0,
    );
    await page.goto(url);
    try {
      await page.waitForFunction(
        () =>
          window.socialprune?.getImportSnapshot().phase === 'idle' &&
          document.querySelector('main')?.getAttribute('data-gate') ===
            'ready' &&
          Boolean(window.workspace?.summary),
      );
      await page.waitForFunction(() =>
        Boolean(navigator.serviceWorker.controller),
      );
    } catch {
      const state = await page.evaluate(() => ({
        gate: document.querySelector('main')?.getAttribute('data-gate'),
        phase: window.socialprune?.getImportSnapshot().phase,
        workspace: Boolean(window.workspace?.summary),
        control: Boolean(navigator.serviceWorker.controller),
        text: document.body.innerText,
        trace: Reflect.get(globalThis, '__measurementTrace') as Trace,
      }));
      throw new Error(
        `Measurement page not ready: ${JSON.stringify({ state, errors, network })}`,
      );
    }
    // The gate worker is terminated before ready. Select both live entries
    // explicitly, never page.workers()[0] (now a different ownership path).
    const workers = page.workers();
    const imports = workers.filter((worker) =>
      /\/worker-[\w-]+\.js$/.test(worker.url()),
    );
    const workspaces = workers.filter((worker) =>
      /\/workspace-worker-[\w-]+\.js$/.test(worker.url()),
    );
    if (imports.length !== 1 || workspaces.length !== 1)
      throw new Error(
        `Expected import and workspace workers: ${workers.map((worker) => worker.url()).join(',')}`,
      );
    const importWorker = imports[0]!;
    const workspaceWorker = workspaces[0]!;
    await installReadAudit(importWorker);
    const workspaceId = await page.evaluate(
      () => window.workspace.summary!.workspaceId,
    );
    const initialStore = await storeCounts(workspaceWorker, workspaceId);
    if (initialStore.tables.items !== 0 || initialStore.tables.imports !== 0)
      throw new Error('Measurement requires a fresh empty workspace.');
    inventory = (
      (await processSession.send('SystemInfo.getProcessInfo')) as {
        processInfo: ProcessInfo[];
      }
    ).processInfo;
    sampler = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        join(web, 'scripts/memory-sampler.ps1'),
        '-ProcessIds',
        inventory.map(({ id }) => id).join(','),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], signal },
    );
    sampler.on('error', (error) => {
      samplerState.failure = error;
    });
    let buffered = '';
    let samplerErrors = '';
    sampler.stderr?.on('data', (chunk: Buffer) => {
      samplerErrors += chunk.toString();
    });
    sampler.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString();
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines)
        if (line.trim()) {
          try {
            samples.push(JSON.parse(line) as Sample);
          } catch {
            samplerState.failure = new Error('Invalid memory sample.');
          }
        }
    });
    const deadline = Date.now() + 10_000;
    while (samples.length < 3 && Date.now() < deadline) await delay(100);
    const baseline = samples.at(-1);
    if (
      !baseline ||
      samplerState.failure ||
      baseline.processes.length !== inventory.length
    )
      throw new Error(`Memory sampler initialization failed: ${samplerErrors}`);
    await page.getByTestId('archives').setInputFiles(archive);
    await page.getByTestId('import-button').click();
    await page.waitForFunction(
      () => {
        const phase = window.socialprune.getImportSnapshot().phase;
        return ['complete', 'aborted', 'error'].includes(phase);
      },
      undefined,
      { timeout: 300_000 },
    );
    const receipt = await page.evaluate(() => {
      const snapshot = window.socialprune.getImportSnapshot();
      const trace = Reflect.get(globalThis, '__measurementTrace') as Trace;
      return {
        phase: snapshot.phase,
        progressItems: snapshot.receivedItems,
        batches: snapshot.batches,
        clientDurationMs: snapshot.durationMs,
        clientAbortMs: snapshot.abortLatencyMs,
        summary: snapshot.summary,
        pageItems: snapshot.items.length,
        pageRows: window.workspace.rows.length,
        policyViolations: snapshot.policyViolations,
        trace,
      };
    });
    const { trace } = receipt;
    if (trace.selectionAt === null || trace.terminalAt === null)
      throw new Error('File selection or terminal receipt was not observed.');
    if (receipt.pageItems !== 0 || receipt.pageRows > 200)
      throw new Error('Page retained an unbounded item collection.');
    if (abort) {
      if (
        receipt.phase !== 'aborted' ||
        trace.terminalType !== 'aborted' ||
        trace.abortAt === null ||
        trace.abortProgress === null ||
        trace.abortProgress !== Math.ceil(manifest.count / 2) ||
        receipt.progressItems >= manifest.count ||
        !(receipt.clientAbortMs! > 0)
      )
        throw new Error(
          'Halfway abort did not receive its terminal acknowledgement.',
        );
    } else if (
      receipt.phase !== 'complete' ||
      trace.terminalType !== 'summary' ||
      receipt.progressItems !== manifest.count ||
      receipt.summary?.status !== 'ok' ||
      receipt.summary.records.reduce(
        (sum, record) => sum + record.itemCount,
        0,
      ) !== manifest.count
    )
      throw new Error(
        'Complete import receipt differs from generated manifest.',
      );
    const storeAtAcknowledgement = abort
      ? await storeCounts(workspaceWorker, workspaceId)
      : null;
    if (
      storeAtAcknowledgement &&
      Object.entries(storeAtAcknowledgement.tables).some(
        ([table, count]) => !['meta', 'runtime'].includes(table) && count !== 0,
      )
    )
      throw new Error(
        'Abort acknowledgement arrived before the store was purged.',
      );
    await delay(abort ? 5000 : 500);
    signal.throwIfAborted();
    await stop(sampler);
    const processesAfter = (
      (await processSession.send('SystemInfo.getProcessInfo')) as {
        processInfo: ProcessInfo[];
      }
    ).processInfo;
    if (
      processesAfter.length !== inventory.length ||
      processesAfter.some(
        ({ id }) => !inventory.some((process) => process.id === id),
      )
    )
      throw new Error('Chromium process inventory changed during sampling.');
    const measured = samples.filter(({ at }) => at >= baseline.at);
    if (
      samplerState.failure ||
      measured.length < 3 ||
      measured.some(
        ({ processes }) =>
          processes.length !== inventory.length ||
          inventory.some(({ id }) => !processes.includes(id)),
      )
    )
      throw new Error('Chromium memory sampling is incomplete.');
    const after = measured.at(-1)!;
    const archiveReads = await importWorker.evaluate(
      () => Reflect.get(globalThis, '__measurementReads') as ReadRange[],
    );
    const paddingReadBytes = archiveReads.reduce(
      (sum, read) =>
        sum +
        padding.reduce(
          (total, entry) =>
            total +
            Math.max(
              0,
              Math.min(read.end, entry.payloadEnd) -
                Math.max(read.start, entry.payloadStart),
            ),
          0,
        ),
      0,
    );
    if (!archiveReads.length || paddingReadBytes !== 0)
      throw new Error(
        `ZIP read audit failed: ${JSON.stringify({ paddingReadBytes, archiveReads })}`,
      );
    const finalStore = await storeCounts(workspaceWorker, workspaceId);
    const protocol = await page.evaluate(async () => {
      const opened = await window.workspace.open();
      if (opened.type !== 'opened')
        throw new Error('Count readback did not open workspace.');
      let projectedItems = 0;
      for (const account of opened.summary.accounts) {
        const query = await window.workspace.request({
          type: 'query',
          requestId: crypto.randomUUID(),
          queryId: crypto.randomUUID(),
          generation: 1,
          accountKey: account.key,
          filter: {},
          sort: [{ by: 'id', direction: 'asc' }],
          search: '',
        });
        if (query.type !== 'queryResult')
          throw new Error('Projection readback did not return.');
        projectedItems += query.total;
      }
      return {
        summary: opened.summary,
        projectedItems,
        pageRows: window.workspace.rows.length,
        diagnostics: window.workspace.diagnostics,
      };
    });
    const expected = abort ? 0 : manifest.count;
    if (
      finalStore.tables.items !== expected ||
      finalStore.tables.state !== expected ||
      protocol.summary.counts.items !== expected ||
      protocol.projectedItems !== expected ||
      finalStore.importStatuses.incomplete !== 0 ||
      finalStore.importStatuses.other !== 0 ||
      finalStore.tables.imports !==
        (abort ? 0 : receipt.summary!.records.length)
    )
      throw new Error(
        `Stored import state differs: ${JSON.stringify({ expected, finalStore, protocol })}`,
      );
    if (
      abort &&
      Object.entries(finalStore.tables).some(
        ([table, count]) => !['meta', 'runtime'].includes(table) && count !== 0,
      )
    )
      throw new Error(
        'Aborted import left durable item, state, import or event rows.',
      );
    if (
      network.requests === 0 ||
      network.external.length ||
      network.failed.length ||
      errors.length ||
      trace.policy.length ||
      receipt.policyViolations.length
    )
      throw new Error(
        `Browser audit failed: ${JSON.stringify({ network, errors, policy: trace.policyDetails })}`,
      );
    const intervals = measured
      .slice(1)
      .map((sample, index) => sample.at - measured[index]!.at);
    const row = {
      name,
      startedAt: new Date(baseline.at).toISOString(),
      cpuLoadAtStart: load,
      status: receipt.phase,
      expectedItems: manifest.count,
      storedItems: finalStore.tables.items,
      progressItems: receipt.progressItems,
      batches: receipt.batches,
      wallMs: trace.terminalAt - trace.selectionAt,
      clientDurationMs: receipt.clientDurationMs,
      abortMs: trace.abortAt === null ? null : trace.terminalAt - trace.abortAt,
      clientAbortMs: receipt.clientAbortMs,
      abortAtProgressItems: trace.abortProgress,
      pageItems: receipt.pageItems,
      pageRows: receipt.pageRows,
      initialStore,
      storeAtAcknowledgement,
      finalStore,
      protocol,
      memory: {
        requestedIntervalMs: 100,
        sampleCount: measured.length,
        meanIntervalMs:
          intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
        maxIntervalMs: Math.max(...intervals),
        baseline,
        end: after,
        peakWorkingBytes: Math.max(
          ...measured.map(({ workingBytes }) => workingBytes),
        ),
        peakPrivateBytes: Math.max(
          ...measured.map(({ privateBytes }) => privateBytes),
        ),
        settleMs: abort ? 5000 : 500,
        samples: measured,
      },
      browserVersion: browser.version(),
      processes: inventory,
      processesAfter,
      workers: {
        import: importWorker.url(),
        workspace: workspaceWorker.url(),
        serviceWorkerControlled: true,
      },
      archiveReadBytes: archiveReads.reduce(
        (sum, read) => sum + read.end - read.start,
        0,
      ),
      archiveReadCount: archiveReads.length,
      paddingReadBytes,
      archiveReads,
      trace,
      network,
      cleanup: {
        samplerStopped: true,
        profileRemoved: false,
        browserPidsRemaining: [] as number[],
      },
      profile: { path: profilePath, bytesBeforeClose: 0, bytesAfterClose: -1 },
    };
    profilesBeforeClose = await bytes(profilePath);
    await context.close();
    context = undefined;
    await browser.close();
    browser = undefined;
    row.profile.bytesBeforeClose = profilesBeforeClose;
    row.profile.bytesAfterClose = await bytes(profilePath);
    const { stdout } = await execute(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Console]::WriteLine((@{ ids = @(Get-Process -Id ${inventory.map(({ id }) => id).join(',')} -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) } | ConvertTo-Json -Compress))`,
      ],
      { timeout: 15_000 },
    );
    row.cleanup.browserPidsRemaining = (
      JSON.parse(stdout) as { ids: number[] }
    ).ids;
    row.cleanup.profileRemoved = row.profile.bytesAfterClose === 0;
    if (!row.cleanup.profileRemoved || row.cleanup.browserPidsRemaining.length)
      throw new Error('Disposable Chromium cleanup did not finish.');
    return row;
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (sampler) await stop(sampler);
    await context?.close();
    if (abortCleanup.closed) await abortCleanup.closed;
    else await browser?.close();
  }
}
