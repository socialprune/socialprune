import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { BrowserContext } from 'playwright-core';
import { launchRunBrowser, windowArguments } from '../src/browser/launch.ts';
import { createProfile } from '../src/browser/profile.ts';
import { planDeletion } from '../src/browser/plan.ts';
import { runWithDependencies } from '../src/browser/runner.ts';
import { pageDriver } from '../src/browser/x/driver.ts';
import { SQLiteStore } from '../src/workspace/sqlite-store.ts';
import { fixtureWorkspace, FIXTURE } from './fake-x/fixture.ts';
import { fakeX } from './fake-x/server.ts';
import { TEST_PORTS, TEST_ORIGINS } from '../playwright.ports.config.ts';
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
  // Wall time per segment, so the test's budget is derived from measurement.
  const startedAt = Date.now(),
    phaseMs: Record<string, number> = {};
  receipt.phaseMs = phaseMs;
  const mark = (name: string) => {
    phaseMs[name] = Date.now() - startedAt;
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
    mark('sentinelReady');
    const helper = await prepareWindowsQuery(); // Existing cached native helper, runner only.
    mark('helperReady');
    const watchMs: Record<string, number> = {};
    receipt.watchMs = watchMs;
    const watch = async (name: string, action: () => Promise<void>) => {
      const watchStarted = Date.now();
      try {
        return await watchOnce(name, action);
      } finally {
        watchMs[name] = Date.now() - watchStarted;
      }
    };
    const watchOnce = async (name: string, action: () => Promise<void>) => {
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
    // Edge did not restore a session written in headless mode (run
    // 42486872535: 2 pages), so its seed runs headed on the runner.
    const seed = await chromium.launchPersistentContext(join(root, 'profile'), {
      executablePath: executable!,
      headless: browserName !== 'msedge',
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
    mark('seeded');
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
    // Edge may add restored tabs after launch returns. Read the browser's own
    // targets for up to 15 s; only counts and the fixture-origin match are kept.
    const restored: {
      ms: number;
      pages: number;
      tabs: number;
      fixturePages: number;
    }[] = [];
    const restoredAt = Date.now();
    const browserTargets = await context!.browser()!.newBrowserCDPSession();
    try {
      for (;;) {
        const { targetInfos } = await browserTargets.send('Target.getTargets');
        const sample = {
          ms: Date.now() - restoredAt,
          pages: targetInfos.filter((value) => value.type === 'page').length,
          tabs: targetInfos.filter((value) => value.type === 'tab').length,
          fixturePages: targetInfos.filter(
            (value) =>
              value.type === 'page' && value.url.startsWith(fake!.origin),
          ).length,
        };
        restored.push(sample);
        if (sample.fixturePages >= 7 || sample.ms > 15000) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      await browserTargets.detach();
    }
    receipt.restoredTargets = restored.at(-1);
    receipt.restoredSamples = restored.length;
    receipt.restoredLaunchPages = context!.pages().length;
    expect(restored.at(-1)!.fixturePages).toBeGreaterThanOrEqual(7);
    mark('restored');
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
    const tabReadMs: Record<string, number> = {};
    receipt.tabReadMs = tabReadMs;
    const selectedReader = async (name: string, count: number) => {
      const readStarted = Date.now();
      try {
        await selectedReaderOnce(name, count);
      } finally {
        tabReadMs[name] = Date.now() - readStarted;
      }
    };
    const selectedReaderOnce = async (name: string, count: number) => {
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
    mark('readerDesign');
    await context!.close();
    context = undefined;
    mark('readerContextClosed');
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
    mark('generatedRun');
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
    mark('teardownStart');
    const receiptPath = join(
      out,
      browserName === 'msedge' ? 'placement-msedge.json' : 'placement.json',
    );
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
    await context?.close();
    await fake?.close();
    await writeFile(stop, 'stop');
    await sentinelDone;
    await rm(root, { recursive: true, force: true });
    mark('teardownEnd');
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  }
  // MEASUREMENT ONLY: room to finish so phaseMs is complete; replaced by a
  // derived budget before this branch is offered.
}, 400000);

/** The same Windows foreground sentinel as above, for the X probe. */
async function foregroundSentinel(root: string) {
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
  const done = new Promise<void>((resolve, reject) => {
    sentinel.once('error', reject);
    sentinel.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`SENTINEL_EXIT_${code}`)),
    );
  });
  void done.catch(() => {});
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
  const signal = JSON.parse(await waitFile(ready)) as {
    handle: string;
    area: { x: number; y: number; width: number; height: number };
  };
  const helper = await prepareWindowsQuery();
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
    const exited = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('FOREGROUND_PROBE_FAILED')),
      );
    });
    void exited.catch(() => {});
    try {
      const initial = JSON.parse(await waitFile(readyPath)) as {
        handle: string;
      };
      expect(initial.handle).toBe(signal.handle);
      await action();
    } finally {
      await writeFile(stopPath, 'stop');
      await exited;
    }
    return JSON.parse(output) as {
      changed: boolean;
      samples: number;
      elapsedMs: number;
    };
  };
  return {
    area: signal.area,
    watch,
    async stop() {
      await writeFile(stop, 'stop');
      await done;
    },
  };
}

