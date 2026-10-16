import { CliError } from '../cli/errors.ts';
import type { BrowserContext } from 'playwright-core';

/** Launch tabs can carry a restore navigation even while still at about:blank. */
export async function freshPlatformPage(context: BrowserContext) {
  const inherited = context.pages();
  const page = await context.newPage();
  for (const tab of inherited) await tab.close({ runBeforeUnload: false });
  return page;
}
export async function waitForBrowserClose(
  context: BrowserContext,
): Promise<void> {
  if (context.pages().length)
    await new Promise<void>((resolve) =>
      context.once('close', () => resolve()),
    );
}

export interface WindowPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function windowArguments(placement?: WindowPlacement): string[] {
  if (!placement) return [];
  if (
    ![placement.x, placement.y, placement.width, placement.height].every(
      Number.isSafeInteger,
    ) ||
    placement.width < 1 ||
    placement.height < 1
  )
    throw new CliError('INVALID_ARGUMENTS');
  return [
    `--window-position=${placement.x},${placement.y}`,
    `--window-size=${placement.width},${placement.height}`,
  ];
}
/** Same visible installed-browser launch, with placement as its only addition. */
export async function launchRunBrowser(
  profile: string,
  executablePath: string,
  placement?: WindowPlacement,
  offline = false,
) {
  const { chromium } = await import('playwright-core');
  return chromium.launchPersistentContext(profile, {
    executablePath,
    headless: false,
    ...(offline ? { offline: true } : {}),
    chromiumSandbox: true,
    args: ['--enable-automation', ...windowArguments(placement)],
    serviceWorkers: 'block',
    ignoreDefaultArgs: ['--disable-infobars'],
  });
}
