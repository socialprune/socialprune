import type { BrowserContext, Page } from 'playwright-core';
import { ContextStop } from './report.ts';
import { z } from 'zod';
import { createServer } from 'node:http';
import { auditBrowserTabs } from './browser-tabs.ts';

const target = z.object({
  targetInfo: z.object({ targetId: z.string().min(1) }),
});
const windowId = z.object({ windowId: z.number().int() });
export async function backgroundPage(context: BrowserContext): Promise<Page> {
  const anchor = context.pages().find((page) => !page.isClosed());
  if (!anchor) throw new ContextStop('PLATFORM_CHECK', 'unexpected-page');
  const client = await context.newCDPSession(anchor);
  let ready!: (id: string) => void;
  const createdId = new Promise<string>((resolve) => {
    ready = resolve;
  });
  const observed = context.waitForEvent('page', {
    timeout: 10000,
    predicate: async (page) => {
      const id = await createdId;
      const session = await context.newCDPSession(page);
      try {
        return (
          target.parse(await session.send('Target.getTargetInfo')).targetInfo
            .targetId === id
        );
      } finally {
        await session.detach();
      }
    },
  });
  void observed.catch(() => {});
  try {
    const anchorWindow = windowId.parse(
      await client.send('Browser.getWindowForTarget'),
    ).windowId;
    const anchorTarget = z
      .object({
        targetInfo: z.object({ browserContextId: z.string().optional() }),
      })
      .parse(await client.send('Target.getTargetInfo'));
    const { targetId } = z.object({ targetId: z.string().min(1) }).parse(
      await client.send('Target.createTarget', {
        url: 'about:blank',
        background: false,
        focus: false,
        newWindow: false,
        ...(anchorTarget.targetInfo.browserContextId
          ? { browserContextId: anchorTarget.targetInfo.browserContextId }
          : {}),
      }),
    );
    ready(targetId);
    const page = await observed;
    const createdWindow = windowId.parse(
      await client.send('Browser.getWindowForTarget', { targetId }),
    ).windowId;
    if (createdWindow !== anchorWindow) {
      await page.close({ runBeforeUnload: false });
      throw new ContextStop('PLATFORM_CHECK', 'unexpected-page');
    }
    return page;
  } finally {
    ready('creation-failed');
    await client.detach();
  }
}

export const ContextPagesSchema = z.strictObject({
  startupClosed: z.number().int().nonnegative(),
  unexpectedOpened: z.number().int().nonnegative(),
  pageLimit: z.literal(3),
  ownedOpen: z.number().int().min(0).max(3),
  ownedPeak: z.number().int().min(0).max(3),
  backgroundCreated: z.number().int().nonnegative(),
  replaced: z.number().int().nonnegative(),
  rendererResets: z.number().int().nonnegative(),
  targetClosed: z.strictObject({
    page: z.number().int().nonnegative(),
    tab: z.number().int().nonnegative(),
  }),
  targetChecks: z.number().int().nonnegative(),
  targetTabs: z.number().int().nonnegative(),
  remainingNonOwned: z.number().int().nonnegative().nullable(),
});

