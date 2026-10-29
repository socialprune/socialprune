import { chromium } from 'playwright-core';
import { z } from 'zod';
import { startEngine } from '../../src/engine-host/host.ts';
import { openTestEngine } from '../../../cli/e2e/engine-test-entry.ts';
import {
  processIdentities,
  assertNoRemainingProcesses,
  BROWSER_CLEANUP_TIMEOUT_MS,
} from '../windows.ts';
import { closeProbe } from '../probe-cleanup.ts';
import { recordCleanup } from '../../e2e/cleanup-receipt.ts';
import type { ProcessIdentity } from '../windows.ts';
import type { BrowserContext } from 'playwright-core';
import { join } from 'node:path';
import { setQueryMeasurementDirectory } from '../../packaging/windows-powershell.ts';
import { setWindowsQueryExecutable } from '../../packaging/windows-query.ts';
import { WindowBoundsSchema } from '../../../cli/src/browser/owned-window.ts';
import type { CDPSession } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
const displayCommands = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('displayPosition'),
    bounds: WindowBoundsSchema,
  }),
  z.strictObject({ type: z.literal('displayClose') }),
]);
let displayCdp: CDPSession | undefined;
let displayWindowId: number | undefined;

const ProbeSchema = z.strictObject({
  type: z.literal('browserProbe'),
  executable: z.string().min(1),
  profile: z.string().min(1),
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1';
  }),
});
const contexts: BrowserContext[] = [];
const commandLines: string[][] = [];
const browserProcesses = new Map<string, ProcessIdentity>();
const browserEvents: {
  event: string;
  url: string;
  at: number;
  detail?: string;
}[] = [];
let now = Date.parse('2026-10-15T12:00:00.000Z');
let probeDirectory: string | undefined;
const probeContexts = new Set<BrowserContext>();
const probeTasks = new Set<Promise<void>>();
startEngine(async (options) => {
  probeDirectory = options.dataFolder;
  setQueryMeasurementDirectory(join(options.dataFolder, 'query-measurements'));
  setWindowsQueryExecutable(join(options.dataFolder, 'desktop-query.exe'));
  const engine = await openTestEngine(options, {
    xOrigin: options.dataFolder.endsWith('display-producer')
      ? 'http://127.0.0.1:4771'
      : 'http://127.0.0.1:4656',
    headed: options.dataFolder.endsWith('display-producer'),
    instagramOrigin: 'http://127.0.0.1:4661',
    now: () => new Date(now),
    sleep: (ms) => {
      now += ms;
      return Promise.resolve();
    },
    async launched(context) {
      contexts.push(context);
      context.on('request', (request) =>
        browserEvents.push({
          event: 'request',
          url: request.url(),
          at: Date.now(),
        }),
      );
      context.on('requestfinished', (request) =>
        browserEvents.push({
          event: 'finished',
          url: request.url(),
          at: Date.now(),
        }),
      );
      context.on('requestfailed', (request) =>
        browserEvents.push({
          event: 'failed',
          url: request.url(),
          at: Date.now(),
          detail: request.failure()?.errorText,
        }),
      );
      for (const page of context.pages())
        page.on('pageerror', (error) =>
          browserEvents.push({
            event: 'pageerror',
            url: page.url(),
            at: Date.now(),
            detail: error.message,
          }),
        );
      const cdp = await context.newCDPSession(context.pages()[0]!);
      commandLines.push(
        (await cdp.send('Browser.getBrowserCommandLine')).arguments,
      );
      await cdp.detach();
      // The dedicated display foundation proves exact-window ownership through
      // the real host seam. Legacy native PID observations remain unchanged
      // for the existing run proofs; they are not its launch precondition.
      if (options.dataFolder.endsWith('display-producer')) return;
      const browser = context.browser();
      if (!browser) throw new Error('BROWSER_PROCESS_ID_MISSING');
      const system = await browser.newBrowserCDPSession();
      const identities = await processIdentities(
        (await system.send('SystemInfo.getProcessInfo')).processInfo.map(
          (info) => Number(info.id),
        ),
      );
      if (!identities.length) throw new Error('BROWSER_PROCESS_ID_MISSING');
      for (const identity of identities)
        browserProcesses.set(`${identity.pid}|${identity.born}`, identity);
      await system.detach();
    },
  });
  const windowRequest = engine.window.bind(engine);
  engine.window = async (request) => {
    const started = performance.now();
    process.parentPort.postMessage({
      type: 'windowBoundary',
      phase: 'started',
      request,
      at: started,
      now: Date.now(),
    });
    try {
      const reply = await windowRequest(request);
      if (reply.type === 'unavailable') {
        try {
          const context = contexts.at(-1)!;
          const page = context.pages()[0]!;
          const cdp = await context.newCDPSession(page);
          const target = await cdp.send('Browser.getWindowForTarget');
          const bounds = await cdp.send('Browser.getWindowBounds', {
            windowId: target.windowId,
          });
          await cdp.detach();
          process.parentPort.postMessage({
            type: 'windowBoundary',
            phase: 'unavailable-raw',
            request,
            target,
            bounds,
          });
        } catch (error) {
          process.parentPort.postMessage({
            type: 'windowBoundary',
            phase: 'unavailable-raw-failed',
            error: String(error),
          });
        }
      }
      process.parentPort.postMessage({
        type: 'windowBoundary',
        phase: 'returned',
        request,
        reply,
        elapsedMs: performance.now() - started,
        now: Date.now(),
      });
      return reply;
    } catch (error) {
      process.parentPort.postMessage({
        type: 'windowBoundary',
        phase: 'failed',
        request,
        elapsedMs: performance.now() - started,
        error: String(error),
      });
      throw error;
    }
  };
  return {
    ...engine,
    async close() {
      // Shutdown can arrive while a probe is navigating or collecting identities.
      // Its test-owned context must settle before the host claims closed/exits.
      await Promise.all([...probeContexts].map((context) => context.close()));
      await Promise.all(probeTasks);
      await engine.close();
    },
  };
});
process.parentPort.on('message', (event: Electron.MessageEvent) => {
  const display = displayCommands.safeParse(event.data);
  if (display.success) {
    void (async () => {
      if (display.data.type === 'displayClose') {
        await Promise.all(contexts.map((context) => context.close()));
        return { closed: true };
      }
      const context = contexts.at(-1);
      if (!context) throw new Error('DISPLAY_CONTEXT_MISSING');
      const page = context.pages()[0];
      if (!page) throw new Error('DISPLAY_PAGE_MISSING');
      displayCdp ??= await context.newCDPSession(page);
      displayWindowId ??= (await displayCdp.send('Browser.getWindowForTarget'))
        .windowId;
      const bounds = display.data.bounds;
      await displayCdp.send('Browser.setWindowBounds', {
        windowId: displayWindowId,
        bounds: {
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
      });
      return { positioned: true };
    })()
      .then((value) =>
        process.parentPort.postMessage({ type: 'displayControl', ...value }),
      )
      .catch(() =>
        process.parentPort.postMessage({
          type: 'displayControl',
          failed: true,
        }),
      );
    return;
  }
  if (event.data === 'runProbe') {
    void Promise.all(
      contexts
        .flatMap((context) => context.pages())
        .map(async (page) => ({
          url: page.url(),
          html: await page.content().catch(() => 'PAGE_CLOSED'),
        })),
    ).then((pages) =>
      process.parentPort.postMessage({
        type: 'runProbe',
        commandLines,
        browserEvents,
        pids: [...browserProcesses.values()].map((entry) => entry.pid),
        processes: [...browserProcesses.values()],
        pages,
        openPages: contexts.reduce(
          (sum, context) => sum + context.pages().length,
          0,
        ),
      }),
    );
    return;
  }
  if (event.data === 'closeBrowsers') {
    void Promise.all(contexts.map((context) => context.close())).then(() =>
      process.parentPort.postMessage({ type: 'browsersClosed' }),
    );
    return;
  }
  const probe = ProbeSchema.safeParse(event.data);
  if (!probe.success) return;
  const task = (async () => {
    let context: BrowserContext | undefined;
    let identities: ProcessIdentity[] = [];
    let phase = 'launch';
    let failure: string | undefined;
    let title: string | undefined;
    let closed = false;
    const receipt = join(
      probeDirectory!,
      `release-browser-probe-${crypto.randomUUID()}.json`,
    );
    const started = performance.now();
    const record = () =>
      writeFile(
        receipt,
        JSON.stringify({
          phase,
          elapsedMs: Math.ceil(performance.now() - started),
          processes: identities,
          closed,
          failure: failure ?? null,
        }),
      );
    try {
      await record();
      context = await chromium.launchPersistentContext(probe.data.profile, {
        executablePath: probe.data.executable,
        headless: false,
        chromiumSandbox: true,
        args: ['--disable-background-networking'],
      });
      probeContexts.add(context);
      phase = 'identify';
      await record();
      const browser = context.browser();
      if (!browser) throw new Error('BROWSER_PROCESS_ID_MISSING');
      const cdp = await browser.newBrowserCDPSession();
      const processes = await cdp.send('SystemInfo.getProcessInfo');
      const pids = processes.processInfo.map((info) => Number(info.id));
      identities = await processIdentities(pids);
      if (!identities.length) throw new Error('BROWSER_PROCESS_ID_MISSING');
      await cdp.detach();
      // Publish ownership before navigation, so a failed/timed-out probe still
      // leaves the harness the exact PID/birth pairs it must await.
      process.parentPort.postMessage({
        type: 'browserProbeStarted',
        processes: identities,
      });
      phase = 'navigate';
      await record();
      await context.route('**/*', async (route) => {
        if (
          new URL(route.request().url()).origin !==
          new URL(probe.data.url).origin
        )
          await route.abort();
        else await route.continue();
      });
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(probe.data.url);
      title = await page.title();
    } catch (error) {
      if (error instanceof Error && 'query' in error)
        console.error('BROWSER_PROBE_QUERY_FAILED', error.message);
      failure = phase;
    } finally {
      phase = 'close-and-exit';
      await record();
      try {
        await closeProbe({
          close: async () => {
            await context?.close();
          },
          wait: () =>
            recordCleanup('browser', {
              directory: probeDirectory,
              timeoutMs: BROWSER_CLEANUP_TIMEOUT_MS,
              close: () => Promise.resolve(),
              wait: async () => {
                if (!identities.length)
                  throw new Error('BROWSER_PROCESS_ID_MISSING');
                await assertNoRemainingProcesses(identities);
              },
            }),
        });
        closed = true;
      } catch {
        failure ??= 'close-or-exit';
      }
      phase = 'settled';
      await record();
      if (context) probeContexts.delete(context);
      process.parentPort.postMessage({
        type: 'browserProbeResult',
        title,
        closed,
        pids: identities.map((entry) => entry.pid),
        processes: identities,
        ...(failure ? { error: 'BROWSER_PROBE_FAILED', phase: failure } : {}),
      });
    }
  })();
  probeTasks.add(task);
  void task
    .finally(() => probeTasks.delete(task))
    .catch(() => console.error('BROWSER_PROBE_RECEIPT_FAILED'));
});
