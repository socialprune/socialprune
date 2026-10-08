import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page, Response } from '@playwright/test';
import type { Workspace } from '@socialprune/core';
import type { Item } from '@socialprune/core';

const policy =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'none'; font-src 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types socialprune";
const demo = new URL('../../../fixtures/synthetic/demo/', import.meta.url);
interface Manifest {
  exports: {
    platform: string;
    directory: string;
    account: { key: string };
    itemCount: number;
  }[];
}
const manifest = JSON.parse(
  await readFile(new URL('manifest.json', demo), 'utf8'),
) as Manifest;
const expected = JSON.parse(
  await readFile(new URL('x/expected.json', demo), 'utf8'),
) as { items: Item[] };
const x = manifest.exports.find((entry) => entry.platform === 'x')!;
const first = [...expected.items].sort(
  (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
)[0]!;

async function reviewProcess() {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL('../src/review/test/browser-entry.ts', import.meta.url),
      ),
      ...manifest.exports.map((entry) =>
        fileURLToPath(new URL(entry.directory, demo)),
      ),
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  let stdout = '',
    stderr = '',
    cleanup = false;
  const opened = new Promise<string>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0)
        reject(new Error(`Review startup exit ${code}: ${stderr}`));
    });
    child.on('message', (raw: unknown) => {
      const message = raw as { type: string; url: string };
      if (message.type === 'opened') resolve(message.url);
    });
  });
  const snapshot = new Promise<Workspace>((resolve) => {
    child.on('message', (raw: unknown) => {
      const message = raw as { type: string; snapshot: Workspace };
      if (message.type === 'readback') resolve(message.snapshot);
      if (message.type === 'cleanup') cleanup = true;
    });
  });
  child.stdout!.on('data', (part: Buffer) => {
    stdout += part.toString();
  });
  child.stderr!.on('data', (part: Buffer) => {
    stderr += part.toString();
  });
  const closed = new Promise<number | null>((resolve) =>
    child.once('close', (code) => resolve(code)),
  );
  const url = await opened;
  return {
    url,
    origin: new URL(url).origin,
    async stop() {
      if (child.connected) child.send('stop');
      expect(await closed).toBe(0);
      expect(cleanup).toBe(true);
      const token = new URL(url).hash.slice('#bootstrap='.length);
      expect(stdout).not.toContain(token);
      expect(stderr).not.toContain(token);
      return snapshot;
    },
  };
}

const test = base.extend<{ review: Awaited<ReturnType<typeof reviewProcess>> }>(
  {
    review: async ({}, use) => {
      const server = await reviewProcess();
      try {
        await use(server);
      } finally {
        await server.stop();
      }
    },
  },
);

