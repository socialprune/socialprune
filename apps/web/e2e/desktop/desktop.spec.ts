import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fakeBridge } from './fake-bridge.ts';
import type { FakeBridge } from './fake-bridge.ts';
import { allPhases, runView, instagramView, ownEntry } from './views.ts';
import { checkAccessibility } from '../accessibility.ts';
import en from '../../src/i18n/en.json' with { type: 'json' };
import de from '../../src/i18n/de.json' with { type: 'json' };
import { guides } from '../../src/app/guide.ts';
import { guideFacts } from '@socialprune/core/guide/check';
import { assertDesktopOutput } from '../../tooling/desktop-build-output.ts';
import { outputFiles } from '../../tooling/review-output.ts';
import { fileURLToPath } from 'node:url';
import { DESKTOP_POLICY } from '../../src/desktop/policy.ts';

function assertNetwork(urls: readonly string[], origin: string) {
  expect(urls.filter((url) => new URL(url).origin !== origin)).toEqual([]);
}
async function audit(context: BrowserContext, page: Page, origin: string) {
  const urls: string[] = [],
    errors: string[] = [];
  context.on('request', (request) => urls.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const violations: string[] = [];
    Reflect.set(globalThis, '__desktopTestPolicy', violations);
    document.addEventListener('securitypolicyviolation', (event) =>
      violations.push(event.effectiveDirective),
    );
  });
  return {
    urls,
    async assert() {
      assertNetwork(urls, origin);
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(
          () => Reflect.get(globalThis, '__desktopTestPolicy') as string[],
        ),
      ).toEqual([]);
      expect(page.workers()).toEqual([]);
      expect(
        await page.evaluate(() => typeof Reflect.get(window, 'require')),
      ).toBe('undefined');
      expect(
        await page.evaluate(() => typeof Reflect.get(window, 'process')),
      ).toBe('undefined');
    },
  };
}

const test = base.extend<{ bridge: FakeBridge; networkAudit: void }>({
  networkAudit: [
    async ({ page, context, baseURL }, use, testInfo) => {
      const trace = await audit(context, page, baseURL!);
      await use();
      if (
        trace.urls.length &&
        !testInfo.annotations.some(
          ({ type }) => type === 'network-positive-control',
        )
      )
        await trace.assert();
    },
    { auto: true },
  ],
  bridge: async ({ page }, use) => {
    const bridge = await fakeBridge(page);
    try {
      await use(bridge);
    } finally {
      await bridge.close();
    }
  },
});

async function monitor(page: Page) {
  await page
    .getByRole('navigation')
    .getByRole('button', { name: en['desktop.monitor'] })
    .click();
}
async function stopByKeyboard(page: Page) {
  await page.keyboard.press('Control+Home');
  const stop = page.getByRole('button', {
    name: en['desktop.stop'],
    exact: true,
  });
  for (let index = 0; index < 100; index++) {
    await page.keyboard.press('Tab');
    if (await stop.evaluate((element) => element === document.activeElement))
      break;
  }
  await expect(stop).toBeFocused();
  await expect(stop).toBeInViewport();
  await page.keyboard.press('Enter');
}

