import { beforeAll, expect, test } from 'vitest';
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

// Runner-only tests. Each budget below is derived from the segment times the
// probe receipt records (`phaseMs`, `watchMs`, `tabReadMs`) plus the explicit
// bounded waits the segment contains. Measured on GitHub's Windows runner in
// placement-only run 42516172028 (2026-11-08) and in the shard-1 context runs
// 42508658121 and 42512958040.
/** Every activation check retries for at most this long before it fails. */
const ACTIVATION_BOUND_MS = 5000;
/** Every teardown operation gets this long before it is named as a stall. */
const TEARDOWN_BOUND_MS = 5000;
/** The restored-session poll stops after this long. */
const RESTORE_BOUND_MS = 15000;
// Native helper preparation: 26.6 s cold (first use on the runner), 0.006 s
// cached. No waits inside; one cold sample, so about twice that: 60 s.
const HELPER_BUDGET_MS = 60000;
// Launch and reader design: 11.1 s on Chromium, 17.6 s on Edge, of which
// 10.0 s is Edge's restore. Work without waits at most 11.1 s, plus the
// restore bound 15 s, plus 5 watches x 5 s activation bound, plus 4 teardown
// operations x 5 s: 11.1 + 15 + 25 + 20 = 71.1 s, declared 75 s.
const LAUNCH_BUDGET_MS = 75000;
// Generated 21-step run: 103.4 s alone; in a loaded context shard about
// 145 s (183 s total minus 37.7 s for helper and launch segment). Plus 4
// watches x 5 s activation bound, plus 3 teardown operations x 5 s:
// 145 + 20 + 15 = 180 s. This is the old whole-test cap, now covering only
// this segment.
const GENERATED_BUDGET_MS = 180000;
// X deletion probe: about 15 s per test (21 to 24 s per workflow step with
// about 8 s of startup), of which 9.5 s is Edge's restore. Work without waits
// about 6.5 s, plus the restore bound 15 s, plus 2 watches x 5 s activation
// bound, plus 5 teardown operations x 5 s: 6.5 + 15 + 10 + 25 = 56.5 s,
// declared 60 s.
const X_BUDGET_MS = 60000;

let helper: string;
beforeAll(async () => {
  // Runner only: never prepares or reads a native helper on a local machine,
  // and other tests imported into this file are unaffected.
  // eslint-disable-next-line no-restricted-properties -- Test-only runner admission, never a credential.
  if (process.platform !== 'win32' || process.env['GITHUB_ACTIONS'] !== 'true')
    return;
  helper = await prepareWindowsQuery(); // Existing cached native helper, runner only.
}, HELPER_BUDGET_MS);

function runnerOnly() {
  // Runner only. These tests are outside every local/default test entrypoint.
  expect(process.platform).toBe('win32');
  // eslint-disable-next-line no-restricted-properties -- Test-only runner admission, never a credential.
  expect(process.env['GITHUB_ACTIONS']).toBe('true');
}
function browserChoice() {
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
  return { browserName, executable: executable! };
}
function placementFor(area: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return {
    x: area.x + 40,
    y: area.y + 40,
    width: Math.min(900, area.width - 80),
    height: Math.min(700, area.height - 80),
  };
}
function newReceipt(browserName: string, extra: Record<string, unknown> = {}) {
  const startedAt = Date.now(),
    phaseMs: Record<string, number> = {};
  const receipt: Record<string, unknown> = {
    generatedOnly: true,
    method:
      'GetForegroundWindow/5ms/native-helper, CDP window identity and bounds',
    // eslint-disable-next-line no-restricted-properties -- Test-only source identity, never a credential.
    source: process.env['GITHUB_SHA'],
    browser: browserName,
    ...extra,
    phaseMs,
  };
  return {
    receipt,
    mark: (name: string) => {
      phaseMs[name] = Date.now() - startedAt;
    },
  };
}
/** The first line of a generated-data error, for the receipt only. */
function errorClass(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message.split('\n')[0]!.slice(0, 200) }
    : { name: 'unknown', message: '' };
}
/** Run one teardown operation within its bound; a stall is named, not waited out. */
async function bounded(
  stage: string,
  task: () => Promise<unknown>,
  stalls: string[],
) {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      task(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('TEARDOWN_STALL')),
          TEARDOWN_BOUND_MS,
        );
      }),
    ]);
  } catch (error) {
    stalls.push(`${stage}:${errorClass(error).message.slice(0, 80)}`);
  } finally {
    clearTimeout(timer);
  }
}
/** Windows sharing errors while the other process holds the file. */
const busy = (error: unknown) =>
  error instanceof Error &&
  'code' in error &&
  (error.code === 'EBUSY' || error.code === 'EPERM');
