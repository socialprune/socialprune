import type { Page } from 'playwright-core';
import type { EventEmitter } from 'node:events';
import { IG_FIXTURE } from './fixture.ts';

/** Test-only event/error injection. Production never imports this entry. */
export function fakePageFailure(
  page: Page,
  kind: 'crash' | 'closed' | 'generic',
) {
  class TargetClosedError extends Error {}
  class PageCrashedError extends Error {}
  const error =
    kind === 'crash'
      ? new PageCrashedError(IG_FIXTURE.other.text)
      : kind === 'closed'
        ? new TargetClosedError(IG_FIXTURE.other.text)
        : new Error(IG_FIXTURE.other.text);
  const events = page as unknown as EventEmitter;
  if (kind === 'crash') events.emit('crash', page);
  if (kind === 'closed') events.emit('close', page);
  return error;
}