test('setup imports the generated demo and review decisions travel through the bridge', async ({
  page,
  context,
  baseURL,
  bridge,
}) => {
  const trace = await audit(context, page, baseURL!);
  const response = await page.goto('/desktop.html');
  expect(response?.headers()['content-security-policy']).toBe(DESKTOP_POLICY);
  await page
    .getByTestId('desktop-setup')
    .getByRole('button', { name: en['desktop.next'], exact: true })
    .click();
  await expect(
    page.getByTestId('desktop-setup').getByRole('combobox'),
  ).toHaveValue('edge');
  await page
    .getByTestId('desktop-setup')
    .getByRole('button', { name: en['desktop.next'], exact: true })
    .click();
  const xProfile = page.getByRole('region', {
    name: en['guide.x'],
    exact: true,
  });
  await xProfile
    .getByRole('button', { name: en['desktop.profileSetup'] })
    .click();
  await expect(xProfile).toContainText(en['desktop.profile.ready']);
  const igProfile = page.getByRole('region', {
    name: en['guide.instagram'],
    exact: true,
  });
  await igProfile
    .getByRole('button', { name: en['desktop.profileAdopt'] })
    .click();
  await expect(igProfile).toContainText(en['desktop.profile.ready']);
  await igProfile
    .getByRole('button', { name: en['desktop.profileForget'] })
    .click();
  await expect(igProfile).toContainText(en['desktop.profile.missing']);
  await page
    .getByTestId('desktop-setup')
    .getByRole('button', { name: en['desktop.next'], exact: true })
    .click();
  const fact = guideFacts(guides[0]!)[0]!;
  await page.locator(`[data-fact-id="${fact.id}"]`).getByRole('button').click();
  await page
    .getByRole('button', { name: en['guide.report'], exact: true })
    .click();
  expect(
    bridge.requests
      .filter((request) => request.type === 'openLink')
      .map(({ requestId: _requestId, ...request }) => request),
  ).toEqual([
    {
      type: 'openLink',
      link: {
        kind: 'guide-source',
        platform: 'x',
        factId: fact.id,
        locale: 'en',
      },
    },
    { type: 'openLink', link: { kind: 'guide-report' } },
  ]);
  await expect(
    page.getByRole('button', { name: en['guide.reminder'], exact: true }),
  ).toHaveCount(0);
  await page
    .getByTestId('desktop-setup')
    .getByRole('button', { name: en['desktop.next'], exact: true })
    .click();
  await expect(page.getByText(en['desktop.storeNote'])).toBeVisible();
  await page
    .getByRole('button', { name: en['desktop.import'], exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: en['review.title'], exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('review-card')).toBeVisible();
  const before = (await bridge.snapshot()).decisionEvents.length;
  await page.getByRole('button', { name: /^Keep/ }).first().click();
  await expect
    .poll(async () => (await bridge.snapshot()).decisionEvents.length)
    .toBe(before + 1);
  expect((await bridge.snapshot()).decisionEvents.at(-1)?.source.via).toBe(
    'local-review',
  );
  expect(bridge.requests.some((request) => request.type === 'decide')).toBe(
    true,
  );
  const beforeUndo = (await bridge.snapshot()).decisionEvents.length;
  await page.getByRole('button', { name: /^Undo/ }).first().click();
  await expect
    .poll(async () => (await bridge.snapshot()).decisionEvents.length)
    .toBe(beforeUndo + 1);
  expect(bridge.requests.some((request) => request.type === 'undo')).toBe(true);
  expect(
    bridge.requests.find((request) => request.type === 'importExport'),
  ).toEqual({ type: 'importExport', requestId: expect.any(String) });
  await trace.assert();
});

test('accepted post links use openLink; rejected addresses are text and no anchor navigates', async ({
  page,
  context,
  baseURL,
  bridge,
}) => {
  const trace = await audit(context, page, baseURL!);
  await page.goto('/desktop.html');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: en['proto.archiveTitle'], exact: true })
    .click();
  await expect(page.getByTestId('recap')).toBeVisible();
  const postLink = page.locator('a[href^="https://x.com/"]').first();
  await expect(postLink).toBeVisible();
  const url = await postLink.getAttribute('href');
  const locationBefore = page.url();
  await postLink.click();
  expect(
    bridge.requests.filter((request) => request.type === 'openLink'),
  ).toEqual([
    {
      type: 'openLink',
      requestId: expect.any(String),
      link: { kind: 'platform-post', url },
    },
  ]);
  expect(page.url()).toBe(locationBefore);
  await page.evaluate(() => {
    const anchor = document.createElement('a');
    anchor.href = 'https://x.com/generated/settings';
    anchor.textContent = 'Rejected generated address';
    document.querySelector('main')!.append(anchor);
  });
  const rejected = page.getByText('Rejected generated address');
  await expect(rejected).not.toHaveAttribute('href');
  await expect(
    page.getByRole('link', { name: 'Rejected generated address' }),
  ).toHaveCount(0);
  await rejected.click();
  expect(
    bridge.requests.filter((request) => request.type === 'openLink'),
  ).toHaveLength(1);
  expect(page.url()).toBe(locationBefore);
  const instagramUrl = 'https://www.instagram.com/reel/Generated_1/';
  await page.evaluate((url) => {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.textContent = 'Generated Instagram reel';
    document.querySelector('main')!.append(anchor);
  }, instagramUrl);
  await page.getByRole('link', { name: 'Generated Instagram reel' }).click();
  expect(
    bridge.requests.filter((request) => request.type === 'openLink').at(-1),
  ).toMatchObject({ link: { kind: 'platform-post', url: instagramUrl } });
  await trace.assert();
});