/**
 * The sentinel reads its activation file every 20 ms; a write that meets the
 * read gets EBUSY on Windows (run 42527716244, Edge generated run stopped at
 * browser-setup with fs-EBUSY). Retry for at most 1 s, then fail.
 */
async function writeShared(path: string, value: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await writeFile(path, value);
      return;
    } catch (error) {
      if (!busy(error) || attempt >= 40) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
async function waitFile(path: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ENOENT' || busy(error))
      ))
        throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('PROBE_READY_TIMEOUT');
}

/** A generated Windows Forms window owns the foreground before each measured action. */
async function foregroundSentinel(
  root: string,
  receipt: Record<string, unknown>,
) {
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
  const signal = JSON.parse(await waitFile(ready)) as {
    handle: string;
    area: { x: number; y: number; width: number; height: number };
  };
  const watchMs: Record<string, number> = {},
    activationAttempts: Record<string, number> = {};
  receipt.watchMs = watchMs;
  receipt.activationAttempts = activationAttempts;
  const startHelper = (tag: string) => {
    const readyPath = join(root, tag + '.ready'),
      stopPath = join(root, tag + '.stop');
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
    return {
      initial: async () =>
        (JSON.parse(await waitFile(readyPath)) as { handle: string }).handle,
      async stop() {
        await writeFile(stopPath, 'stop');
        await exited;
        return JSON.parse(output) as {
          changed: boolean;
          samples: number;
          elapsedMs: number;
        };
      },
    };
  };
  /**
   * Activation is asynchronous: after a launch took the foreground, the
   * sentinel may still be behind the browser. Re-activate until it is in
   * front (bounded), then measure; the initial-handle assertion is kept.
   */
  const watch = async (name: string, action: () => Promise<void>) => {
    const started = Date.now();
    try {
      let attempt = 0;
      let watcher!: ReturnType<typeof startHelper>;
      let handle!: string;
      for (;;) {
        attempt++;
        await writeShared(activate, `${name}#${attempt}`);
        await new Promise((resolve) => setTimeout(resolve, 150));
        watcher = startHelper(`${name}-${attempt}`);
        handle = await watcher.initial();
        if (
          handle === signal.handle ||
          Date.now() - started > ACTIVATION_BOUND_MS
        )
          break;
        await watcher.stop();
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      activationAttempts[name] = attempt;
      try {
        expect(handle).toBe(signal.handle);
        await action();
      } finally {
        receipt[name] = await watcher.stop();
      }
      const result = receipt[name] as {
        changed: boolean;
        samples: number;
        elapsedMs: number;
      };
      expect(result.samples).toBeGreaterThan(0);
      expect(result.elapsedMs).toBeLessThan(10000);
      return result;
    } finally {
      watchMs[name] = Date.now() - started;
    }
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

/** Reads the tab strip through UI Automation; the reading tab must be selected. */
async function selectedReader(
  context: BrowserContext,
  receipt: Record<string, unknown>,
  name: string,
  count: number,
) {
  const tabReadMs = (receipt.tabReadMs ??= {}) as Record<string, number>;
  const started = Date.now();
  const browserSession = await context.browser()!.newBrowserCDPSession();
  try {
    const processes = await browserSession.send('SystemInfo.getProcessInfo');
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
    expect(observed.tabs.find((tab) => tab.kind === 'reading')?.selected).toBe(
      true,
    );
    expect(
      observed.tabs.every((tab) => tab.kind === 'reading' || !tab.selected),
    ).toBe(true);
  } finally {
    await browserSession.detach();
    tabReadMs[name] = Date.now() - started;
  }
}
const receiptPath = (browserName: string) =>
  resolve(
    'apps/cli/test-results/placement',
    browserName === 'msedge' ? 'placement-msedge.json' : 'placement.json',
  );

test(
  'PLACEMENT Windows foreground sentinel measures launch and same-window background replacement',
  async () => {
    runnerOnly();
    await mkdir(resolve('apps/cli/test-results/placement'), {
      recursive: true,
    });
    const { browserName, executable } = browserChoice();
    const { receipt, mark } = newReceipt(browserName);
    const root = await mkdtemp(join(tmpdir(), 'sp-placement-probe-'));
    const stalls: string[] = [];
    let context: BrowserContext | undefined;
    let fake: Awaited<ReturnType<typeof fakeInstagram>> | undefined;
    let sentinel: Awaited<ReturnType<typeof foregroundSentinel>> | undefined;
    let boundary: ReturnType<typeof contextPages> | undefined;
    try {
      sentinel = await foregroundSentinel(root, receipt);
      mark('sentinelReady');
      const watch = sentinel.watch;
      const placement = placementFor(sentinel.area);
      receipt.placement = placement;
      const fixture = await instagramFixture(1);
      fake = await fakeInstagram(4549, fixture.items);
      // The browser itself writes the generated session; no profile file edits.
      // Edge did not restore a session written in headless mode (run
      // 42486872535: 2 pages), so its seed runs headed on the runner.
      const seed = await chromium.launchPersistentContext(
        join(root, 'profile'),
        {
          executablePath: executable,
          headless: browserName !== 'msedge',
          chromiumSandbox: true,
          args: ['--enable-automation'],
          ignoreDefaultArgs: ['--disable-infobars'],
          serviceWorkers: 'block',
        },
      );
      for (let index = 0; index < 7; index++) {
        const tab = index === 0 ? seed.pages()[0]! : await seed.newPage();
        await tab.goto(fake.origin + '/your_activity/interactions/comments');
      }
      await seed.close();
      mark('seeded');
      const launch = await watch('launch', async () => {
        context = await chromium.launchPersistentContext(
          join(root, 'profile'),
          {
            executablePath: executable,
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
          },
        );
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
          const { targetInfos } =
            await browserTargets.send('Target.getTargets');
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
          if (sample.fixturePages >= 7 || sample.ms > RESTORE_BOUND_MS) break;
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
      boundary = contextPages(partial, () => {});
      receipt.launchKeptForeground = !launch.changed;
      receipt.status = 'measuring-reader-design';
      let reading!: Awaited<ReturnType<typeof boundary.startupPage>>;
      const initial = await watch('readerStart', async () => {
        reading = await boundary!.startupPage();
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
      await selectedReader(context!, receipt, 'selectedAtStart', 1);
      const confirmationCreated = await watch(
        'confirmationCreate',
        async () => {
          const confirmation = await boundary!.newPage();
          await confirmation.setContent(
            '<title>Generated confirmation probe</title>',
          );
        },
      );
      receipt.pagesCount = boundary.snapshot();
      expect(confirmationCreated.changed).toBe(false);
      await boundary.assertTabs();
      await selectedReader(context!, receipt, 'selectedAfterConfirmation', 2);
      const recycled = await watch('readerRecycle', async () => {
        const before = reading;
        await reading.goto(
          fake!.origin + '/your_activity/interactions/comments',
        );
        await boundary!.resetRenderer(reading, 1500);
        await reading.goto(
          fake!.origin + '/your_activity/interactions/comments',
        );
        await reading.evaluate(() => {
          document.title = 'Generated reading probe';
        });
        expect(reading).toBe(before);
        await boundary!.assertTabs();
      });
      receipt.pagesCount = boundary.snapshot();
      const next = await context!.newCDPSession(reading);
      const sameWindow =
        (await next.send('Browser.getWindowForTarget')).windowId ===
        first.windowId;
      await next.detach();
      receipt.sameWindow = sameWindow;
      expect(recycled.changed).toBe(false);
      await selectedReader(context!, receipt, 'selectedAfterRecycle', 2);
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
        const extra = await boundary!.newPage();
        await expect(boundary!.newPage()).rejects.toMatchObject({
          token: 'unexpected-page',
        });
        await extra.close();
      });
      receipt.pagesAfterCap = boundary.snapshot();
      expect(cap.changed).toBe(false);
      expect(boundary.snapshot().ownedPeak).toBe(3);
      await selectedReader(context!, receipt, 'selectedAfterCap', 2);
      receipt.pagesKeptForeground = true;
      // An observed first-window activation is a reported limitation, not a false pass.
      receipt.status = 'reader-design-passed-launch-reported-separately';
      mark('readerDesign');
    } catch (error) {
      receipt.error = errorClass(error);
      throw error;
    } finally {
      mark('teardownStart');
      boundary?.dispose();
      await bounded('context', async () => context?.close(), stalls);
      await bounded('fake', async () => fake?.close(), stalls);
      await bounded('sentinel', async () => sentinel?.stop(), stalls);
      await bounded(
        'temp',
        () => rm(root, { recursive: true, force: true }),
        stalls,
      );
      mark('teardownEnd');
      receipt.teardownStalls = stalls;
      await writeFile(
        receiptPath(browserName),
        JSON.stringify(receipt, null, 2),
      );
    }
    expect(stalls).toEqual([]);
  },
  LAUNCH_BUDGET_MS,
);

test(
  'PLACEMENT Windows foreground sentinel generated run keeps the run window and the foreground through recycling',
  async () => {
    runnerOnly();
    await mkdir(resolve('apps/cli/test-results/placement'), {
      recursive: true,
    });
    const { browserName, executable } = browserChoice();
    const { receipt: segment, mark } = newReceipt(browserName);
    const root = await mkdtemp(join(tmpdir(), 'sp-placement-run-'));
    const stalls: string[] = [];
    let context: BrowserContext | undefined;
    let sentinel: Awaited<ReturnType<typeof foregroundSentinel>> | undefined;
    try {
      sentinel = await foregroundSentinel(root, segment);
      mark('sentinelReady');
      const placement = placementFor(sentinel.area);
      let runPages = 0;
      const generated = await placementGeneratedRun(
        async (path) => {
          await sentinel!.watch('generatedLaunch', async () => {
            context = await launchRunBrowser(path, executable, placement, true);
          });
          return context!;
        },
        async (phase, action) => {
          let page!: Awaited<ReturnType<typeof action>>;
          const name = `generated-${phase}-${++runPages}`;
          const observed = await sentinel!.watch(name, async () => {
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
            context!,
            segment,
            `${name}-selected`,
            phase === 'reader-start' ? 1 : 2,
          );
          return page;
        },
      );
      mark('generatedRun');
      segment.generatedRun = {
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
      console.log('PLACEMENT_FOREGROUND_RECEIPT', JSON.stringify(segment));
    } catch (error) {
      segment.error = errorClass(error);
      throw error;
    } finally {
      mark('teardownStart');
      await bounded('context', async () => context?.close(), stalls);
      await bounded('sentinel', async () => sentinel?.stop(), stalls);
      await bounded(
        'temp',
        () => rm(root, { recursive: true, force: true }),
        stalls,
      );
      mark('teardownEnd');
      segment.teardownStalls = stalls;
      // One receipt file per browser, as before: the launch segment's fields
      // plus this segment's, the generated-run fields under their old names.
      let merged: Record<string, unknown> = {};
      try {
        merged = JSON.parse(
          await readFile(receiptPath(browserName), 'utf8'),
        ) as Record<string, unknown>;
      } catch {
        merged = { launchSegment: 'missing' };
      }
      const { phaseMs, watchMs, tabReadMs, activationAttempts, ...rest } =
        segment;
      await writeFile(
        receiptPath(browserName),
        JSON.stringify(
          {
            ...merged,
            ...rest,
            generatedPhaseMs: phaseMs,
            generatedWatchMs: watchMs,
            generatedTabReadMs: tabReadMs,
            generatedActivationAttempts: activationAttempts,
          },
          null,
          2,
        ),
      );
    }
    expect(stalls).toEqual([]);
  },
  GENERATED_BUDGET_MS,
);

test(
  'PLACEMENT X deletion run with restored tabs keeps the window, the foreground and closes the tabs',
  async () => {
    runnerOnly();
    const out = resolve('apps/cli/test-results/placement');
    await mkdir(out, { recursive: true });
    const { browserName, executable } = browserChoice();
    const root = await mkdtemp(join(tmpdir(), 'sp-placement-x-'));
    const profile = join(root, 'profile');
    const { receipt, mark } = newReceipt(browserName, { run: 'x-delete' });
    const stalls: string[] = [];
    let sentinel: Awaited<ReturnType<typeof foregroundSentinel>> | undefined;
    let fake: Awaited<ReturnType<typeof fakeX>> | undefined;
    let context: BrowserContext | undefined;
    let store: SQLiteStore | undefined;
    try {
      sentinel = await foregroundSentinel(root, receipt);
      fake = await fakeX();
      const origin = fake.origin;
      mark('sentinelReady');
      const placement = placementFor(sentinel.area);
      receipt.placement = placement;
      await mkdir(profile);
      await createProfile(profile);
      // The browser itself writes the generated session; no profile file edits.
      const seed = await chromium.launchPersistentContext(profile, {
        executablePath: executable,
        headless: browserName !== 'msedge',
        chromiumSandbox: true,
        args: ['--enable-automation'],
        ignoreDefaultArgs: ['--disable-infobars'],
        serviceWorkers: 'block',
      });
      for (let index = 0; index < 7; index++) {
        const tab = index === 0 ? seed.pages()[0]! : await seed.newPage();
        await tab.goto(origin + '/home');
      }
      await seed.close();
      mark('seeded');
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
          executablePath: executable,
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
              origin,
              allowedOrigins: [origin],
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
              (value) => value.type === 'page' && value.url.startsWith(origin),
            ).length,
          };
          if (restored.fixturePages >= 7 || restored.ms > RESTORE_BOUND_MS)
            break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      } finally {
        await targets.detach();
      }
      receipt.restored = restored;
      expect(restored.fixturePages).toBeGreaterThanOrEqual(7);
      mark('restored');
      let result: unknown;
      const runWatch = await sentinel.watch('run', async () => {
        release();
        const confirmation = async () => {
          for (let attempt = 0; attempt < 200; attempt++) {
            const page = context!
              .pages()
              .find((value) =>
                value.url().startsWith(TEST_ORIGINS.confirmation),
              );
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
      mark('run');
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
        await readFile(
          join(profile, `socialprune-delete-${runId}.json`),
          'utf8',
        ),
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
    } catch (error) {
      receipt.error = errorClass(error);
      throw error;
    } finally {
      mark('teardownStart');
      await bounded('context', async () => context?.close(), stalls);
      await bounded('store', async () => store?.close(), stalls);
      await bounded('fake', async () => fake?.close(), stalls);
      await bounded('sentinel', async () => sentinel?.stop(), stalls);
      await bounded(
        'temp',
        () => rm(root, { recursive: true, force: true }),
        stalls,
      );
      mark('teardownEnd');
      receipt.teardownStalls = stalls;
      await writeFile(
        join(out, `placement-x-${browserName}.json`),
        JSON.stringify(receipt, null, 2),
      );
    }
    expect(stalls).toEqual([]);
  },
  X_BUDGET_MS,
);

// SETUP-1: startup with 0, 1 and 8 restored tabs. Per case about 3 s seed,
// 1 s launch, the 15 s restore bound, 1 s startup, 2 watches x 5 s activation
// bound and 3 teardown operations x 5 s: 3 + 1 + 15 + 1 + 10 + 15 = 45 s.
const STARTUP_BUDGET_MS = 45000;
for (const restoredTabs of [0, 1, 8])
  test(
    `PLACEMENT startup with ${restoredTabs} restored tabs keeps the run window and creates the first owned page in it`,
    async () => {
      runnerOnly();
      const out = resolve('apps/cli/test-results/placement');
      await mkdir(out, { recursive: true });
      const { browserName, executable } = browserChoice();
      const { receipt, mark } = newReceipt(browserName, { restoredTabs });
      const root = await mkdtemp(join(tmpdir(), 'sp-placement-startup-'));
      const profile = join(root, 'profile');
      const stalls: string[] = [];
      let sentinel: Awaited<ReturnType<typeof foregroundSentinel>> | undefined;
      let fake: Awaited<ReturnType<typeof fakeInstagram>> | undefined;
      let context: BrowserContext | undefined;
      let boundary: ReturnType<typeof contextPages> | undefined;
      try {
        sentinel = await foregroundSentinel(root, receipt);
        const placement = placementFor(sentinel.area);
        receipt.placement = placement;
        fake = await fakeInstagram(4549, (await instagramFixture(1)).items);
        if (restoredTabs > 0) {
          // The browser itself writes the generated session.
          const seed = await chromium.launchPersistentContext(profile, {
            executablePath: executable,
            headless: browserName !== 'msedge',
            chromiumSandbox: true,
            args: ['--enable-automation'],
            ignoreDefaultArgs: ['--disable-infobars'],
            serviceWorkers: 'block',
          });
          for (let index = 0; index < restoredTabs; index++) {
            const tab = index === 0 ? seed.pages()[0]! : await seed.newPage();
            await tab.goto(
              fake.origin + '/your_activity/interactions/comments',
            );
          }
          await seed.close();
        }
        mark('seeded');
        receipt.launch = await sentinel.watch('launch', async () => {
          context = await chromium.launchPersistentContext(profile, {
            executablePath: executable,
            headless: false,
            chromiumSandbox: true,
            viewport: null,
            offline: true,
            args: [
              '--enable-automation',
              ...windowArguments(placement),
              '--restore-last-session',
            ],
            ignoreDefaultArgs: ['--disable-infobars'],
            serviceWorkers: 'block',
          });
        });
        const restoredAt = Date.now();
        const targets = await context!.browser()!.newBrowserCDPSession();
        let restored = { ms: 0, pages: 0, fixturePages: 0 };
        try {
          for (;;) {
            const { targetInfos } = await targets.send('Target.getTargets');
            restored = {
              ms: Date.now() - restoredAt,
              pages: targetInfos.filter((value) => value.type === 'page')
                .length,
              fixturePages: targetInfos.filter(
                (value) =>
                  value.type === 'page' && value.url.startsWith(fake!.origin),
              ).length,
            };
            if (
              restored.fixturePages >= restoredTabs ||
              restored.ms > RESTORE_BOUND_MS
            )
              break;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        } finally {
          await targets.detach();
        }
        receipt.restored = restored;
        receipt.launchPages = context!.pages().length;
        expect(restored.fixturePages).toBeGreaterThanOrEqual(restoredTabs);
        mark('restored');
        boundary = contextPages(context!, () => {});
        let reading!: Awaited<ReturnType<typeof boundary.startupPage>>;
        const startup = await sentinel.watch('startup', async () => {
          try {
            reading = await boundary!.startupPage();
          } finally {
            receipt.pages = boundary!.snapshot();
          }
        });
        mark('startup');
        const session = await context!.newCDPSession(reading);
        const { bounds } = await session.send('Browser.getWindowForTarget');
        await session.detach();
        receipt.bounds = bounds;
        expect(startup.changed).toBe(false);
        expect(reading.isClosed()).toBe(false);
        expect(boundary.snapshot()).toMatchObject({
          ownedOpen: 1,
          backgroundCreated: 1,
          remainingNonOwned: 0,
          targetFailure: null,
          unexpectedOpened: 0,
        });
        expect(bounds).toMatchObject({
          left: placement.x,
          top: placement.y,
          width: placement.width,
          height: placement.height,
          windowState: 'normal',
        });
        receipt.status = 'passed';
      } catch (error) {
        receipt.error = errorClass(error);
        throw error;
      } finally {
        mark('teardownStart');
        boundary?.dispose();
        await bounded('context', async () => context?.close(), stalls);
        await bounded('fake', async () => fake?.close(), stalls);
        await bounded('sentinel', async () => sentinel?.stop(), stalls);
        await bounded(
          'temp',
          () => rm(root, { recursive: true, force: true }),
          stalls,
        );
        mark('teardownEnd');
        receipt.teardownStalls = stalls;
        await writeFile(
          join(out, `placement-startup-${restoredTabs}-${browserName}.json`),
          JSON.stringify(receipt, null, 2),
        );
      }
      expect(stalls).toEqual([]);
    },
    STARTUP_BUDGET_MS,
  );
