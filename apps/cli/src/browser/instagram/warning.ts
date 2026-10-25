import type { BrowserRun } from '@socialprune/core';
import { ContextStop } from './report.ts';
import { InstagramDeleteStop } from './delete-driver.ts';

export function instagramWarningKind(
  error: unknown,
): NonNullable<BrowserRun['instagramWarning']>['kind'] | undefined {
  if (error instanceof InstagramDeleteStop && error.detail === 'limit-notice')
    return 'limit-notice';
  if (!(error instanceof ContextStop)) return undefined;
  if (error.token === 'http-429') return 'http-429';
  if (error.token === 'rate-limit') return 'limit-notice';
  if (error.token === 'locked') return 'warning-notice';
  return error.warningKind;
}