test('review and click-list post links share the same desktop interceptor', async ({
  page,
  bridge,
}) => {
  await page.goto('/desktop.html');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: en['review.title'], exact: true })
    .click();
  await expect(page.getByTestId('review-card')).toBeVisible();
  await page
    .getByRole('button', { name: /^Delete/ })
    .first()
    .click();
  await expect
    .poll(async () => (await bridge.snapshot()).decisionEvents.length)
    .toBe(1);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: en['clicklist.title'], exact: true })
    .click();
  await page
    .getByRole('button', { name: en['clicklist.start'], exact: true })
    .click();
  const link = page.locator('a[data-open-platform]').first();
  await expect(link).toBeVisible();
  const url = await link.getAttribute('href');
  const before = page.url();
  await link.click();
  expect(
    bridge.requests.filter((request) => request.type === 'openLink').at(-1),
  ).toMatchObject({ link: { kind: 'platform-post', url } });
  expect(page.url()).toBe(before);
  await page
    .getByRole('link', { name: en['proto.goTitle'], exact: true })
    .click();
  await expect(page.getByTestId('delete-mode')).toBeVisible();
  await page.locator('a[data-open-platform]').click();
  expect(
    bridge.requests.filter((request) => request.type === 'openLink'),
  ).toHaveLength(2);
});

test('every schema phase renders and Stop is reachable by keyboard in every phase', async ({
  page,
  bridge,
}) => {
  await page.goto('/desktop.html');
  await monitor(page);
  let version = 1;
  for (const phase of allPhases) {
    const value = runView(phase, version++ * 10);
    await bridge.push(value);
    await expect(page.getByTestId('desktop-monitor')).toHaveAttribute(
      'data-phase',
      phase,
    );
    await expect(
      page.getByTestId('desktop-monitor').getByRole('status'),
    ).toHaveAttribute('aria-live', 'polite');
    if (phase !== 'idle') {
      await expect(page.getByTestId('desktop-monitor')).toContainText(
        ownEntry.text.split('\n')[0]!,
      );
      await expect(page.getByRole('progressbar')).toHaveAttribute('value', '3');
      await expect(page.getByText(en['desktop.sharedCap'])).toBeVisible();
      await expect(page.getByTestId('desktop-monitor')).toContainText(
        en['desktop.token.read'],
      );
    }
    const before = bridge.requests.filter(
      (request) => request.type === 'runAction',
    ).length;
    await stopByKeyboard(page);
    const actions = bridge.requests.filter(
      (request) => request.type === 'runAction',
    );
    if (phase === 'idle') expect(actions).toHaveLength(before);
    else
      expect(actions.at(-1)).toMatchObject({
        type: 'runAction',
        runId: 'generated-desktop-run',
        version: value.version,
        action: 'stop',
      });
  }
});

test('the keyboard Stop assertion fails when a planted tab-order defect removes Stop', async ({
  page,
  bridge,
}) => {
  await page.goto('/desktop.html');
  await monitor(page);
  await bridge.push(runView('running', 10));
  await page
    .getByRole('button', { name: en['desktop.stop'], exact: true })
    .evaluate((button) => {
      button.tabIndex = -1;
    });
  let reached = false;
  for (let index = 0; index < 30; index++) {
    await page.keyboard.press('Tab');
    reached ||= await page
      .getByRole('button', { name: en['desktop.stop'], exact: true })
      .evaluate((button) => document.activeElement === button);
  }
  expect(() => expect(reached).toBe(true)).toThrow();
  expect(
    bridge.requests.filter((request) => request.type === 'runAction'),
  ).toEqual([]);
});

test('the warning assertion rejects a planted enabled Start, while the handler still sends nothing', async ({
  page,
  bridge,
}) => {
  await page.goto('/desktop.html');
  await monitor(page);
  await bridge.push(runView('awaiting-warning', 10));
  const start = page.getByRole('button', {
    name: en['desktop.start'],
    exact: true,
  });
  await start.evaluate((button) => {
    (button as HTMLButtonElement).disabled = false;
  });
  const disabled = await start.isDisabled();
  expect(() => expect(disabled).toBe(true)).toThrow();
  await start.click();
  expect(
    bridge.requests.filter((request) => request.type === 'runAction'),
  ).toEqual([]);
});

