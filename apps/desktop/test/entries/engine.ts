import { chromium } from 'playwright-core';
import { z } from 'zod';
import { startEngine } from '../../src/engine-host/host.ts';

const ProbeSchema = z.strictObject({
  type: z.literal('browserProbe'),
  executable: z.string().min(1),
  profile: z.string().min(1),
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1';
  }),
});
startEngine(process.argv[2] ?? '');
process.parentPort.on('message', (event: Electron.MessageEvent) => {
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
      await cdp.detach();
      await context.close();
      context = undefined;
      process.parentPort.postMessage({
        type: 'browserProbeResult',
        title,
        closed: true,
        pids,
      });
    } catch {
      process.parentPort.postMessage({
        type: 'browserProbeResult',
        error: 'BROWSER_PROBE_FAILED',
      });
    } finally {
      await context?.close();
    }
  })();
});