/** Requests no OS focus; exact returned Page identity controls run ownership. */
export function contextPages(
  context: BrowserContext,
  onStop: (error: ContextStop) => void,
  create: (context: BrowserContext) => Promise<Page> = backgroundPage,
) {
  const initial = context.pages(),
    owned = new Set<Page>();
  const counts = ContextPagesSchema.parse({
    startupClosed: 0,
    unexpectedOpened: 0,
    pageLimit: 3,
    ownedOpen: 0,
    ownedPeak: 0,
    backgroundCreated: 0,
    replaced: 0,
    rendererResets: 0,
    targetClosed: { page: 0, tab: 0 },
    targetChecks: 0,
    targetTabs: 0,
    remainingNonOwned: null,
  });
  const refresh = () => {
    for (const page of owned) if (page.isClosed()) owned.delete(page);
    counts.ownedOpen = owned.size;
    counts.ownedPeak = Math.max(counts.ownedPeak, owned.size);
  };
  const closing = new Map<Page, Promise<void>>();
  let startup = true,
    disposed = false;
  let creating: Promise<Page> | undefined;
  let failure: ContextStop | undefined;
  const fail = () => {
    if (!failure) {
      failure = new ContextStop('PLATFORM_CHECK', 'unexpected-page');
      onStop(failure);
    }
  };
  const reject = (page: Page, atStartup = startup): Promise<void> => {
    const prior = closing.get(page);
    if (prior) return prior;
    if (!atStartup) {
      counts.unexpectedOpened++;
      fail();
    }
    const task = (
      page.isClosed()
        ? Promise.resolve()
        : page.close({ runBeforeUnload: false })
    ).then(() => {
      if (atStartup) {
        counts.startupClosed++;
        counts.targetClosed.page++;
      }
    });
    closing.set(page, task);
    void task.catch(() => fail());
    return task;
  };
  const classify = async (page: Page) => {
    if (owned.has(page)) return true;
    const pending = creating;
    if (pending) {
      const created = await pending;
      if (created === page) return true;
    }
    await reject(page);
    return false;
  };
  const opened = (page: Page) => {
    if (!disposed) void classify(page).catch(() => fail());
  };
  context.on('page', opened);
  const audit = async (closeStartup: boolean) => {
    counts.remainingNonOwned = null;
    try {
      const state = await auditBrowserTabs(context, owned, closeStartup);
      counts.targetClosed.page += state.closed.page;
      counts.targetClosed.tab += state.closed.tab;
      counts.startupClosed += state.closed.page + state.closed.tab;
      counts.targetTabs = state.tabs;
      counts.remainingNonOwned = state.nonOwned;
      counts.targetChecks++;
      if (state.nonOwned !== 0 || state.tabs > counts.pageLimit) {
        failure ??= new ContextStop('PLATFORM_CHECK', 'non-owned-tab');
        onStop(failure);
        throw failure;
      }
    } catch (error) {
      failure ??=
        error instanceof ContextStop
          ? error
          : new ContextStop('PLATFORM_CHECK', 'tab-inventory');
      onStop(failure);
      throw failure;
    }
  };
  return {
    counts,
    snapshot() {
      refresh();
      return ContextPagesSchema.parse(counts);
    },
    async newPage(): Promise<Page> {
      if (creating) throw new Error('CONTEXT_PAGE_CREATION_BUSY');
      refresh();
      if (counts.ownedOpen >= counts.pageLimit) {
        fail();
        throw failure!;
      }
      let resolve!: (page: Page) => void,
        rejectCreation!: (error: unknown) => void;
      const pending = new Promise<Page>((yes, no) => {
        resolve = yes;
        rejectCreation = no;
      });
      void pending.catch(() => undefined);
      creating = pending;
      // The event and request gates compare the returned Page identity, not the
      // order in which the context emits pages during this creation window.
      try {
        const page = await create(context);
        owned.add(page);
        counts.backgroundCreated++;
        refresh();
        resolve(page);
        return page;
      } catch (error) {
        rejectCreation(error);
        throw error;
      } finally {
        creating = undefined;
      }
    },
    async startupPage(): Promise<Page> {
      // Even a launch tab still at about:blank may have a restore navigation
      // pending. Create our own page and close every page inherited at launch.
      for (const page of initial.slice(1)) await reject(page);
      const page = await this.newPage();
      for (const page of initial) await reject(page, true);
      await Promise.all([...closing.values()]);
      await audit(true);
      startup = false;
      return page;
    },
    async replace(page: Page): Promise<Page> {
      if (!owned.has(page)) throw new Error('CONTEXT_PAGE_NOT_OWNED');
      const next = await this.newPage();
      await page.close({ runBeforeUnload: false });
      owned.delete(page);
      counts.replaced++;
      refresh();
      return next;
    },
    async resetRenderer(page: Page, timeout: number): Promise<Page> {
      if (!owned.has(page)) throw new Error('CONTEXT_PAGE_NOT_OWNED');
      const server = createServer((request, response) => {
        if (
          request.method !== 'GET' ||
          request.url !== '/reader-reset' ||
          request.headers.host !== authority
        ) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy':
            "default-src 'none'; frame-ancestors 'none'",
          'X-Content-Type-Options': 'nosniff',
        });
        response.end('<!doctype html><title>SocialPrune</title>');
      });
      let authority = '';
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string')
        throw new Error('CONTEXT_RESET_LISTENER');
      authority = `localhost:${address.port}`;
      const url = `http://${authority}/reader-reset`;
      // This exact constant page is the only non-platform navigation admitted
      // here. Continue bypasses the context route only for this owned main frame.
      const route: Parameters<Page['route']>[1] = async (route) => {
        const request = route.request();
        if (
          owned.has(page) &&
          request.method() === 'GET' &&
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame()
        )
          await route.continue();
        else await route.abort();
      };
      try {
        await page.route(url, route);
        await page.goto(url, { waitUntil: 'load', timeout });
        const client = await context.newCDPSession(page);
        try {
          await client.send('Page.resetNavigationHistory');
        } finally {
          await client.detach();
        }
        counts.rendererResets++;
        return page;
      } finally {
        try {
          await page.unroute(url, route);
        } finally {
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      }
    },
    allowed: classify,
    async assertTabs() {
      if (failure) throw failure;
      await audit(false);
    },
    check() {
      if (failure) throw failure;
    },
    async flush() {
      await Promise.all([...closing.values()]);
      if (failure) throw failure;
    },
    dispose() {
      disposed = true;
      context.off('page', opened);
    },
  };
}