test('PLACEMENT X deletion run with restored tabs keeps the window, the foreground and closes the tabs', async () => {
  // Runner only. This test is outside every local/default test entrypoint.
  expect(process.platform).toBe('win32');
  // eslint-disable-next-line no-restricted-properties -- Test-only runner admission, never a credential.
  expect(process.env['GITHUB_ACTIONS']).toBe('true');
  const out = resolve('apps/cli/test-results/placement');
  await mkdir(out, { recursive: true });
  // eslint-disable-next-line no-restricted-properties -- Test-only runner browser choice, never a credential.
  const browserName = process.env['SP_PLACEMENT_BROWSER'] ?? 'chromium';
  const executable =
    browserName === 'msedge'
      ? [
          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        ].find((path) => existsSync(path))
      : chromium.executablePath();
  expect(executable).toBeTruthy();
  const root = await mkdtemp(join(tmpdir(), 'sp-placement-x-'));
  const profile = join(root, 'profile');
  const receipt: Record<string, unknown> = {
    generatedOnly: true,
    run: 'x-delete',
    // eslint-disable-next-line no-restricted-properties -- Test-only source identity, never a credential.
    source: process.env['GITHUB_SHA'],
    browser: browserName,
  };
  const sentinel = await foregroundSentinel(root);
  const fake = await fakeX();
  let context: BrowserContext | undefined;
  let store: SQLiteStore | undefined;
  try {
    const placement = {
      x: sentinel.area.x + 40,
      y: sentinel.area.y + 40,
      width: Math.min(900, sentinel.area.width - 80),
      height: Math.min(700, sentinel.area.height - 80),
    };
    receipt.placement = placement;
    await mkdir(profile);
    await createProfile(profile);
    // The browser itself writes the generated session; no profile file edits.
    const seed = await chromium.launchPersistentContext(profile, {
      executablePath: executable!,
      headless: browserName !== 'msedge',
      chromiumSandbox: true,
      args: ['--enable-automation'],
      ignoreDefaultArgs: ['--disable-infobars'],
      serviceWorkers: 'block',
    });
    for (let index = 0; index < 7; index++) {
      const tab = index === 0 ? seed.pages()[0]! : await seed.newPage();
      await tab.goto(fake.origin + '/home');
    }
    await seed.close();
    store = await SQLiteStore.open(join(root, 'socialprune.sqlite'), {
      initial: fixtureWorkspace(['1001']),
    });
    const now = new Date(FIXTURE.now).getTime();
    const plan = await planDeletion(
      store,
      (await store.read((tx) => tx.items.get('x:1001')))!.item.account.key,
      new Set(),
      new Date(now),
    );
    let launched!: () => void;
    const browserReady = new Promise<void>((resolve) => {
      launched = resolve;
    });
    let release!: () => void;
    const restoredSeen = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = runWithDependencies(
      {
        store,
        plan,
        profile,
        executablePath: executable!,
        verify: false,
        list: 'generated full list',
        lang: 'en',
        signal: new AbortController().signal,
        now: () => new Date(now),
        notice: () => {},
        windowPlacement: placement,
      },
      {
        pace: { intervalMs: 100, batchSize: 20, pauseMs: 100, perDay: 200 },
        confirmationPort: TEST_PORTS.confirmation,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        async driver(options) {
          // launchRunBrowser's options plus the restore flag the person's
          // browser setting would apply.
          context = await chromium.launchPersistentContext(profile, {
            executablePath: options.executablePath,
            headless: false,
            viewport: null,
            chromiumSandbox: true,
            args: [
              '--enable-automation',
              ...windowArguments(options.windowPlacement),
              '--restore-last-session',
            ],
            serviceWorkers: 'block',
            ignoreDefaultArgs: ['--disable-infobars'],
          });
          launched();
          await restoredSeen;
          const driver = await pageDriver({
            context,
            origin: fake.origin,
            allowedOrigins: [fake.origin],
            confirmationOrigin: options.confirmationOrigin,
            responseTimeoutMs: 5_000,
            signal: options.signal,
            record: (request) => options.record(request),
            now: options.now,
            onRateLimit: options.onRateLimit,
            onWindow: options.onWindow,
          });
          // As in production the window stays open after the run; the probe
          // reads it and closes it in its own teardown.
          return {
            ...driver,
            close: () => {
              driver.endPages?.();
              return Promise.resolve();
            },
          };
        },
      },
    );
    void running.catch(() => {});
    receipt.launch = await sentinel.watch('launch', () => browserReady);
    // Edge may add restored tabs after launch returns; wait up to 15 s.
    const restoredAt = Date.now();
    const targets = await context!.browser()!.newBrowserCDPSession();
    let restored = { ms: 0, fixturePages: 0 };
    try {
      for (;;) {
        const { targetInfos } = await targets.send('Target.getTargets');
        restored = {
          ms: Date.now() - restoredAt,
          fixturePages: targetInfos.filter(
            (value) =>
              value.type === 'page' && value.url.startsWith(fake.origin),
          ).length,
        };
        if (restored.fixturePages >= 7 || restored.ms > 15000) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      await targets.detach();
    }
    receipt.restored = restored;
    expect(restored.fixturePages).toBeGreaterThanOrEqual(7);
    let result: unknown;
    const runWatch = await sentinel.watch('run', async () => {
      release();
      const confirmation = async () => {
        for (let attempt = 0; attempt < 200; attempt++) {
          const page = context!
            .pages()
            .find((value) => value.url().startsWith(TEST_ORIGINS.confirmation));
          if (page) return page;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error('CONFIRMATION_MISSING');
      };
      const page = await confirmation();
      for (const name of ['Start', 'Continue'] as const) {
        const button = page.getByRole('button', { name, exact: true });
        await button.waitFor({ state: 'visible', timeout: 30000 });
        await button.click();
      }
      result = await running;
    });
    receipt.runForeground = runWatch;
    receipt.result = result;
    // Every owned page shares the run window; read its bounds through one.
    const owned = context!.pages().find((value) => !value.isClosed());
    receipt.ownedPagesListed = context!.pages().length;
    expect(owned).toBeTruthy();
    const session = await context!.newCDPSession(owned!);
    const { bounds } = await session.send('Browser.getWindowForTarget');
    await session.detach();
    receipt.bounds = bounds;
    const runId = (await store.browserJournal()).runs[0]!.runId;
    const report = JSON.parse(
      await readFile(join(profile, `socialprune-delete-${runId}.json`), 'utf8'),
    ) as { pages: Record<string, unknown>; stop: unknown };
    receipt.pages = report.pages;
    receipt.stop = report.stop;
    expect(result).toMatchObject({ completed: 1, endReason: 'done' });
    expect(report.stop).toBeNull();
    expect(report.pages).toMatchObject({
      remainingNonOwned: 0,
      targetFailure: null,
      unexpectedOpened: 0,
    });
    expect(report.pages['startupClosed']).toBeGreaterThanOrEqual(7);
    expect(runWatch.changed).toBe(false);
    expect(bounds).toMatchObject({
      left: placement.x,
      top: placement.y,
      width: placement.width,
      height: placement.height,
      windowState: 'normal',
    });
    receipt.status = 'passed';
  } finally {
    await writeFile(
      join(out, `placement-x-${browserName}.json`),
      JSON.stringify(receipt, null, 2),
    );
    await context?.close();
    await store?.close();
    await fake.close();
    await sentinel.stop();
    await rm(root, { recursive: true, force: true });
  }
});