test('the person previews a run, opens its warning, and can stop while looking at another screen', async ({
  page,
  bridge,
}) => {
  await page.goto('/desktop.html');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: en['review.title'], exact: true })
    .click();
  await expect(page.getByTestId('review-card')).toBeVisible();
  await monitor(page);
  await page
    .getByRole('button', { name: en['desktop.plan'], exact: true })
    .click();
  await page
    .getByRole('button', { name: en['desktop.openMonitor'], exact: true })
    .click();
  await expect(
    page.getByRole('checkbox', { name: en['desktop.warningTick'] }),
  ).toBeVisible();
  expect(
    bridge.requests.filter((request) => request.type === 'planRun').at(-1),
  ).toMatchObject({
    mode: 'fill',
    platform: 'x',
    accountKey: ownEntry.account.key,
  });
  await page
    .getByRole('navigation')
    .getByRole('button', { name: en['desktop.data'], exact: true })
    .click();
  await page
    .getByRole('button', { name: en['desktop.stop'], exact: true })
    .focus();
  await page.keyboard.press('Enter');
  expect(
    bridge.requests.filter((request) => request.type === 'runAction').at(-1),
  ).toMatchObject({ action: 'stop' });
});

test('warning tick gates Start; pause pending differs from paused; canary accepts and declines; 429 and read-back remain explicit', async ({
  page,
  bridge,
}) => {
  await page.goto('/desktop.html');
  await monitor(page);
  await bridge.push(runView('awaiting-warning', 10));
  const start = page.getByRole('button', {
    name: en['desktop.start'],
    exact: true,
  });
  await expect(start).toBeDisabled();
  await page.keyboard.press('Tab');
  expect(
    bridge.requests.filter((request) => request.type === 'runAction'),
  ).toEqual([]);
  await page.getByRole('checkbox', { name: en['desktop.warningTick'] }).check();
  await start.click();
  await expect(page.getByTestId('desktop-monitor')).toHaveAttribute(
    'data-phase',
    'running',
  );
  expect(
    bridge.requests
      .filter((request) => request.type === 'runAction')
      .map((request) => request.action),
  ).toEqual(['acknowledge-warning', 'start']);
  await page.getByRole('button', { name: en['desktop.pause'] }).click();
  await expect(page.getByTestId('pause-pending')).toHaveText(
    en['desktop.pausePending'],
  );
  await expect(
    page.getByRole('button', { name: en['desktop.resume'] }),
  ).toHaveCount(0);
  await bridge.push(runView('paused', 30));
  await expect(page.getByTestId('pause-pending')).toHaveCount(0);
  await page.getByRole('button', { name: en['desktop.resume'] }).click();
  for (const [name, action] of [
    [en['desktop.matches'], 'matches'],
    [en['desktop.doesNotMatch'], 'does-not-match'],
  ] as const) {
    await bridge.push(runView('canary-review', action === 'matches' ? 50 : 60));
    await page.getByRole('button', { name, exact: true }).click();
    expect(
      bridge.requests.filter((request) => request.type === 'runAction').at(-1),
    ).toMatchObject({ action });
  }
  await bridge.push(runView('awaiting-continue', 70));
  await page
    .getByTestId('desktop-monitor')
    .getByRole('button', { name: en['desktop.next'], exact: true })
    .click();
  expect(
    bridge.requests.filter((request) => request.type === 'runAction').at(-1),
  ).toMatchObject({ action: 'continue' });
  const profile = (
    runView('running', 80) as Exclude<
      ReturnType<typeof runView>,
      { phase: 'idle' }
    >
  ).profile;
  await bridge.push(
    runView('ended', 80, {
      end: {
        at: new Date().toISOString(),
        reason: 'platform-check',
        detail: 'http-429',
        cliCode: 'PLATFORM_CHECK',
      },
      profile: {
        ...profile,
        readback: {
          outcome: 'not-completed',
          profileObserved: false,
          accountBefore: null,
          accountAfter: null,
          extensionIdsBefore: [],
          extensionIdsAfter: [],
          extensionIdsAdded: [],
          extensionIdsRemoved: [],
          changedFiles: [],
          unexpectedRequests: [],
        },
      },
    }),
  );
  await expect(page.getByTestId('run-end')).toHaveText(
    en['desktop.token.http-429'],
  );
  await expect(page.getByTestId('readback-outcome')).toHaveText(
    en['desktop.token.not-completed'],
  );
  await bridge.push(instagramView(90));
  await expect(
    page.getByRole('heading', { name: en['desktop.instagramResponses'] }),
  ).toBeVisible();
  await expect(
    page.getByText('x-ratelimit-remaining, retry-after'),
  ).toBeVisible();
  await expect(page.getByText(en['desktop.instagramCap'])).toBeVisible();
  const short = runView('awaiting-warning', 100);
  if (short.phase !== 'awaiting-warning')
    throw new Error('Expected warning view.');
  await bridge.push({
    ...short,
    runId: 'generated-second-run',
    warning: { ...short.warning, form: 'short' },
  });
  await expect(page.getByText(en['desktop.warning.short'])).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: en['desktop.warningTick'] }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('button', { name: en['desktop.start'], exact: true }),
  ).toBeDisabled();
});