interface Trace {
  kind: string;
  hash: string;
  exchangeFinished?: boolean;
}
async function observe(context: BrowserContext, page: Page, origin: string) {
  const requests: string[] = [],
    allRequests: string[] = [],
    responses: Response[] = [],
    errors: string[] = [],
    workers: string[] = [];
  context.on('request', (request) => allRequests.push(request.url()));
  page.on('request', (request) => requests.push(request.url()));
  page.on('response', (response) => responses.push(response));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.addInitScript(() => {
    const trace: Trace[] = [],
      violations: string[] = [];
    Reflect.set(globalThis, '__c3Trace', trace);
    Reflect.set(globalThis, '__c3Violations', violations);
    Reflect.set(globalThis, '__c3WorkerCalls', []);
    Reflect.set(globalThis, '__c3ServiceCalls', []);
    document.addEventListener('securitypolicyviolation', (event) =>
      violations.push(event.effectiveDirective),
    );
    const NativeWorker = window.Worker;
    window.Worker = new Proxy(NativeWorker, {
      construct(target, args) {
        (Reflect.get(globalThis, '__c3WorkerCalls') as unknown[]).push(args[0]);
        return Reflect.construct(target, args) as Worker;
      },
    });
    const register = navigator.serviceWorker.register.bind(
      navigator.serviceWorker,
    );
    navigator.serviceWorker.register = (...args) => {
      (Reflect.get(globalThis, '__c3ServiceCalls') as unknown[]).push(args[0]);
      return register(...args);
    };
    const replace = history.replaceState.bind(history);
    history.replaceState = (...args) => {
      replace(...args);
      trace.push({ kind: 'removed', hash: location.hash });
    };
    // Observe a real DOM attribute write, without replacing a route or request.
    const nativeAttribute = Reflect.get<Element, 'setAttribute'>(
      Element.prototype,
      'setAttribute',
    );
    Element.prototype.setAttribute = new Proxy(nativeAttribute, {
      apply(target, receiver: Element, args: [string, string]) {
        if (args[0] === 'data-router-started')
          trace.push({
            kind: 'router',
            hash: location.hash,
            exchangeFinished: performance
              .getEntriesByName(location.origin + '/session')
              .some(
                (entry) => (entry as PerformanceResourceTiming).responseEnd > 0,
              ),
          });
        return Reflect.apply<Element, [string, string], void>(
          target,
          receiver,
          args,
        );
      },
    });
    new MutationObserver(() => {
      if (
        document.querySelector('[data-router-started]') &&
        !trace.some((entry) => entry.kind === 'mounted')
      )
        trace.push({ kind: 'mounted', hash: location.hash });
    }).observe(document, { childList: true, subtree: true });
  });
  function noViolations(values: string[]) {
    expect(values).toEqual([]);
  }
  return {
    requests,
    responses,
    errors,
    async assert(denied = false) {
      expect(requests.length).toBeGreaterThan(0);
      expect(
        allRequests.filter((url) => new URL(url).origin !== origin),
      ).toEqual([]);
      expect(errors).toEqual([]);
      noViolations(
        await page.evaluate(
          () => Reflect.get(globalThis, '__c3Violations') as string[],
        ),
      );
      expect(workers).toEqual([]);
      expect(
        await page.evaluate(
          () => Reflect.get(globalThis, '__c3WorkerCalls') as unknown,
        ),
      ).toEqual([]);
      expect(
        await page.evaluate(
          () => Reflect.get(globalThis, '__c3ServiceCalls') as unknown,
        ),
      ).toEqual([]);
      expect(
        await page.evaluate(async () =>
          (await navigator.serviceWorker.getRegistrations()).map(
            (entry) => entry.scope,
          ),
        ),
      ).toEqual([]);
      expect(page.workers()).toEqual([]);
      if (denied) {
        expect(
          responses.filter((response) =>
            new URL(response.url()).pathname.startsWith('/api/'),
          ),
        ).toEqual([]);
        expect(
          await page.locator('[data-router-started], [role="grid"]').count(),
        ).toBe(0);
      }
      const staticResponses = responses.filter((response) =>
        ['document', 'script', 'stylesheet'].includes(
          response.request().resourceType(),
        ),
      );
      expect(
        staticResponses.filter(
          (response) => response.request().resourceType() === 'document',
        ).length,
      ).toBeGreaterThan(0);
      expect(
        staticResponses.filter(
          (response) => response.request().resourceType() === 'script',
        ).length,
      ).toBeGreaterThan(0);
      expect(
        staticResponses.filter(
          (response) => response.request().resourceType() === 'stylesheet',
        ).length,
      ).toBeGreaterThan(0);
      for (const response of staticResponses) {
        const headers = await response.allHeaders();
        expect(headers['content-security-policy']).toBe(policy);
        expect(headers['x-content-type-options']).toBe('nosniff');
        expect(headers['referrer-policy']).toBe('no-referrer');
        expect(headers['cache-control']).toBe('no-store');
      }
    },
    noViolations,
  };
}

