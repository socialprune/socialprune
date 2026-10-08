import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { deniedReviewServer } from './review-static-server.ts';
import { LOCAL_REVIEW_POLICY } from '../src/local-review/policy.ts';
import en from '../src/i18n/en.json' with { type: 'json' };
import { readFile } from 'node:fs/promises';
import { assertBuildIdentity, readBuildId } from '../tooling/build-identity.ts';

const test = base.extend<{
  server: Awaited<ReturnType<typeof deniedReviewServer>>;
}>({
  server: async ({}, use) => {
    const server = await deniedReviewServer();
    try {
      const response = await fetch(`${server.origin}/build-info.js`);
      expect(response.status).toBe(200);
      assertBuildIdentity(
        readBuildId(
          await readFile(
            new URL('../dist-review/build-info.js', import.meta.url),
            'utf8',
          ),
        ),
        readBuildId(await response.text()),
        server.origin,
      );
      await use(server);
    } finally {
      await server.close();
    }
  },
});

async function observe(context: BrowserContext, page: Page, origin: string) {
  const requests: string[] = [],
    errors: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const trace: { kind: string; hash: string }[] = [];
    const violations: string[] = [];
    Reflect.set(globalThis, '__reviewTrace', trace);
    Reflect.set(globalThis, '__reviewPolicy', violations);
    document.addEventListener('securitypolicyviolation', (event) =>
      violations.push(event.effectiveDirective),
    );
    const replace = history.replaceState.bind(history);
    history.replaceState = (...args) => {
      replace(...args);
      trace.push({ kind: 'removed', hash: location.hash });
    };
    new MutationObserver(() => {
      if (
        document.querySelector('[data-router-started]') &&
        !trace.some(({ kind }) => kind === 'router')
      )
        trace.push({ kind: 'router', hash: location.hash });
    }).observe(document, { childList: true, subtree: true });
  });
  return {
    requests,
    async assert() {
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.filter((url) => new URL(url).origin !== origin)).toEqual(
        [],
      );
      expect(
        requests.filter((url) => new URL(url).pathname.startsWith('/api/')),
      ).toEqual([]);
      expect(errors).toEqual([]);
      expect(
        await page.evaluate(
          () => Reflect.get(globalThis, '__reviewPolicy') as string[],
        ),
      ).toEqual([]);
      expect(
        await page.evaluate(async () =>
          (await navigator.serviceWorker.getRegistrations()).map(
            ({ scope }) => scope,
          ),
        ),
      ).toEqual([]);
      expect(page.workers()).toEqual([]);
      expect(
        await page
          .locator('[data-router-started], [role="grid"], input[type="file"]')
          .count(),
      ).toBe(0);
      expect(await page.evaluate(() => typeof window.workspace)).toBe(
        'undefined',
      );
    },
  };
}

test('missing fragment ends the session without workspace requests or service workers', async ({
  page,
  context,
  server,
}) => {
  const audit = await observe(context, page, server.origin);
  const response = await page.goto(server.origin);
  expect(response?.headers()['content-security-policy']).toBe(
    LOCAL_REVIEW_POLICY,
  );
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  expect(response?.headers()['cache-control']).toBe('no-store');
  expect(response?.headers()['x-content-type-options']).toBe('nosniff');
  await expect(
    page.getByRole('heading', { name: en['localReview.endedTitle'] }),
  ).toBeVisible();
  expect(server.exchanges).toEqual([]);
  expect(
    audit.requests.filter((url) => new URL(url).pathname === '/session'),
  ).toEqual([]);
  await audit.assert();
});

test('valid-looking fragment is removed before routing and exchanged in a header, then 401 ends the session', async ({
  page,
  context,
  server,
}) => {
  const token = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn_-0';
  const audit = await observe(context, page, server.origin);
  await page.goto(`${server.origin}/#bootstrap=${token}`);
  await expect(
    page.getByRole('heading', { name: en['localReview.endedTitle'] }),
  ).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('');
  expect(
    await page.evaluate(
      () => Reflect.get(globalThis, '__reviewTrace') as unknown,
    ),
  ).toEqual([{ kind: 'removed', hash: '' }]);
  expect(server.exchanges).toEqual([
    { token, origin: server.origin, method: 'POST', body: '{}' },
  ]);
  const sessionRequest = audit.requests.filter(
    (url) => new URL(url).pathname === '/session',
  );
  expect(sessionRequest).toHaveLength(1);
  expect(audit.requests.some((url) => url.includes(token))).toBe(false);
  await audit.assert();
});

test('the page violation observer catches a deliberate blocked connection', async ({
  page,
  context,
  server,
}) => {
  const audit = await observe(context, page, server.origin);
  await page.goto(server.origin);
  await expect(
    page.getByRole('heading', { name: en['localReview.endedTitle'] }),
  ).toBeVisible();
  await audit.assert();
  const rejected = await page.evaluate(async () => {
    try {
      await fetch('https://review-observer.invalid/planted');
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => [
        ...new Set(Reflect.get(globalThis, '__reviewPolicy') as string[]),
      ]),
    )
    .toEqual(['connect-src']);
});
