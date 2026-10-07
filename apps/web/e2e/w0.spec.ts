import { test, expect } from '@playwright/test';
import { DATA_WORKER_POLICY, DOCUMENT_POLICY } from '../src/sw/policies.ts';
import {
  observeImport,
  waitForApp,
  fixtureZips,
  importFiles,
  workspaceIds,
} from './helpers.ts';
import { method9Zip } from './archive-method9.ts';

test('W0 first visit claims control, verifies the worker and imports without a reload', async ({
  page,
  context,
  baseURL,
}) => {
  const audit = await observeImport(context, page);
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await waitForApp(page);
  expect(navigations).toBe(1);
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
  ).toBe(new URL('/socialprune/sw.js', baseURL).href);
  const fixture = await fixtureZips('x', 'current-minimal');
  try {
    expect(
      await importFiles(page, fixture.files).then(() => workspaceIds(page)),
    ).toEqual(fixture.expected.items.map(({ id }) => id).sort());
    await audit.assert();
  } finally {
    await fixture.cleanup();
  }
});

test('W0 actual cached worker and HTML carry header policies in every engine', async ({
  page,
}) => {
  await waitForApp(page);
  const worker = page
    .workers()
    .find((worker) => /\/worker-/.test(worker.url()));
  if (!worker) throw new Error('Missing real import worker.');
  const workerURL = worker.url();
  const html = await page.reload();
  expect(html?.fromServiceWorker()).toBe(true);
  expect(html?.headers()['content-security-policy']).toBe(DOCUMENT_POLICY);
  expect(html?.headers()['referrer-policy']).toBe('no-referrer');
  // A browser navigation, not APIRequestContext, passes through this context's
  // active service worker. Inspect both the worker bytes and header here.
  const response = await page.goto(workerURL);
  expect(response?.fromServiceWorker()).toBe(true);
  expect(response?.headers()['content-security-policy']).toBe(
    DATA_WORKER_POLICY,
  );
  expect(response?.headers()['x-content-type-options']).toBe('nosniff');
});

test('W0 blocked registration keeps File input absent and demo reachable', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.serviceWorker, 'register', {
      value: () => Promise.reject(new Error('Test-only blocked registration.')),
    });
  });
  await page.goto('/socialprune/#/import');
  await expect(page.locator('main[data-gate]')).toHaveAttribute(
    'data-gate',
    'unavailable',
  );
  expect(await page.locator('input[type="file"]').count()).toBe(0);
  await page.getByRole('link', { name: 'Try the demo', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Try the demo' }),
  ).toBeVisible();
});

test('W0 Trusted Types rejects unlisted executable URLs and HTML strings', async ({
  page,
}) => {
  await waitForApp(page);
  const result = await page.evaluate(async () => {
    const element = document.createElement('div');
    let htmlBlocked = false;
    let workerBlocked = false;
    let registrationBlocked = false;
    try {
      element.innerHTML = '<img src="invented">';
    } catch {
      htmlBlocked = true;
    }
    try {
      new Worker('/socialprune/invented.js');
    } catch {
      workerBlocked = true;
    }
    try {
      await navigator.serviceWorker.register('/socialprune/invented.js');
    } catch {
      registrationBlocked = true;
    }
    return { htmlBlocked, workerBlocked, registrationBlocked };
  });
  expect(result).toEqual({
    htmlBlocked: true,
    workerBlocked: true,
    registrationBlocked: true,
  });
});

test('W0 production does not serve or allow the test probe entry', async ({
  page,
  request,
}) => {
  await waitForApp(page);
  const probe = await request.get('/socialprune/probe-worker.js');
  expect(probe.status()).toBe(404);
  const metadata = await (
    await request.get('/socialprune/build-info.js')
  ).text();
  expect(metadata).not.toContain('probe-worker');
  const serviceWorker = await (await request.get('/socialprune/sw.js')).text();
  expect(serviceWorker).not.toContain('probe-worker');
  expect(serviceWorker).not.toContain('socialprune-test');
});

test('W0 missing ServiceWorker API leaves real-data controls absent', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let prototype: object | null = navigator;
    while (prototype) {
      if (Object.hasOwn(prototype, 'serviceWorker'))
        Reflect.deleteProperty(prototype, 'serviceWorker');
      prototype = Object.getPrototypeOf(prototype) as object | null;
    }
  });
  await page.goto('/socialprune/#/import');
  await expect(page.locator('main[data-gate]')).toHaveAttribute(
    'data-gate',
    'unavailable',
  );
  expect(await page.locator('input[type="file"]').count()).toBe(0);
});

