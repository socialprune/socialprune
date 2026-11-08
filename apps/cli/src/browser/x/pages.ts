import type { BrowserContext } from 'playwright-core';
import { CliError } from '../../cli/errors.ts';
import { contextPages } from '../instagram/pages.ts';
import { ContextStop } from '../instagram/report.ts';

/**
 * The Instagram runs' page discipline for the X runs: owned pages are created
 * in the background in the run window, tabs inherited at launch are closed,
 * and a page or tab outside the run stops the run. X keeps its own errors, so
 * every such stop is TAB_INVENTORY: never a platform check, never a warning.
 */
export function xRunPages(context: BrowserContext) {
  const pages = contextPages(context, () => {});
  const wrap = async <T>(task: () => Promise<T>): Promise<T> => {
    try {
      return await task();
    } catch (error) {
      throw xPageError(error);
    }
  };
  return {
    snapshot: () => pages.snapshot(),
    startupPage: () => wrap(() => pages.startupPage()),
    newPage: () => wrap(() => pages.newPage()),
    assertTabs: () => wrap(() => pages.assertTabs()),
    flush: () => wrap(() => pages.flush()),
    check() {
      try {
        pages.check();
      } catch (error) {
        throw xPageError(error);
      }
    },
    dispose: () => pages.dispose(),
  };
}
export type XRunPages = ReturnType<typeof xRunPages>;
export function xPageError(error: unknown): unknown {
  return error instanceof ContextStop ? new CliError('TAB_INVENTORY') : error;
}
