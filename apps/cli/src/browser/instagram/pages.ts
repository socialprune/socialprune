import type { BrowserContext, Page } from 'playwright-core';
import { ContextStop } from './report.ts';

/** Only the confirmation and explicitly created reading page belong to a run. */
export function contextPages(
  context: BrowserContext,
  onStop: (error: ContextStop) => void,
) {
  const initial = context.pages(),
    owned = new Set<Page>();
  const counts = { startupClosed: 0, unexpectedOpened: 0 };
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
  const reject = (page: Page): Promise<void> => {
    const prior = closing.get(page);
    if (prior) return prior;
    const atStartup = startup;
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
    async newPage(): Promise<Page> {
      if (creating) throw new Error('CONTEXT_PAGE_CREATION_BUSY');
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
        const page = await context.newPage();
        owned.add(page);
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
      const confirmation = await this.newPage();
      for (const page of initial) await reject(page);
      await Promise.all([...closing.values()]);
      startup = false;
      return confirmation;
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