test('W0 browser rejects generated Deflate64 with a named diagnostic, without WASM', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await waitForApp(page);
  await page.getByTestId('archives').setInputFiles({
    name: 'invented-method9.zip',
    mimeType: 'application/zip',
    buffer: method9Zip(),
  });
  await page.getByTestId('import-button').click();
  await expect(page.getByTestId('import-state')).toHaveAttribute(
    'data-phase',
    'complete',
  );
  const result = await page.evaluate(() =>
    window.socialprune.getImportSnapshot(),
  );
  expect(result.summary?.status).toBe('partial');
  expect(await workspaceIds(page)).toEqual([]);
  expect(
    result.summary?.records.flatMap(({ diagnostics }) => diagnostics),
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        category: 'unsupported-compression',
        status: 'unreadable',
        count: 1,
      }),
    ]),
  );
  await audit.assert();
});

test('W0 settled real worker imports a fixture without calling WebAssembly', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await waitForApp(page);
  const worker = page
    .workers()
    .find((worker) => /\/worker-/.test(worker.url()));
  if (!worker) throw new Error('Missing settled import worker.');
  // Inspector evaluation is awaited after the worker gate, not dispatched
  // asynchronously against every just-created worker during its startup.
  await worker.evaluate(() => {
    Reflect.set(globalThis, '__wasmCalls', 0);
    for (const name of ['compile', 'instantiate'] as const) {
      const original = Reflect.get(WebAssembly, name) as (
        ...args: unknown[]
      ) => unknown;
      Reflect.set(WebAssembly, name, (...args: unknown[]) => {
        Reflect.set(
          globalThis,
          '__wasmCalls',
          (Reflect.get(globalThis, '__wasmCalls') as number) + 1,
        );
        return Reflect.apply<typeof WebAssembly, unknown[], unknown>(
          original,
          WebAssembly,
          args,
        );
      });
    }
  });
  const fixture = await fixtureZips('x', 'deleted-tweets');
  try {
    await importFiles(page, fixture.files);
    expect(await workspaceIds(page)).toEqual(
      fixture.expected.items.map(({ id }) => id).sort(),
    );
    expect(
      await worker.evaluate(
        () => Reflect.get(globalThis, '__wasmCalls') as number,
      ),
    ).toBe(0);
    await audit.assert();
  } finally {
    await fixture.cleanup();
  }
});

test('W0 pre-control demo workers are terminated before real export input is enabled', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = Worker;
    const events: { url: string; kind: string }[] = [];
    Reflect.set(globalThis, '__workerLife', events);
    globalThis.Worker = class extends Original {
      private readonly address: string;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.address = String(url);
        events.push({ url: this.address, kind: 'created' });
      }
      override terminate() {
        events.push({ url: this.address, kind: 'terminated' });
        super.terminate();
      }
    };
  });
  await page.goto('/socialprune/#/demo');
  await expect(page.locator('main[data-gate]')).toHaveAttribute(
    'data-gate',
    'ready',
  );
  await expect
    .poll(() => page.workers().some((worker) => /\/worker-/.test(worker.url())))
    .toBe(true);
  const events = await page.evaluate(
    () =>
      Reflect.get(globalThis, '__workerLife') as {
        url: string;
        kind: string;
      }[],
  );
  const demoCreated = events.findIndex(
    ({ url, kind }) => /demo-worker-/.test(url) && kind === 'created',
  );
  const demoStopped = events.findIndex(
    ({ url, kind }) => /demo-worker-/.test(url) && kind === 'terminated',
  );
  const importCreated = events.findIndex(
    ({ url, kind }) => /\/worker-/.test(url) && kind === 'created',
  );
  expect(demoCreated).toBeGreaterThanOrEqual(0);
  expect(demoStopped).toBeGreaterThan(demoCreated);
  expect(importCreated).toBeGreaterThan(demoStopped);
  await page.goto('/socialprune/#/import');
  await expect(page.getByTestId('archives')).toBeEnabled();
  const fixture = await fixtureZips('x', 'current-minimal');
  try {
    await importFiles(page, fixture.files);
    expect(await workspaceIds(page)).toEqual(
      fixture.expected.items.map(({ id }) => id).sort(),
    );
    const workerURL = page
      .workers()
      .find((worker) => /\/worker-/.test(worker.url()))
      ?.url();
    if (!workerURL) throw new Error('Post-demo verified import worker absent.');
    const response = await page.goto(workerURL);
    expect(response?.fromServiceWorker()).toBe(true);
    expect(response?.headers()['content-security-policy']).toBe(
      DATA_WORKER_POLICY,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('W0 empty unverified guide and in-place locale switching make no external requests', async ({
  page,
  context,
}) => {
  const audit = await observeImport(context, page);
  await waitForApp(page);
  await page
    .getByRole('link', { name: 'Get your export', exact: true })
    .click();
  await expect(page.locator('[data-guide-count]')).toHaveAttribute(
    'data-guide-count',
    '0',
  );
  await expect(
    page.getByRole('heading', { name: 'Not yet verified' }),
  ).toBeVisible();
  const document = await page.evaluate(() => performance.timeOrigin);
  const requests: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  await page.getByRole('combobox', { name: 'Language' }).selectOption('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(
    page.getByRole('heading', { name: 'Noch nicht geprüft' }),
  ).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(document);
  expect(requests).toEqual([]);
  await audit.assert();
});
