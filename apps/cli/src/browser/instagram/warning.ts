import type { BrowserRun } from '@socialprune/core';
import { ContextStop } from './report.ts';
import { InstagramDeleteStop } from './delete-driver.ts';

export function instagramWarningKind(
  error: unknown,
): NonNullable<BrowserRun['instagramWarning']>['kind'] | undefined {
  if (error instanceof InstagramDeleteStop && error.detail === 'limit-notice')
    return 'limit-notice';
  if (!(error instanceof ContextStop)) return undefined;
  if (
    error.code === 'STEP_DEADLINE' ||
    error.token === 'step-deadline' ||
    error.code === 'RUN_WAIT_DEADLINE' ||
    error.token === 'run-wait-deadline' ||
    error.code === 'TAB_INVENTORY' ||
    error.code === 'LIST_TIMEOUT' ||
    error.token === 'list-timeout' ||
    error.token === 'tab-inventory' ||
    error.token === 'non-owned-tab'
  )
    return undefined;
  if (error.token === 'http-429') return 'http-429';
  if (error.token === 'rate-limit') return 'limit-notice';
  if (error.token === 'locked') return 'warning-notice';
  return error.warningKind;
}