test('real session imports fixture rows, commits a UI decision, opens a click list, denies replay/missing, and ends on shutdown', async ({
  page,
  context,
  review,
}) => {
  // D40: the final Windows three-engine runs measured up to 10.7 s (Firefox).
  test.setTimeout(90_000);
  const audit = await observe(context, page, review.origin);
  const exchange = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/session',
  );
  await page.goto(review.url);
  const sessionResponse = await exchange;
  expect(sessionResponse.status()).toBe(200);
  expect((await sessionResponse.allHeaders())['set-cookie']).toMatch(
    /^sp_[a-f0-9]{16}=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/$/,
  );
  await expect(page.locator('[data-router-started]')).toBeVisible();
  const trace = await page.evaluate(
    () => Reflect.get(globalThis, '__c3Trace') as Trace[],
  );
  expect(trace[0]).toEqual({ kind: 'removed', hash: '' });
  expect(trace.find((entry) => entry.kind === 'router')).toEqual({
    kind: 'router',
    hash: '',
    exchangeFinished: true,
  });
  const sessionIndex = audit.responses.findIndex(
    (response) => new URL(response.url()).pathname === '/session',
  );
  expect(sessionIndex).toBeGreaterThanOrEqual(0);
  expect(
    audit.requests.filter((url) => new URL(url).pathname === '/session'),
  ).toHaveLength(1);
  const token = new URL(review.url).hash.slice('#bootstrap='.length);
  expect(audit.requests.some((url) => url.includes(token))).toBe(false);
  const cookies = await context.cookies(review.origin);
  expect(cookies).toHaveLength(1);
  expect(cookies[0]!.name).toMatch(/^sp_[a-f0-9]{16}$/);
  expect(cookies[0]).toMatchObject({
    httpOnly: true,
    path: '/',
    expires: -1,
  });
  expect(
    audit.responses
      .slice(0, sessionIndex)
      .some((response) => new URL(response.url()).pathname.startsWith('/api/')),
  ).toBe(false);
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Review', exact: true })
    .click();
  const grid = page.getByRole('grid', { name: 'Entries to review' });
  await expect(grid).toHaveAttribute('aria-rowcount', String(x.itemCount));
  expect(expected.items.length).toBe(x.itemCount);
  await expect(grid.getByRole('row').first()).toContainText(first.text);
  const committed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/decide',
  );
  await grid.focus();
  await grid.press('Home');
  await grid.press('m');
  expect((await committed).status()).toBe(200);
  await expect(page.getByTestId('save-state')).toHaveText(
    'Saved on this device',
  );
  const list = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/clickListWindow',
  );
  await page.getByRole('link', { name: 'X click list', exact: true }).click();
  expect((await list).status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'Click list', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(first.text, { exact: true })).toBeVisible();

  for (const [mode, url] of [
    ['replay', review.url],
    ['missing', review.origin + '/'],
  ] as const) {
    const denied = await context.newPage();
    const deniedAudit = await observe(context, denied, review.origin);
    try {
      await denied.goto(url);
      await expect(
        denied.getByRole('heading', { name: 'This review session has ended' }),
      ).toBeVisible();
      expect(
        deniedAudit.requests.filter((url) =>
          new URL(url).pathname.startsWith('/api/'),
        ),
      ).toEqual([]);
      if (mode === 'replay')
        expect(
          deniedAudit.responses
            .find((response) => new URL(response.url()).pathname === '/session')
            ?.status(),
        ).toBe(401);
      else
        expect(
          deniedAudit.requests.some(
            (url) => new URL(url).pathname === '/session',
          ),
        ).toBe(false);
      await deniedAudit.assert(true);
    } finally {
      await denied.close();
    }
  }
  await audit.assert();
  const next = page.waitForRequest((request) =>
    new URL(request.url()).pathname.startsWith('/api/'),
  );
  const snapshot = await review.stop();
  await page.bringToFront();
  await next;
  await expect(
    page.getByRole('heading', { name: 'This review session has ended' }),
  ).toBeVisible();
  expect(snapshot.decisionEvents).toEqual([
    expect.objectContaining({
      itemId: first.id,
      value: 'delete',
      source: { kind: 'human', via: 'local-review' },
    }),
  ]);
  expect(snapshot.outcomeEvents).toEqual([]);
  expect(snapshot.counts.items).toBe(
    manifest.exports.reduce((sum, entry) => sum + entry.itemCount, 0),
  );
  await audit.assert();
});

test('real CSP observer rejects a planted blocked connection without replacing fetch', async ({
  page,
  context,
  review,
}) => {
  // D40: the final Windows three-engine runs measured up to 2.7 s (Firefox).
  test.setTimeout(60_000);
  const audit = await observe(context, page, review.origin);
  await page.goto(review.origin);
  await expect(
    page.getByRole('heading', { name: 'This review session has ended' }),
  ).toBeVisible();
  await audit.assert(true);
  expect(
    await page.evaluate(async () => {
      try {
        await fetch('https://c3-observer.invalid/planted');
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => [
        ...new Set(Reflect.get(globalThis, '__c3Violations') as string[]),
      ]),
    )
    .toEqual(['connect-src']);
  expect(() => audit.noViolations(['connect-src'])).toThrow();
});
