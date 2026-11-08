import { expect, test } from 'vitest';
import { REPLY_CLICK_FAILURES, replyClickFailure } from './replies-click.ts';
import { ReplyExpansionDiagnosticSchema } from './report.ts';

function timeout(...log: string[]) {
  const error = new Error(
    [
      'locator.click: Timeout 1000ms exceeded.',
      'Call log:',
      '  - waiting for locator(\'main a[href="/p/Generated/c/1/"]\')',
      ...log,
    ].join('\n'),
  );
  error.name = 'TimeoutError';
  return error;
}
const resolved =
  '  - locator resolved to <div role="button">View all 4 replies</div>';

test.each([
  [[], 'not-resolved'],
  [[resolved], 'timeout-before-dispatch'],
  [
    [
      resolved,
      '  - waiting for "https://generated.invalid/p/x/" navigation to finish...',
    ],
    'navigation-pending',
  ],
  [
    [
      resolved,
      '  - attempting click action',
      '    - waiting for element to be visible, enabled and stable',
    ],
    'actionability-unsettled',
  ],
  [
    [
      resolved,
      '  - attempting click action',
      '    2 × waiting for element to be visible, enabled and stable',
      '      - element is not stable',
      '    - retrying click action',
      '      - waiting 20ms',
      '    - waiting for element to be visible, enabled and stable',
      '    - element is not stable',
    ],
    'not-stable',
  ],
  [
    [
      resolved,
      '  - attempting click action',
      '    - waiting for element to be visible, enabled and stable',
      '    - element is not visible',
    ],
    'not-visible',
  ],
  [
    [
      resolved,
      '  - attempting click action',
      '    - waiting for element to be visible, enabled and stable',
      '    - element is not enabled',
    ],
    'not-enabled',
  ],
  [
    [
      resolved,
      '  - attempting click action',
      '    - element is visible, enabled and stable',
      '    - scrolling into view if needed',
    ],
    'scroll-unsettled',
  ],
  [
    [
      resolved,
      '  - attempting click action',
      '    - element is visible, enabled and stable',
      '    - scrolling into view if needed',
      '    - done scrolling',
      '    - element is outside of the viewport',
    ],
    'outside-viewport',
  ],
  [
    [
      resolved,
      '  - attempting click action',
      '    - element is visible, enabled and stable',
      '    - scrolling into view if needed',
      '    - done scrolling',
      '    - <div style="position:fixed">Generated secret overlay</div> intercepts pointer events',
      '  - retrying click action',
      '    - waiting 20ms',
    ],
    'intercepted',
  ],
  [
    [
      resolved,
      '  - attempting click action',
      '    - element is visible, enabled and stable',
      '    - scrolling into view if needed',
      '    - done scrolling',
      '    - <div style="position:fixed">Generated secret overlay</div> intercepts pointer events',
    ],
    'intercepted',
  ],
  [[resolved, '  - element was detached from the DOM, retrying'], 'detached'],
  [
    [
      resolved,
      '  - attempting click action',
      '    - element is visible, enabled and stable',
      '    - scrolling into view if needed',
      '    - done scrolling',
      '    - performing click action',
    ],
    'dispatch-unacknowledged',
  ],
] as const)('REPLYCLICK call log %j classifies as %s', (log, expected) => {
  const result = replyClickFailure(timeout(...log));
  expect(result.failure).toBe(expected);
  expect(result.timedOut).toBe(true);
  expect(REPLY_CLICK_FAILURES).toContain(result.failure);
  // Only closed values leave; no selector, preview or page text.
  expect(JSON.stringify(result)).not.toMatch(/Generated|View all|secret|div/u);
});

test('REPLYCLICK dimmed call-log lines as the driver prints them still classify', () => {
  const dim = (line: string) => `\u001b[2m${line}\u001b[22m`;
  const error = new Error(
    [
      'locator.click: Timeout 1000ms exceeded.',
      'Call log:',
      dim("  - waiting for locator('div[role=button]')"),
      dim(
        '    - locator resolved to <div role="button">View all 4 replies</div>',
      ),
      dim('  - attempting click action'),
      dim('    2 \u00d7 waiting for element to be visible, enabled and stable'),
      dim('      - element is visible, enabled and stable'),
      dim('      - scrolling into view if needed'),
      dim('      - done scrolling'),
      dim('      - <div></div> intercepts pointer events'),
      dim('    - retrying click action'),
      dim('      - waiting 500ms'),
      '',
    ].join('\n'),
  );
  error.name = 'TimeoutError';
  expect(replyClickFailure(error)).toEqual({
    failure: 'intercepted',
    attempts: 2,
    timedOut: true,
  });
});

test('REPLYCLICK retry attempts are counted and capped', () => {
  const log = [resolved, '  - attempting click action'];
  for (let index = 0; index < 150; index++)
    log.push('  - retrying click action', '    - element is not stable');
  const result = replyClickFailure(timeout(...log));
  expect(result).toEqual({
    failure: 'not-stable',
    attempts: 100,
    timedOut: true,
  });
});

test('REPLYCLICK report keeps earlier clicks readable and accepts only closed dispatch values', () => {
  const click = {
    clicked: false,
    rowsBefore: 0,
    rowsAfter: 0,
    controlsAfter: null,
    candidatesAfter: null,
    nestedListAppeared: false,
    observationFailed: false,
  };
  const dispatch = {
    failure: 'intercepted',
    timeoutMs: 1000,
    elapsedMs: 1012,
    attempts: 5,
    visibleBefore: true,
    enabledBefore: true,
    boxStableBefore: true,
  };
  const parse = (value: unknown) =>
    ReplyExpansionDiagnosticSchema.safeParse({
      stopAt: 'click',
      clicks: [value],
    }).success;
  expect(parse(click)).toBe(true);
  expect(parse({ ...click, dispatch })).toBe(true);
  expect(
    parse({ ...click, dispatch: { ...dispatch, failure: 'timeout' } }),
  ).toBe(false);
  expect(
    parse({ ...click, dispatch: { ...dispatch, label: 'View all 4 replies' } }),
  ).toBe(false);
  expect(parse({ ...click, dispatch: { ...dispatch, attempts: 101 } })).toBe(
    false,
  );
});

test('REPLYCLICK non-timeout errors stay closed', () => {
  expect(
    replyClickFailure(
      new Error('locator.click: Element is not attached to the DOM'),
    ).failure,
  ).toBe('detached');
  expect(replyClickFailure(new Error('Generated secret')).failure).toBe(
    'other-error',
  );
  expect(replyClickFailure('not an error').failure).toBe('other-error');
  const hostile = new Error('x');
  Object.defineProperty(hostile, 'message', {
    get() {
      throw new Error('unreadable');
    },
  });
  expect(replyClickFailure(hostile).failure).toBe('other-error');
});
