/**
 * Closed per-click failure classes for the one bounded click on the focal
 * comment's own reply control. They come only from Playwright's own call-log
 * phrases, which are fixed strings of the driver; no page text, selector or
 * element preview ever leaves this module.
 */
export const REPLY_CLICK_FAILURES = [
  'none',
  'not-resolved',
  'navigation-pending',
  'actionability-unsettled',
  'not-visible',
  'not-enabled',
  'not-stable',
  'outside-viewport',
  'scroll-unsettled',
  'intercepted',
  'detached',
  'timeout-before-dispatch',
  'dispatch-unacknowledged',
  'other-error',
] as const;
export type ReplyClickFailure = (typeof REPLY_CLICK_FAILURES)[number];

const MAX_LOG_LINES = 400;

/** The last driver phase the click reached before its bound ended. */
export function replyClickFailure(error: unknown): {
  failure: Exclude<ReplyClickFailure, 'none'>;
  attempts: number;
  timedOut: boolean;
} {
  let name = '',
    message = '';
  try {
    if (error instanceof Error) {
      name = typeof error.name === 'string' ? error.name : '';
      message = typeof error.message === 'string' ? error.message : '';
    }
  } catch {
    // An unreadable error stays an unclassified error.
  }
  const timedOut = name === 'TimeoutError';
  // The driver dims each call-log line with terminal colour codes.
  const log = message.replace(/\u001b\[[0-9;]*m/gu, '').split(/\r?\n/u);
  const start = log.findIndex((line) => line.trim() === 'Call log:');
  const lines = (
    start < 0 ? [] : log.slice(start + 1, start + 1 + MAX_LOG_LINES)
  )
    // A repeated phase is printed as "2 × <phase>"; only the phase counts.
    .map((line) =>
      line
        .trim()
        .replace(/^- /u, '')
        .replace(/^\d+ \u00d7 /u, ''),
    );
  let attempts = 0,
    resolved = false;
  let phase: Exclude<ReplyClickFailure, 'none'> | undefined;
  for (const line of lines) {
    if (line.startsWith('locator resolved to ')) {
      resolved = true;
      phase ??= 'timeout-before-dispatch';
    } else if (
      line === 'attempting click action' ||
      line === 'retrying click action'
    ) {
      // A retry keeps the last verdict until a later phase replaces it.
      attempts++;
      resolved = true;
      phase ??= 'timeout-before-dispatch';
    } else if (
      line.startsWith('waiting for') &&
      line.endsWith('navigation to finish...')
    )
      phase = 'navigation-pending';
    else if (line === 'waiting for element to be visible, enabled and stable')
      phase = 'actionability-unsettled';
    else if (line === 'element is visible, enabled and stable')
      phase = 'timeout-before-dispatch';
    else if (line === 'element is not visible') phase = 'not-visible';
    else if (line === 'element is not enabled') phase = 'not-enabled';
    else if (line === 'element is not stable') phase = 'not-stable';
    else if (line === 'element is outside of the viewport')
      phase = 'outside-viewport';
    else if (line === 'scrolling into view if needed')
      phase = 'scroll-unsettled';
    else if (line === 'done scrolling') phase = 'timeout-before-dispatch';
    else if (line.endsWith(' intercepts pointer events')) phase = 'intercepted';
    else if (
      line === 'element was detached from the DOM, retrying' ||
      line === 'element is not attached to the DOM'
    )
      phase = 'detached';
    else if (
      line === 'performing click action' ||
      line === 'click action done' ||
      line === 'waiting for scheduled navigations to finish'
    )
      phase = 'dispatch-unacknowledged';
  }
  if (!timedOut) {
    const body = message.replace(/^locator\.click: /u, '');
    return {
      failure:
        body.startsWith('Element is not attached to the DOM') ||
        body.startsWith('Element is detached from the DOM') ||
        body.startsWith('Element was detached from the DOM')
          ? 'detached'
          : 'other-error',
      attempts,
      timedOut,
    };
  }
  return {
    failure: !resolved ? 'not-resolved' : (phase ?? 'timeout-before-dispatch'),
    attempts: Math.min(attempts, 100),
    timedOut,
  };
}
