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
      async (path, executable) => {
        await watch('generatedLaunch', async () => {
          context = await launchRunBrowser(path, executable, placement, true);
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
