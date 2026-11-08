import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launchRunBrowser } from '../src/browser/launch.ts';
import { contextPages } from '../src/browser/instagram/pages.ts';
import { fakeInstagram } from './fake-instagram/server.ts';
import { instagramFixture } from './fake-instagram/fixture.ts';
import { prepareWindowsQuery } from '../../desktop/packaging/windows-query.ts';
import { placementGeneratedRun } from './context-instagram.test.ts';

test('PLACEMENT Windows foreground sentinel measures launch and same-window background replacement', async () => {
  // Runner only. This test is outside every local/default test entrypoint.
  expect(process.platform).toBe('win32');
  // eslint-disable-next-line no-restricted-properties -- Test-only runner admission, never a credential.
  expect(process.env['GITHUB_ACTIONS']).toBe('true');
  const out = resolve('apps/cli/test-results/placement');
  await mkdir(out, { recursive: true });
  // eslint-disable-next-line no-restricted-properties -- Test-only runner browser choice, never a credential.
  const browserName = process.env['SP_PLACEMENT_BROWSER'] ?? 'chromium';
  expect(['chromium', 'msedge']).toContain(browserName);
  // The runner's installed Microsoft Edge, as the starter uses --browser edge.
  const executable =
    browserName === 'msedge'
      ? [
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        ].find((path) => existsSync(path))
      : chromium.executablePath();
  expect(executable).toBeTruthy();
  const root = await mkdtemp(join(tmpdir(), 'sp-placement-probe-'));
  const ready = join(root, 'sentinel.ready'),
    activate = join(root, 'sentinel.activate'),
    stop = join(root, 'sentinel.stop');
  const sentinel = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-File',
      fileURLToPath(new URL('./placement-sentinel.ps1', import.meta.url)),
      ready,
      activate,
      stop,
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const sentinelDone = new Promise<void>((resolve, reject) => {
    sentinel.once('error', reject);
    sentinel.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`SENTINEL_EXIT_${code}`)),
    );
  });
  void sentinelDone.catch(() => {});
  let context: Awaited<ReturnType<typeof launchRunBrowser>> | undefined;
  let fake: Awaited<ReturnType<typeof fakeInstagram>> | undefined;
  const receipt: Record<string, unknown> = {
    generatedOnly: true,
    method:
      'GetForegroundWindow/5ms/native-helper, CDP window identity and bounds',
    // eslint-disable-next-line no-restricted-properties -- Test-only source identity, never a credential.
    source: process.env['GITHUB_SHA'],
    browser: browserName,
  };
  const waitFile = async (path: string) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        return await readFile(path, 'utf8');
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('PROBE_READY_TIMEOUT');
  };
  try {
    const signal = JSON.parse(await waitFile(ready)) as {
      handle: string;
      area: { x: number; y: number; width: number; height: number };
    };
    const helper = await prepareWindowsQuery(); // Existing cached native helper, runner only.
    const watch = async (name: string, action: () => Promise<void>) => {
      const readyPath = join(root, name + '.ready'),
        stopPath = join(root, name + '.stop');
      await writeFile(activate, name);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const child = spawn(helper, ['foreground-watch', readyPath, stopPath], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (bytes: Buffer) => {
        output += bytes.toString();
      });
      const done = new Promise<void>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error('FOREGROUND_PROBE_FAILED')),
        );
      });
      void done.catch(() => {});
      try {
        const initial = JSON.parse(await waitFile(readyPath)) as {
          handle: string;
        };
        expect(initial.handle).toBe(signal.handle);
        await action();
      } finally {
        await writeFile(stopPath, 'stop');
        await done;
      }
      const result = JSON.parse(output) as {
        changed: boolean;
        samples: number;
        elapsedMs: number;
      };
      expect(result.samples).toBeGreaterThan(0);
      expect(result.elapsedMs).toBeLessThan(10000);
      receipt[name] = result;
      return result;
    };
    const placement = {
      x: signal.area.x + 40,
      y: signal.area.y + 40,
      width: Math.min(900, signal.area.width - 80),
      height: Math.min(700, signal.area.height - 80),
    };
    receipt.placement = placement;
    const fixture = await instagramFixture(1);
    fake = await fakeInstagram(4549, fixture.items);
    // The browser itself writes the generated session; no profile file edits.
    const seed = await chromium.launchPersistentContext(join(root, 'profile'), {
      executablePath: executable!,
      headless: true,
      chromiumSandbox: true,
      args: ['--enable-automation'],
      ignoreDefaultArgs: ['--disable-infobars'],
      serviceWorkers: 'block',
    });
    for (let index = 0; index < 7; index++) {
      const tab = index === 0 ? seed.pages()[0]! : await seed.newPage();
      await tab.goto(fake.origin + '/your_activity/interactions/comments');
    }
    await seed.close();
    const launch = await watch('launch', async () => {
      context = await chromium.launchPersistentContext(join(root, 'profile'), {
        executablePath: executable!,
        headless: false,
        chromiumSandbox: true,
        viewport: null,
        offline: true,
        args: [
          '--enable-automation',
          `--window-position=${placement.x},${placement.y}`,
          `--window-size=${placement.width},${placement.height}`,
          '--restore-last-session',
        ],
        ignoreDefaultArgs: ['--disable-infobars'],
        serviceWorkers: 'block',
      });
    });
    receipt.restoredLaunchPages = context!.pages().length;
    expect(context!.pages().length).toBeGreaterThanOrEqual(7);
    await context!.setOffline(false);
    await context!.route('**/*', (route) =>
      new URL(route.request().url()).origin === fake!.origin
        ? route.continue()
        : route.abort(),
    );
    // Reproduce the missing-Playwright-page class using real restored CDP tabs,
    // not fake CDP replies. Only the fixture's initial Page enumeration is partial.
    const partial = new Proxy(context!, {
      get(object, property) {
        if (property === 'pages') return () => object.pages().slice(0, 1);
        const value: unknown = Reflect.get(object, property);
        return typeof value === 'function'
          ? (value.bind(object) as unknown)
          : value;
      },
    });
    const boundary = contextPages(partial, () => {});
    receipt.launchKeptForeground = !launch.changed;
    receipt.status = 'measuring-reader-design';
    const selectedReader = async (name: string, count: number) => {
      const browserSession = await context!.browser()!.newBrowserCDPSession();
      try {
        const processes = await browserSession.send(
          'SystemInfo.getProcessInfo',
        );
        const pid = processes.processInfo.find(
          (process) => process.type === 'browser',
        )!.id;
        const child = spawn(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-STA',
            '-File',
            fileURLToPath(new URL('./placement-tabs.ps1', import.meta.url)),
            String(pid),
          ],
          { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let output = '',
          error = '';
        child.stdout.on('data', (value: Buffer) => {
          output += value.toString();
        });
        child.stderr.on('data', (value: Buffer) => {
          error += value.toString();
        });
        await new Promise<void>((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code) =>
            code === 0
              ? resolve()
              : reject(new Error(error || 'TAB_OBSERVATION_FAILED')),
          );
        });
        const observed = JSON.parse(output) as {
          count: number;
          tabs: { index: number; kind: string; selected: boolean }[];
          offscreen: boolean;
        };
        receipt[name] = observed;
        expect(observed).toMatchObject({ count, offscreen: false });
        expect(
          observed.tabs.find((tab) => tab.kind === 'reading')?.selected,
        ).toBe(true);
        expect(
          observed.tabs.every((tab) => tab.kind === 'reading' || !tab.selected),
        ).toBe(true);
      } finally {
        await browserSession.detach();
      }
    };
    let reading!: Awaited<ReturnType<typeof boundary.startupPage>>;
    const initial = await watch('readerStart', async () => {
      reading = await boundary.startupPage();
      await reading.setContent('<title>Generated reading probe</title>');
    });
    const session = await context!.newCDPSession(reading);
    const first = await session.send('Browser.getWindowForTarget');
    await session.detach();
    const bounds = first.bounds;
    receipt.bounds = bounds;
    receipt.pagesCount = boundary.snapshot();
    // Restored tabs close as their page targets, or as tab targets where a
    // tab has no page; both count, and nothing non-owned remains.
    expect(
      boundary.counts.targetClosed.page + boundary.counts.targetClosed.tab,
    ).toBeGreaterThanOrEqual(6);
    expect(boundary.counts.remainingNonOwned).toBe(0);
    expect(boundary.counts.targetFailure).toBeNull();
    expect(initial.changed).toBe(false);
    await selectedReader('selectedAtStart', 1);
    const confirmationCreated = await watch('confirmationCreate', async () => {
      const confirmation = await boundary.newPage();
      await confirmation.setContent(
        '<title>Generated confirmation probe</title>',
      );
    });
    receipt.pagesCount = boundary.snapshot();
    expect(confirmationCreated.changed).toBe(false);
    await boundary.assertTabs();
    await selectedReader('selectedAfterConfirmation', 2);
    const recycled = await watch('readerRecycle', async () => {
      const before = reading;
      await reading.goto(fake!.origin + '/your_activity/interactions/comments');
      await boundary.resetRenderer(reading, 1500);
      await reading.goto(fake!.origin + '/your_activity/interactions/comments');
      await reading.evaluate(() => {
        document.title = 'Generated reading probe';
      });
      expect(reading).toBe(before);
      await boundary.assertTabs();
    });
    receipt.pagesCount = boundary.snapshot();
    const next = await context!.newCDPSession(reading);
    const sameWindow =
      (await next.send('Browser.getWindowForTarget')).windowId ===
      first.windowId;
    await next.detach();
    receipt.sameWindow = sameWindow;
    expect(recycled.changed).toBe(false);
    await selectedReader('selectedAfterRecycle', 2);
    expect(bounds).toMatchObject({
      left: placement.x,
      top: placement.y,
      width: placement.width,
      height: placement.height,
      windowState: 'normal',
    });
    expect(boundary.snapshot()).toMatchObject({
      pageLimit: 3,
      ownedPeak: 2,
      backgroundCreated: 2,
      replaced: 0,
      rendererResets: 1,
    });
    expect(sameWindow).toBe(true);
    const cap = await watch('pageCap', async () => {
      const extra = await boundary.newPage();
      await expect(boundary.newPage()).rejects.toMatchObject({
        token: 'unexpected-page',
      });
      await extra.close();
    });
    receipt.pagesAfterCap = boundary.snapshot();
    expect(cap.changed).toBe(false);
    expect(boundary.snapshot().ownedPeak).toBe(3);
    await selectedReader('selectedAfterCap', 2);
    receipt.pagesKeptForeground = true;
    receipt.status = 'reader-design-passed-launch-reported-separately';
    await context!.close();
    context = undefined;
    let runPages = 0;
    const generated = await placementGeneratedRun(
      async (path) => {
        await watch('generatedLaunch', async () => {
          context = await launchRunBrowser(path, executable!, placement, true);
        });
        return context!;
      },
      async (phase, action) => {
        let page!: Awaited<ReturnType<typeof action>>;
        const name = `generated-${phase}-${++runPages}`;
        const observed = await watch(name, async () => {
          page = await action();
          await page.evaluate(
            (title) => {
              document.title = title;
            },
            phase === 'confirmation'
              ? 'Generated confirmation probe'
              : 'Generated reading probe',
          );
        });
        expect(observed.changed).toBe(false);
        await selectedReader(
          `${name}-selected`,
          phase === 'reader-start' ? 1 : 2,
        );
        return page;
      },
    );
    receipt.generatedRun = {
      pages: generated.pages,
      rows: generated.rows,
      stop: generated.stop,
      recycling: generated.recycling,
      memory: generated.memory,
      tabChecks: generated.tabChecks,
    };
    expect(generated).toMatchObject({
      pages: { rendererResets: 1, replaced: 0, ownedPeak: 2 },
      recycling: { count: 1, events: [{ afterStep: 20, nextStep: 21 }] },
    });
    // An observed first-window activation is a reported limitation, not a false pass.
    console.log('PLACEMENT_FOREGROUND_RECEIPT', JSON.stringify(receipt));
    boundary.dispose();
  } finally {
    await writeFile(
      join(
        out,
        browserName === 'msedge' ? 'placement-msedge.json' : 'placement.json',
      ),
      JSON.stringify(receipt, null, 2),
    );
    await context?.close();
    await fake?.close();
    await writeFile(stop, 'stop');
    await sentinelDone;
    await rm(root, { recursive: true, force: true });
  }
});
