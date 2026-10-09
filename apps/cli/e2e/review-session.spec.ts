import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page, Response } from '@playwright/test';
import type { Workspace } from '@socialprune/core';
import type { Item } from '@socialprune/core';
import { foreignPage, browserSocketAudit } from './foreign-page.ts';

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
    stderr = '';
  const httpResponses: {
    method: string;
    path: string;
    status: number;
    headers: Record<string, string>;
  }[] = [];
  const opened = new Promise<string>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0)
        reject(new Error(`Review startup exit ${code}: ${stderr}`));
    });
    child.on('message', (raw: unknown) => {
      const message = raw as {
        type: string;
        url: string;
        method: string;
        path: string;
        status: number;
        headers: Record<string, string>;
      };
      if (message.type === 'opened') resolve(message.url);
      if (message.type === 'httpResponse') httpResponses.push(message);
    });
  });
  let snapshotReceived = false;
  const snapshot = new Promise<
    Workspace & { revision: number; initialRevision: number }
  >((resolve, reject) => {
    child.once('error', reject);
    child.once('close', () => {
      if (!snapshotReceived)
        reject(new Error('Review ended without its readback receipt.'));
    });
    child.on('message', (raw: unknown) => {
      const message = raw as {
        type: string;
        snapshot: Workspace & { revision: number; initialRevision: number };
      };
      if (message.type === 'readback') {
        snapshotReceived = true;
        resolve(message.snapshot);
      }
    });
  });
  let cleanupReceived = false;
  const cleanup = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', () => {
      if (!cleanupReceived)
        reject(new Error('Review ended without its cleanup receipt.'));
    });
    child.on('message', (raw: unknown) => {
      const message = raw as { type: string; readback: boolean };
      if (message.type === 'cleanup') {
        cleanupReceived = true;
        if (message.readback) resolve();
        else reject(new Error('Review cleanup did not complete a readback.'));
      }
    });
  });
  // Attach receipt handlers immediately; still propagate either failure at stop.
  const receipts = Promise.all([snapshot, cleanup]);
  void receipts.catch(() => undefined);
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
  let stopped:
    | Promise<Workspace & { revision: number; initialRevision: number }>
    | undefined;
  return {
    url,
    origin: new URL(url).origin,
    httpResponses,
    stop() {
      stopped ??= (async () => {
        if (child.connected)
          await new Promise<void>((resolve, reject) => {
            child.send('stop', (error) => (error ? reject(error) : resolve()));
          });
        const [readback] = await receipts;
        expect(await closed).toBe(0);
        expect(cleanupReceived).toBe(true);
        const token = new URL(url).hash.slice('#bootstrap='.length);
        expect(stdout).not.toContain(token);
        expect(stderr).not.toContain(token);
        return readback;
      })();
      return stopped;
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

test('a real foreign-origin page cannot exchange or write decisions', async ({
  page,
  context,
  review,
}) => {
  // D40: Windows three-engine focused run measured up to 3.5 s.
  test.setTimeout(60_000);
  const hostile = await foreignPage();
  const audit = browserSocketAudit(context, [hostile.origin, review.origin]);
  const targetResponses: Response[] = [];
  const violations: string[] = [];
  await context.exposeBinding(
    '__c3PolicyViolation',
    (_source, value: string) => {
      violations.push(value);
    },
  );
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = Reflect.get(globalThis, '__c3PolicyViolation') as (
        value: string,
      ) => Promise<void>;
      void report(event.effectiveDirective);
    });
  });
  context.on('response', (response) => {
    if (new URL(response.url()).origin === review.origin)
      targetResponses.push(response);
  });
  try {
    await page.goto(hostile.origin);
    const body = JSON.stringify({
      type: 'decide',
      requestId: 'foreign',
      commandId: 'foreign',
      itemIds: [first.id],
      expected: { [first.id]: 'undecided' },
      value: 'delete',
    });
    // Application/json causes a real preflight. No fetch/network substitution.
    expect(
      await page.evaluate(
        async ({ target, body }) => {
          try {
            await fetch(target + '/api/decide?attempt=preflight', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
            });
            return false;
          } catch {
            return true;
          }
        },
        { target: review.origin, body },
      ),
    ).toBe(true);
    const plainResponse = page.waitForResponse(
      (response) =>
        response.url() === review.origin + '/api/decide?attempt=plain',
    );
    await page.evaluate(
      async ({ target, body }) => {
        await fetch(target + '/api/decide?attempt=plain', {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body,
        });
      },
      { target: review.origin, body },
    );
    expect((await plainResponse).status()).toBe(403);
    for (const path of ['/session', '/api/decide']) {
      const formResponse = context.waitForEvent('response', {
        predicate: (response) =>
          response.url() === review.origin + path + '?attempt=form',
      });
      const formCommitted = page.waitForURL(
        review.origin + path + '?attempt=form',
        { waitUntil: 'commit' },
      );
      await page.evaluate(
        ({ target, path, body }) => {
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = target + path + '?attempt=form';
          const input = document.createElement('input');
          input.name = 'request';
          input.value = body;
          form.append(input);
          document.body.append(form);
          form.submit();
        },
        { target: review.origin, path, body },
      );
      expect((await formResponse).status()).toBe(403);
      await formCommitted;
      await page.goto(hostile.origin);
    }
    for (const response of targetResponses) {
      expect(response.status()).toBe(403);
      expect(
        Object.keys(await response.allHeaders()).filter((name) =>
          name.startsWith('access-control-'),
        ),
      ).toEqual([]);
    }
    expect(
      targetResponses.filter(
        (response) =>
          response.url().includes('attempt=plain') ||
          response.url().includes('attempt=form'),
      ),
    ).toHaveLength(3);
    const preflight = targetResponses.filter(
      (response) => response.request().method() === 'OPTIONS',
    );
    expect(preflight.every((response) => response.status() === 403)).toBe(true);
    // Some engines do not expose a CORS-rejected preflight as a Response event.
    expect(
      targetResponses.some(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes('attempt=preflight'),
      ),
    ).toBe(false);
    await expect
      .poll(
        () =>
          review.httpResponses.filter((response) =>
            response.path.includes('attempt='),
          ).length,
      )
      .toBe(4);
    const wire = review.httpResponses.filter((response) =>
      response.path.includes('attempt='),
    );
    expect(
      wire
        .filter((response) => response.path.includes('attempt=preflight'))
        .map((response) => [response.method, response.status]),
    ).toEqual([['OPTIONS', 403]]);
    for (const response of wire) {
      const responseHeaders = Object.fromEntries(
        Object.entries(response.headers).map(([name, value]) => [
          name.toLowerCase(),
          value,
        ]),
      );
      expect(response.status).toBe(403);
      expect(
        Object.keys(responseHeaders).filter((name) =>
          name.startsWith('access-control-'),
        ),
      ).toEqual([]);
      expect(responseHeaders['content-security-policy']).toBe(policy);
      expect(responseHeaders['x-content-type-options']).toBe('nosniff');
      expect(responseHeaders['referrer-policy']).toBe('no-referrer');
      expect(responseHeaders['cache-control']).toBe('no-store');
    }
    expect(
      audit.requests.filter(
        (url) => !audit.origins.includes(new URL(url).origin),
      ),
    ).toEqual([]);
    expect(violations).toEqual([]);
    const snapshot = await review.stop();
    expect(snapshot.decisionEvents).toEqual([]);
    expect(snapshot.outcomeEvents).toEqual([]);
    expect(snapshot.assessments).toEqual([]);
    expect(snapshot.counts.decisionEvents).toBe(0);
    expect(snapshot.counts.outcomeEvents).toBe(0);
    expect(snapshot.revision).toBe(snapshot.initialRevision);
  } finally {
    await hostile.stop();
  }
});

test('real browser navigation with localhost Host receives policy-bearing 403 and mounts nothing', async ({
  page,
  context,
  review,
}) => {
  // D40: Windows three-engine focused run measured up to 2.2 s.
  test.setTimeout(60_000);
  const url = new URL(review.origin);
  url.hostname = 'localhost';
  const audit = browserSocketAudit(context, [url.origin]);
  const response = await page.goto(url.origin, { waitUntil: 'commit' });
  expect(response!.status()).toBe(403);
  const headers = await response!.allHeaders();
  expect(headers['content-security-policy']).toBe(policy);
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['cache-control']).toBe('no-store');
  expect(
    Object.keys(headers).filter((name) => name.startsWith('access-control-')),
  ).toEqual([]);
  expect(
    await page.locator('[data-router-started], [role="grid"]').count(),
  ).toBe(0);
  expect(
    audit.requests.filter((value) => new URL(value).origin !== url.origin),
  ).toEqual([]);
  expect(
    audit.requests.some((value) => new URL(value).pathname.startsWith('/api/')),
  ).toBe(false);
  const snapshot = await review.stop();
  expect(snapshot.decisionEvents).toEqual([]);
  expect(snapshot.revision).toBe(snapshot.initialRevision);
});
