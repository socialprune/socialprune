import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { BrowserContext, Page } from 'playwright-core';
import { windowArguments } from '../src/browser/launch.ts';

// RENDER-1 measurement, runner only. A generated page with a reply-style
// control is shown in the placed run window; for each launch variant the probe
// measures requestAnimationFrame cadence and one 1 s click dispatch while the
// window is uncovered, fully covered by an opaque window in front, and
// minimized (measurement only; the product never minimizes or restores).
// Budget: 2 browsers are chosen per step; per variant launch about 2 s plus
// 3 states x (1 s frames + 1 s click + 1.5 s settle) = about 13 s; 3 variants
// = about 40 s, plus 5 s per cover start: declared 120 s. Run 42523158929
// measured 23 s per step for two variants; three variants fit the same cap.
const BUDGET_MS = 120000;
const VARIANTS: Record<string, { args: string[]; drop: string[] }> = {
  default: { args: [], drop: [] },
  'no-native-occlusion': {
    args: ['--disable-features=CalculateNativeWinOcclusion'],
    drop: [],
  },
  // Control: Playwright's two background switches removed, to show whether
  // they are what keeps an occluded or minimized window rendering.
  'without-background-switches': {
    args: [],
    drop: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  },
};
async function waitFile(path: string) {
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
}
async function measure(page: Page) {
  const frames = await page.evaluate(
    () =>
      new Promise<{ frames: number; visibility: string; focused: boolean }>(
        (resolve) => {
          let count = 0;
          const tick = () => {
            count++;
            if (performance.now() < end) requestAnimationFrame(tick);
          };
          const end = performance.now() + 1000;
          requestAnimationFrame(tick);
          setTimeout(
            () =>
              resolve({
                frames: count,
                visibility: document.visibilityState,
                focused: document.hasFocus(),
              }),
            1100,
          );
        },
      ),
  );
  await page.evaluate(() => {
    Reflect.set(window, '__clicked', 0);
  });
  const started = Date.now();
  let click = 'none';
  try {
    await page
      .getByRole('button', { name: 'View all 2 replies' })
      .click({ timeout: 1000 });
  } catch (error) {
    click = error instanceof Error ? error.name : 'unknown';
  }
  const clicked = await page.evaluate(() =>
    Number(Reflect.get(window, '__clicked')),
  );
  return { ...frames, click, clickMs: Date.now() - started, clicked };
}
async function windowState(
  context: BrowserContext,
  page: Page,
  state?: string,
) {
  const session = await context.newCDPSession(page);
  try {
    const { windowId } = await session.send('Browser.getWindowForTarget');
    if (state)
      await session.send('Browser.setWindowBounds', {
        windowId,
        bounds: { windowState: state as 'minimized' | 'normal' },
      });
    return (await session.send('Browser.getWindowBounds', { windowId })).bounds;
  } finally {
    await session.detach();
  }
}

test(
  'RENDER-1 occlusion probe measures frames and click dispatch per launch variant',
  async () => {
    expect(process.platform).toBe('win32');
    // eslint-disable-next-line no-restricted-properties -- Test-only runner admission, never a credential.
    expect(process.env['GITHUB_ACTIONS']).toBe('true');
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
    const out = resolve('apps/cli/test-results/placement');
    await mkdir(out, { recursive: true });
    const root = await mkdtemp(join(tmpdir(), 'sp-occlusion-'));
    const placement = { x: 40, y: 40, width: 900, height: 640 };
    const receipt: Record<string, unknown> = {
      generatedOnly: true,
      browser: browserName,
      // eslint-disable-next-line no-restricted-properties -- Test-only source identity, never a credential.
      source: process.env['GITHUB_SHA'],
      placement,
    };
    try {
      for (const [variant, extra] of Object.entries(VARIANTS)) {
        const context = await chromium.launchPersistentContext(
          join(root, variant),
          {
            executablePath: executable!,
            headless: false,
            viewport: null,
            chromiumSandbox: true,
            args: [
              '--enable-automation',
              ...windowArguments(placement),
              ...extra,
            ],
            serviceWorkers: 'block',
            ignoreDefaultArgs: ['--disable-infobars'],
          },
        );
        const result: Record<string, unknown> = {};
        receipt[variant] = result;
        try {
          const page = context.pages()[0] ?? (await context.newPage());
          await page.setContent(
            '<title>Generated reading probe</title><div role="button" tabindex="0" onclick="window.__clicked++">View all 2 replies</div>',
          );
          const browserSession = await context
            .browser()!
            .newBrowserCDPSession();
          const command = await browserSession.send(
            'Browser.getBrowserCommandLine',
          );
          await browserSession.detach();
          result.disableFeatures = command.arguments.filter((value) =>
            value.startsWith('--disable-features='),
          ).length;
          result.backgroundSwitches = command.arguments.filter((value) =>
            /^--disable-(?:backgrounding-occluded-windows|renderer-backgrounding)$/u.test(
              value,
            ),
          );
          result.webdriver = await page.evaluate(() => navigator.webdriver);
          result.userAgent = await page.evaluate(() => navigator.userAgent);
          result.uncovered = await measure(page);
          const bounds = await windowState(context, page);
          const ready = join(root, `${variant}.cover.ready`),
            stop = join(root, `${variant}.cover.stop`);
          const cover = spawn(
            'powershell.exe',
            [
              '-NoProfile',
              '-NonInteractive',
              '-STA',
              '-File',
              fileURLToPath(new URL('./placement-cover.ps1', import.meta.url)),
              [bounds.left, bounds.top, bounds.width, bounds.height].join(','),
              ready,
              stop,
            ],
            { windowsHide: true, stdio: 'ignore' },
          );
          const coverDone = new Promise<void>((resolve) =>
            cover.once('exit', () => resolve()),
          );
          result.cover = JSON.parse(await waitFile(ready)) as unknown;
          await new Promise((resolve) => setTimeout(resolve, 1500));
          result.covered = await measure(page);
          await writeFile(stop, 'stop');
          await coverDone;
          await new Promise((resolve) => setTimeout(resolve, 1000));
          result.uncoveredAgain = await measure(page);
          await windowState(context, page, 'minimized');
          await new Promise((resolve) => setTimeout(resolve, 1500));
          result.minimizedBounds = await windowState(context, page);
          result.minimized = await measure(page);
          await windowState(context, page, 'normal');
        } finally {
          await context.close();
        }
      }
    } finally {
      await writeFile(
        join(out, `occlusion-${browserName}.json`),
        JSON.stringify(receipt, null, 2),
      );
      await rm(root, { recursive: true, force: true });
    }
    console.log('RENDER1_RECEIPT', JSON.stringify(receipt));
  },
  BUDGET_MS,
);
