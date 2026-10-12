import type { BrowserContext, Page } from 'playwright-core';
import { CliError } from '../../cli/errors.ts';
import type { BrowserRequest } from '../../workspace/browser-journal.ts';
import { xSelectors } from './selectors.ts';

export const X_ORIGIN = 'https://x.com';
export const X_ALLOWED_HOSTS = Object.freeze([
  'x.com',
  'api.x.com',
  'abs.twimg.com',
  'pbs.twimg.com',
  'video.twimg.com',
]);
export function statusUrl(id: string, origin = X_ORIGIN): string {
  if (!/^\d+$/.test(id)) throw new CliError('PLATFORM_CHECK');
  return `${origin}/i/web/status/${id}`;
}
export function bodyShape(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value))
    return [
      ...new Set(value.flatMap((entry) => bodyShape(entry, prefix + '[]'))),
    ].sort();
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value)
    .flatMap(([key, entry]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return [path, ...bodyShape(entry, path)];
    })
    .sort();
}
export interface BrowserDriver {
  showConfirmation(url: string): Promise<void>;
  account(): Promise<string>;
  inspect(id: string): Promise<'present' | 'gone'>;
  delete(
    id: string,
    action: 'delete-post' | 'undo-repost',
  ): Promise<{
    state: 'deleted' | 'failed' | 'ambiguous';
    code: string | null;
    receipt?: { method: string; path: string; status: number; shape: string[] };
  }>;
  flush(): Promise<void>;
  close(): Promise<void>;
}
export async function pageDriver(options: {
  context: BrowserContext;
  origin: string;
  allowedOrigins: readonly string[];
  confirmationOrigin: string;
  responseTimeoutMs: number;
  signal?: AbortSignal;
  record(request: BrowserRequest): Promise<void>;
}): Promise<BrowserDriver> {
  const context = options.context;
  const local = context.pages()[0] ?? (await context.newPage());
  let platform: Page | undefined;
  let prohibited = false;
  const pending = new Set<Promise<void>>();
  const requestIds = new WeakMap<object, BrowserRequest>();
  await context.routeWebSocket('**/*', async (socket) => {
    const url = new URL(socket.url());
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    if (!options.allowedOrigins.includes(url.origin)) {
      prohibited = true;
      await socket.close();
    } else socket.connectToServer();
  });
  const observe = (task: Promise<void>) => {
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => {
        prohibited = true;
        pending.delete(task);
      },
    );
  };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      options.signal?.aborted &&
      url.origin !== options.confirmationOrigin &&
      request.method() !== 'GET'
    ) {
      await route.abort();
      return;
    }
    if (
      url.origin !== options.confirmationOrigin &&
      !options.allowedOrigins.includes(url.origin)
    ) {
      prohibited = true;
      await route.abort('blockedbyclient');
      return;
    }
    if (
      url.origin !== options.confirmationOrigin &&
      request.method() !== 'GET'
    ) {
      const record = {
        requestId: crypto.randomUUID(),
        method: request.method(),
        host: url.host,
        path: url.pathname,
        status: null,
      };
      requestIds.set(request, record);
      try {
        await options.record(record);
      } catch {
        prohibited = true;
        await route.abort();
        return;
      }
    }
    await route.continue();
  });
  context.on('response', (response) => {
    const record = requestIds.get(response.request());
    if (record)
      observe(options.record({ ...record, status: response.status() }));
  });
  const guard = (checkStop = true) => {
    if (checkStop && options.signal?.aborted) throw new CliError('CANCELLED');
    if (prohibited || platform?.isClosed())
      throw new CliError('PLATFORM_CHECK');
  };
  const page = async (checkStop = true) => {
    if (!platform) platform = await context.newPage();
    guard(checkStop);
    return platform;
  };
  return {
    async showConfirmation(url) {
      await local.goto(url);
    },
    async account() {
      const current = await page(false);
      if (current.url() === 'about:blank')
        await current.goto(`${options.origin}/home`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
      guard(false);
      return xSelectors.account(current);
    },
    async inspect(id) {
      const current = await page();
      try {
        await current.goto(statusUrl(id, options.origin), {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
      } catch {
        throw new CliError('PLATFORM_CHECK');
      }
      guard();
      if (
        new URL(current.url()).origin !== options.origin ||
        !new URL(current.url()).pathname.endsWith(`/status/${id}`)
      )
        throw new CliError('PLATFORM_CHECK');
      return xSelectors.state(current, id);
    },
    async delete(id, action) {
      guard();
      const current = await page();
      if ((await xSelectors.state(current, id)) !== 'present')
        throw new CliError('PLATFORM_CHECK');
      if (action === 'delete-post') {
        await (await xSelectors.more(current)).click();
        guard();
        await (await xSelectors.deleteMenu(current)).click();
      } else await (await xSelectors.repost(current)).click();
      const final =
        action === 'delete-post'
          ? await xSelectors.confirm(current)
          : await xSelectors.undoRepost(current);
      const operation =
        action === 'delete-post' ? 'DeleteTweet' : 'DeleteRetweet';
      const response = current
        .waitForResponse(
          (response) => {
            const url = new URL(response.url());
            return (
              url.origin === options.origin &&
              url.pathname.split('/').at(-1) === operation &&
              url.pathname.includes('/graphql/') &&
              response.request().method() === 'POST'
            );
          },
          { timeout: options.responseTimeoutMs },
        )
        .catch(() => null);
      const startingUrl = current.url();
      guard();
      try {
        await final.click({ timeout: options.responseTimeoutMs });
      } catch {
        await response;
        return { state: 'ambiguous', code: 'CLICK_INTERRUPTED' };
      }
      const answer = await response;
      if (!answer || current.isClosed() || current.url() !== startingUrl)
        return { state: 'ambiguous', code: 'RESPONSE_UNKNOWN' };
      const receipt = {
        method: answer.request().method(),
        path: new URL(answer.url()).pathname,
        status: answer.status(),
        shape: [] as string[],
      };
      let body: unknown;
      try {
        body = await answer.json();
      } catch {
        return { state: 'failed', code: 'INVALID_RESPONSE', receipt };
      }
      receipt.shape = bodyShape(body);
      if (
        answer.status() !== 200 ||
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        !('data' in body) ||
        'errors' in body
      )
        return { state: 'failed', code: 'PLATFORM_RESPONSE', receipt };
      try {
        await current
          .getByTestId('toast')
          .waitFor({ state: 'visible', timeout: options.responseTimeoutMs });
        guard();
        if (!(await xSelectors.confirmation(current, action)))
          return { state: 'failed', code: 'CONFIRMATION_MISSING', receipt };
      } catch (error) {
        if (error instanceof CliError) throw error;
        return { state: 'failed', code: 'CONFIRMATION_MISSING', receipt };
      }
      return { state: 'deleted', code: null, receipt };
    },
    async flush() {
      await Promise.all([...pending]);
      guard(false);
    },
    async close() {
      await context.close();
    },
  };
}

export async function productionDriver(options: {
  profile: string;
  executablePath: string;
  signal?: AbortSignal;
  onClosed?(): void;
  confirmationOrigin: string;
  record(request: BrowserRequest): Promise<void>;
}): Promise<BrowserDriver> {
  const { chromium } = await import('playwright-core');
  const context = await chromium.launchPersistentContext(options.profile, {
    executablePath: options.executablePath,
    headless: false,
    // Keep the browser sandbox on and every Playwright automation sign visible.
    chromiumSandbox: true,
    args: ['--enable-automation'],
    serviceWorkers: 'block',
    ignoreDefaultArgs: ['--disable-extensions', '--disable-infobars'],
  });
  context.once('close', () => options.onClosed?.());
  const driver = await pageDriver({
    context,
    origin: X_ORIGIN,
    allowedOrigins: X_ALLOWED_HOSTS.map((host) => `https://${host}`),
    confirmationOrigin: options.confirmationOrigin,
    responseTimeoutMs: 30_000,
    signal: options.signal,
    record: (request) => options.record(request),
  });
  return {
    ...driver,
    async close() {
      // Keep the visible platform page for the person's inspection. No more
      // clicks, server or workspace access occur while waiting for that close.
      if (context.pages().length)
        await new Promise<void>((resolve) =>
          context.once('close', () => resolve()),
        );
    },
  };
}
