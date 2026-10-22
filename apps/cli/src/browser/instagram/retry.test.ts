import { expect, test } from 'vitest';
import { PostOpenRetries, POST_REOPEN_WAIT_MS } from './retry.ts';
import { ContextStop, PostRetriesSchema } from './report.ts';
import { IG_FIXTURE } from '../../../e2e/fake-instagram/fixture.ts';

test('C23 post-open retry policy permits one reopen per target and three per run without an environment shortcut', () => {
  const retries = new PostOpenRetries();
  const timeout = new Error(IG_FIXTURE.other.text);
  timeout.name = 'TimeoutError';
  expect(POST_REOPEN_WAIT_MS).toBe(60000);
  const first = retries.begin(
    timeout,
    ['generated-item-1', 'generated-post-1'],
    1,
    false,
    true,
  );
  expect(first).toMatchObject({
    step: 1,
    retryStep: null,
    stage: 'post-open',
    waitedMs: 0,
    outcome: null,
  });
  expect(
    retries.begin(timeout, ['generated-item-1'], 2, false, true),
  ).toBeNull();
  expect(
    retries.begin(
      timeout,
      ['generated-other-item', 'generated-post-1'],
      3,
      false,
      true,
    ),
  ).toBeNull();
  expect(
    retries.begin(timeout, ['generated-item-2'], 3, false, true),
  ).not.toBeNull();
  expect(
    retries.begin(timeout, ['generated-item-3'], 5, false, true),
  ).not.toBeNull();
  expect(
    retries.begin(timeout, ['generated-item-4'], 7, false, true),
  ).toBeNull();
  expect(retries.summary().used).toBe(3);
  expect(() =>
    PostRetriesSchema.parse({
      used: 1,
      entries: [
        {
          step: 1,
          retryStep: 2,
          stage: 'post-open',
          waitedMs: 60000,
          outcome: IG_FIXTURE.other.text,
        },
      ],
    }),
  ).toThrow();
  expect(JSON.stringify(retries.summary())).not.toContain('generated-item');
});
test('C23 notices generic failures canaries and exhausted capacity never authorize a post reopen', () => {
  const retry = new PostOpenRetries();
  const timeout = new Error();
  timeout.name = 'TimeoutError';
  for (const failure of [
    new ContextStop('PLATFORM_CHECK', 'notice-error'),
    new ContextStop('PLATFORM_CHECK', 'http-429'),
    new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure'),
    new Error(),
  ])
    expect(retry.begin(failure, ['generated'], 1, false, true)).toBeNull();
  expect(retry.begin(timeout, ['generated'], 1, true, true)).toBeNull();
  expect(retry.begin(timeout, ['generated'], 1, false, false)).toBeNull();
  expect(retry.summary()).toEqual({ used: 0, entries: [] });
});