test('settings displays bounded folder data and uses path-free native operations', async ({
  page,
  bridge,
}) => {
  await page.goto('/desktop.html');
  await page
    .getByRole('navigation')
    .getByRole('button', { name: en['desktop.data'] })
    .click();
  await expect(page.getByTestId('data-folder')).toHaveText(
    'C:\\Generated\\SocialPrune Data',
  );
  for (const [name, type] of [
    [en['desktop.folderOpen'], 'dataFolderOpen'],
    [en['desktop.backupExport'], 'backupExport'],
  ] as const) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect
      .poll(() => bridge.requests.some((request) => request.type === type))
      .toBe(true);
    expect(bridge.requests.find((request) => request.type === type)).toEqual({
      type,
      requestId: expect.any(String),
    });
  }
  await page.getByRole('button', { name: en['desktop.backupRestore'] }).click();
  await expect
    .poll(() =>
      bridge.requests.some((request) => request.type === 'backupRestore'),
    )
    .toBe(true);
});

test(
  'network audit catches a real planted second-origin request and CSP catches a planted inline script',
  {
    annotation: {
      type: 'network-positive-control',
      description:
        'This case deliberately navigates to a second origin and asserts audit rejection.',
    },
  },
  async ({ page, context, baseURL, bridge: _bridge }) => {
    const trace = await audit(context, page, baseURL!);
    await page.goto('/desktop.html');
    await expect(page.getByTestId('desktop-setup')).toBeVisible();
    await trace.assert();
    const second = new URL(baseURL!);
    second.hostname = 'localhost';
    await page.goto(`${second.origin}/desktop.html`);
    expect(() => assertNetwork(trace.urls, baseURL!)).toThrow();
    await page.evaluate(() => {
      const script = document.createElement('script');
      try {
        script.textContent = 'globalThis.__plantedInline = true';
        document.head.append(script);
      } catch {
        /* Trusted Types may reject before CSP. */
      }
    });
    expect(
      await page.evaluate(
        () => Reflect.get(globalThis, '__plantedInline') as unknown,
      ),
    ).toBeUndefined();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (Reflect.get(globalThis, '__desktopTestPolicy') as string[]).length,
        ),
      )
      .toBeGreaterThan(0);
  },
);

test('built output rejects planted policy, WASM and fake-bridge violations', async () => {
  const files = await outputFiles(
    fileURLToPath(new URL('../../dist-desktop/', import.meta.url)),
  );
  assertDesktopOutput(files);
  const html = await readFile(
    new URL('../../dist-desktop/desktop.html', import.meta.url),
    'utf8',
  );
  for (const [path, content] of [
    ['desktop.html', html.replace("connect-src 'none'", "connect-src 'self'")],
    ['assets/planted.js', 'desktop-fake-bridge'],
    ['assets/module.wasm', 'planted'],
  ] as const) {
    const planted = new Map(files);
    planted.set(path, content);
    expect(() => assertDesktopOutput(planted)).toThrow();
  }
});

for (const [locale, catalog] of [
  ['en', en],
  ['de', de],
] as const) {
  test(`${locale} setup, monitor and settings pass IBM WCAG 2.2 checks`, async ({
    page,
    context,
  }) => {
    const bridge = await fakeBridge(page, locale);
    try {
      await page.goto('/desktop.html');
      await expect(page.getByTestId('desktop-setup')).toBeVisible();
      await checkAccessibility(page, context);
      await page
        .getByRole('navigation')
        .getByRole('button', { name: catalog['desktop.monitor'] })
        .click();
      await bridge.push(runView('awaiting-warning', 10));
      await expect(
        page.getByText(catalog['desktop.warning.full']),
      ).toBeVisible();
      await checkAccessibility(page, context);
      await page
        .getByRole('navigation')
        .getByRole('button', { name: catalog['desktop.data'] })
        .click();
      await expect(page.getByTestId('data-folder')).toBeVisible();
      await checkAccessibility(page, context);
    } finally {
      await bridge.close();
    }
  });
}
