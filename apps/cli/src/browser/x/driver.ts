import type { BrowserContext, Page } from 'playwright-core';
import { CliError } from '../../cli/errors.ts';
import type { BrowserRequest } from '../../workspace/browser-journal.ts';
import { xSelectors } from './selectors.ts';
import { restrictOrigins } from '../network.ts';
import { unexpectedAction } from './fill/read.ts';
import {
  launchRunBrowser,
  freshPlatformPage,
  waitForBrowserClose,
} from '../launch.ts';
import type { WindowPlacement } from '../launch.ts';
import { XResponseWindows } from './rate-windows.ts';

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
    stop?: CliError;
  }>;
  flush(): Promise<void>;
  close(): Promise<void>;
  abortedHosts?: Record<string, number>;
  rateWindows?: XResponseWindows;
  language?(): Promise<string>;
}
export async function pageDriver(options: {
  context: BrowserContext;
  origin: string;
  allowedOrigins: readonly string[];
  confirmationOrigin?: string;
  responseTimeoutMs: number;
  signal?: AbortSignal;
  record(request: BrowserRequest): Promise<void>;
  desktop?: boolean;
  now?: () => Date;
  onRateLimit?: () => void;
  onWindow?: (url: string, headers: Record<string, string>) => void;
}): Promise<BrowserDriver> {
  const context = options.context;
  // Keep the CLI confirmation page selection unchanged. Desktop launch tabs
  // remain untouched until all guards and request recording are installed.
  let local = options.desktop
    ? undefined
    : (context.pages()[0] ?? (await context.newPage()));
  let platform: Page | undefined;
  let prohibited = false;
  let mutation = false,
    expectedMutation: string | null = null;
  const pending = new Set<Promise<void>>();
  const requestIds = new WeakMap<object, BrowserRequest>();
  const abortedHosts: Record<string, number> = {};
  const rateWindows = new XResponseWindows(
    options.origin === X_ORIGIN ? undefined : options.origin,
  );
  let rateLimited = false;
  let projectionError: Error | undefined;
  let rejectRateLimit: (error: CliError) => void = () => {};
  const rateStop = new Promise<never>((_resolve, reject) => {
    rejectRateLimit = reject;
  });
  void rateStop.catch(() => undefined);
  const rateError = () =>
    new CliError('PLATFORM_CHECK', undefined, undefined, 'http-429');
  await restrictOrigins(
    context,
    [
      ...options.allowedOrigins,
      ...(options.confirmationOrigin ? [options.confirmationOrigin] : []),
    ],
    abortedHosts,
  );
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
      (options.signal?.aborted || rateLimited) &&
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
      await route.fallback();
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
      if (
        unexpectedAction(request.method(), request.url(), options.origin) &&
        url.pathname.split('/').at(-1) !== expectedMutation
      ) {
        mutation = true;
        await route.abort('blockedbyclient');
        return;
      }
    }
    await route.fallback();
  });
  context.on('response', (response) => {
    if (rateWindows.accepts(response.url())) {
      if (response.status() === 429) {
        rateLimited = true;
        rejectRateLimit(rateError());
        options.onRateLimit?.();
      }
      rateWindows.observe(
        response.url(),
        response.headers(),
        options.now?.().getTime() ?? Date.now(),
      );
      try {
        options.onWindow?.(response.url(), response.headers());
      } catch (error) {
        projectionError =
          error instanceof Error ? error : new CliError('RUN_STOPPED');
      }
    }
    const record = requestIds.get(response.request());
    if (record)
      observe(options.record({ ...record, status: response.status() }));
  });
  if (options.desktop) platform = local = await freshPlatformPage(context);
  const guard = (checkStop = true) => {
    if (rateLimited) throw rateError();
    if (projectionError) throw projectionError;
    if (checkStop && options.signal?.aborted) throw new CliError('CANCELLED');
    if (mutation) throw new CliError('UNEXPECTED_ACTION');
    if (prohibited || platform?.isClosed())
      throw new CliError('PLATFORM_CHECK');
  };
  const page = async (checkStop = true) => {
    if (!platform) platform = await context.newPage();
    guard(checkStop);
    return platform;
  };
  return {
    abortedHosts,
    rateWindows,
    async language() {
      return (await page(false))
        .locator('html')
        .getAttribute('lang')
        .then((value) => value ?? '');
    },
    async showConfirmation(url) {
      await local!.goto(url);
    },
    async account() {
      const current = await page(false);
      if (current.url() === 'about:blank')
        await current.goto(`${options.origin}/home`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
      guard(false);
      return Promise.race([
        xSelectors.account(
          current,
          Math.min(20_000, options.responseTimeoutMs),
        ),
        rateStop,
      ]);
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
      try {
        return await Promise.race([
          xSelectors.state(
            current,
            id,
            Math.min(20_000, options.responseTimeoutMs),
          ),
          rateStop,
        ]);
      } catch (error) {
        if (
          error instanceof CliError &&
          error.code === 'PLATFORM_CHECK' &&
          error.reason === 'render-timeout' &&
          (await current
            .locator('article[data-testid="tweet"] a[href*="/status/"] time')
            .count())
        )
          throw new CliError(
            'PLATFORM_CHECK',
            undefined,
            undefined,
            'focal-count',
          );
        throw error;
      }
    },
    async delete(id, action) {
      guard();
      const current = await page();
      if (
        (await xSelectors.state(
          current,
          id,
          Math.min(20_000, options.responseTimeoutMs),
        )) !== 'present'
      )
        throw new CliError('PLATFORM_CHECK');
      if (action === 'delete-post') {
        await (await xSelectors.more(current, id)).click();
        guard();
        await (await xSelectors.deleteMenu(current)).click();
      } else await (await xSelectors.repost(current, id)).click();
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
      if (
        rateWindows.beforeDeletion(options.now?.().getTime() ?? Date.now())
          .kind !== 'ready'
      )
        throw new CliError(
          'PLATFORM_CHECK',
          undefined,
          undefined,
          'marker-rate-limit',
        );
      expectedMutation = operation;
      let receipt:
        | { method: string; path: string; status: number; shape: string[] }
        | undefined;
      try {
        try {
          await Promise.race([
            final.click({ timeout: options.responseTimeoutMs }),
            rateStop,
          ]);
        } catch (error) {
          if (error instanceof CliError) throw error;
          await Promise.race([response, rateStop]);
          return { state: 'ambiguous', code: 'CLICK_INTERRUPTED' };
        }
        const answer = await Promise.race([response, rateStop]);
        if (!answer || current.isClosed() || current.url() !== startingUrl)
          return { state: 'ambiguous', code: 'RESPONSE_UNKNOWN' };
        receipt = {
          method: answer.request().method(),
          path: new URL(answer.url()).pathname,
          status: answer.status(),
          shape: [] as string[],
        };
        let body: unknown;
        try {
          body = await Promise.race([answer.json(), rateStop]);
        } catch {
          guard();
          return { state: 'ambiguous', code: 'INVALID_RESPONSE', receipt };
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
          return { state: 'ambiguous', code: 'PLATFORM_RESPONSE', receipt };
        try {
          await Promise.race([
            current.getByTestId('toast').waitFor({
              state: 'visible',
              timeout: options.responseTimeoutMs,
            }),
            rateStop,
          ]);
          guard();
          if (!(await xSelectors.confirmation(current, action)))
            return {
              state: 'ambiguous',
              code: 'CONFIRMATION_MISSING',
              receipt,
            };
        } catch (error) {
          if (error instanceof CliError) throw error;
          return { state: 'ambiguous', code: 'CONFIRMATION_MISSING', receipt };
        }
        return { state: 'deleted', code: null, receipt };
      } catch (error) {
        const stop =
          error instanceof CliError ? error : new CliError('RUN_STOPPED');
        return {
          state: 'ambiguous',
          code: stop.code,
          ...(receipt ? { receipt } : {}),
          stop,
        };
      } finally {
        expectedMutation = null;
      }
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
  confirmationOrigin?: string;
  onLaunched?(close: () => Promise<void>): void;
  record(request: BrowserRequest): Promise<void>;
  windowPlacement?: WindowPlacement;
  desktop?: boolean;
  now?: () => Date;
  onRateLimit?: () => void;
  onWindow?: (url: string, headers: Record<string, string>) => void;
}): Promise<BrowserDriver> {
  const context = await launchRunBrowser(
    options.profile,
    options.executablePath,
    options.windowPlacement,
  );
  options.onLaunched?.(() => context.close());
  context.once('close', () => options.onClosed?.());
  const driver = await pageDriver({
    context,
    origin: X_ORIGIN,
    allowedOrigins: X_ALLOWED_HOSTS.map((host) => `https://${host}`),
    confirmationOrigin: options.confirmationOrigin,
    responseTimeoutMs: 30_000,
    signal: options.signal,
    record: (request) => options.record(request),
    desktop: options.desktop,
    now: options.now,
    onRateLimit: options.onRateLimit,
    onWindow: options.onWindow,
  });
  return {
    ...driver,
    async close() {
      // Keep the visible platform page for the person's inspection. No more
      // clicks, server or workspace access occur while waiting for that close.
      await waitForBrowserClose(context);
    },
  };
}
