import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
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
    const launch = await watch('launch', async () => {
      context = await launchRunBrowser(
        join(root, 'profile'),
        chromium.executablePath(),
        placement,
        true,
      );
    });
    const fixture = await instagramFixture(1);
    fake = await fakeInstagram(4549, fixture.items);
    await context!.setOffline(false);
    await context!.route('**/*', (route) =>
      new URL(route.request().url()).origin === fake!.origin
        ? route.continue()
        : route.abort(),
    );
    const boundary = contextPages(context!, () => {});
    let bounds: unknown,
      sameWindow = true;
    let activePair: Awaited<ReturnType<typeof boundary.newPage>>[] = [];
    const pages = await watch('pages', async () => {
      const confirmation = await boundary.startupPage();
      await confirmation.setContent(
        '<title>Generated confirmation probe</title>',
      );
      const session = await context!.newCDPSession(confirmation);
      const first = await session.send('Browser.getWindowForTarget');
      bounds = first.bounds;
      let reading = await boundary.newPage();
      await reading.goto(fake!.origin + '/your_activity/interactions/comments');
      reading = await boundary.replace(reading);
      await reading.goto(fake!.origin + '/your_activity/interactions/comments');
      await reading.evaluate(() => {
        document.title = 'Generated reading probe';
      });
      const next = await context!.newCDPSession(reading);
      sameWindow =
        (await next.send('Browser.getWindowForTarget')).windowId ===
        first.windowId;
      await next.detach();
      await session.detach();
      activePair = [confirmation, reading];
    });
    receipt.bounds = bounds;
    receipt.pagesCount = boundary.snapshot();
    receipt.sameWindow = sameWindow;
    receipt.launchKeptForeground = !launch.changed;
    receipt.pagesKeptForeground = !pages.changed;
    receipt.status = launch.changed ? 'launch-activated-window' : 'passed';
    const animation = await activePair[1]!.evaluate(async () => {
      const at = performance.now();
      for (let index = 0; index < 3; index++)
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      return performance.now() - at;
    });
    receipt.readingThreeFrameMs = Math.round(animation);
    expect(animation).toBeLessThan(1000);
    const browserSession = await context!.browser()!.newBrowserCDPSession();
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
      receipt.selectedTabs = observed;
      expect(observed).toMatchObject({
        count: 2,
        offscreen: false,
      });
      expect(
        observed.tabs.find((tab) => tab.kind === 'reading')?.selected,
      ).toBe(true);
      expect(
        observed.tabs.find((tab) => tab.kind === 'confirmation')?.selected,
      ).toBe(false);
    } finally {
      await browserSession.detach();
    }
    expect(bounds).toMatchObject({
      left: placement.x,
      top: placement.y,
      width: placement.width,
      height: placement.height,
      windowState: 'normal',
    });
    expect(boundary.snapshot()).toMatchObject({
      pageLimit: 3,
      ownedPeak: 3,
      backgroundCreated: 3,
      replaced: 1,
    });
    expect(sameWindow).toBe(true);
    expect(pages.changed).toBe(false);
    await context!.close();
    context = undefined;
    let runPages = 0;
    const generated = await placementGeneratedRun(
      async (path, executable) => {
        await watch('generatedLaunch', async () => {
          context = await launchRunBrowser(path, executable, placement, true);
        });
        return context!;
      },
      async (action) => {
        let page!: Awaited<ReturnType<typeof action>>;
        const observed = await watch(`generatedPage${++runPages}`, async () => {
          page = await action();
        });
        expect(observed.changed).toBe(false);
        return page;
      },
    );
    receipt.generatedRun = {
      pages: generated.pages,
      rows: generated.rows,
      stop: generated.stop,
    };
    // An observed first-window activation is a reported limitation, not a false pass.
    console.log('PLACEMENT_FOREGROUND_RECEIPT', JSON.stringify(receipt));
    boundary.dispose();
  } finally {
    await writeFile(
      join(out, 'placement.json'),
      JSON.stringify(receipt, null, 2),
    );
    await context?.close();
    await fake?.close();
    await writeFile(stop, 'stop');
    await sentinelDone;
    await rm(root, { recursive: true, force: true });
  }
});
