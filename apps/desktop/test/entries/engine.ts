import { chromium } from 'playwright-core';
import { z } from 'zod';
import { startEngine } from '../../src/engine-host/host.ts';
import { openTestEngine } from '../../../cli/e2e/engine-test-entry.ts';
import { processIdentities } from '../windows.ts';
import type { ProcessIdentity } from '../windows.ts';
import type { BrowserContext } from 'playwright-core';
import { join } from 'node:path';
import { setQueryMeasurementDirectory } from '../../packaging/windows-powershell.ts';
import { setWindowsQueryExecutable } from '../../packaging/windows-query.ts';

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
startEngine((options) => {
  setQueryMeasurementDirectory(join(options.dataFolder, 'query-measurements'));
  setWindowsQueryExecutable(join(options.dataFolder, 'desktop-query.exe'));
  return openTestEngine(options, {
    xOrigin: 'http://127.0.0.1:4656',
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
});
process.parentPort.on('message', (event: Electron.MessageEvent) => {
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
  void (async () => {
    let context;
    try {
      context = await chromium.launchPersistentContext(probe.data.profile, {
        executablePath: probe.data.executable,
        headless: false,
        chromiumSandbox: true,
        args: ['--disable-background-networking'],
      });
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
      const title = await page.title();
      const browser = context.browser();
      if (!browser) throw new Error('BROWSER_PROCESS_ID_MISSING');
      const cdp = await browser.newBrowserCDPSession();
      const processes = await cdp.send('SystemInfo.getProcessInfo');
      const pids = processes.processInfo.map((info) => Number(info.id));
      const identities = await processIdentities(pids);
      if (!identities.length) throw new Error('BROWSER_PROCESS_ID_MISSING');
      await cdp.detach();
      await context.close();
      context = undefined;
      process.parentPort.postMessage({
        type: 'browserProbeResult',
        title,
        closed: true,
        pids,
        processes: identities,
      });
    } catch (error) {
      if (error instanceof Error && 'query' in error)
        console.error('BROWSER_PROBE_QUERY_FAILED', error.message);
      process.parentPort.postMessage({
        type: 'browserProbeResult',
        error: 'BROWSER_PROBE_FAILED',
      });
    } finally {
      await context?.close();
    }
  })();
});
