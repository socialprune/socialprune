import type { BrowserContext, Page } from 'playwright-core';
import { ContextStop } from './report.ts';
import { z } from 'zod';

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
      if (atStartup) counts.startupClosed++;
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
      const confirmation = await this.newPage();
      startup = false;
      for (const page of initial) await reject(page, true);
      await Promise.all([...closing.values()]);
      startup = false;
      return confirmation;
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
    allowed: classify,
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
