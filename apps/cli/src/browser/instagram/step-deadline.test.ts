import { expect, test, vi } from 'vitest';
import {
  stepDeadline,
  readingStepBudget,
  postReadingBudget,
} from './step-deadline.ts';
import { instagramWarningKind } from './warning.ts';
import { ContextStop } from './report.ts';
import { contextEnd, contextFailure } from './copy.ts';
import { errorObject, INSTAGRAM_STOP_MESSAGES } from '../../cli/errors.ts';

test('DEADLINE post budget sums navigation/readiness, one reopen, bounded focal search, reply response and margin', () => {
  expect(postReadingBudget(30000, { expandMs: 3000 })).toEqual({
    navigationMs: 120000,
    reopenMs: 60000,
    focalSearchMs: 440000,
    replyResponseMs: 30000,
    marginMs: 30000,
    budgetMs: 680000,
  });
});

test('DEADLINE work beyond the derived post ceiling stops once with its own code', async () => {
  vi.useFakeTimers();
  try {
    const bounds = postReadingBudget(30000, { expandMs: 3000 });
    const expired = vi.fn();
    const deadline = stepDeadline(expired);
    const task = deadline.run(async () => {
      deadline.begin(bounds.budgetMs);
      await new Promise(() => {});
    });
    const rejected = expect(task).rejects.toMatchObject({
      code: 'STEP_DEADLINE',
      token: 'step-deadline',
    });
    await vi.advanceTimersByTimeAsync(bounds.budgetMs - 1);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(expired).toHaveBeenCalledTimes(1);
    expect(expired.mock.calls[0]?.[1]).toBe(bounds.budgetMs);
  } finally {
    vi.useRealTimers();
  }
});

test.each(['en', 'de'] as const)(
  'DEADLINE is never a warning or a platform sentence in %s',
  (lang) => {
    const error = new ContextStop('STEP_DEADLINE', 'step-deadline');
    error.warningKind = 'warning-notice';
    expect(instagramWarningKind(error)).toBeUndefined();
    const failure = contextFailure(error, lang);
    expect(
      errorObject(failure.code, undefined, undefined, failure.instagramStop),
    ).toMatchObject({
      code: 'STEP_DEADLINE',
      message: INSTAGRAM_STOP_MESSAGES['step-deadline'][lang],
    });
    expect(contextEnd('step-deadline', lang, true, error.token)).toContain(
      INSTAGRAM_STOP_MESSAGES['step-deadline'][lang],
    );
    expect(contextEnd('platform-check', lang, true, error.token)).toContain(
      INSTAGRAM_STOP_MESSAGES['step-deadline'][lang],
    );
  },
);
test.each(['en', 'de'] as const)(
  'WAIT3 run deadline has its own localized nonwarning result in %s',
  (lang) => {
    const error = new ContextStop('RUN_WAIT_DEADLINE', 'run-wait-deadline');
    error.warningKind = 'warning-notice';
    expect(instagramWarningKind(error)).toBeUndefined();
    const failure = contextFailure(error, lang);
    expect(
      errorObject(failure.code, undefined, undefined, failure.instagramStop),
    ).toMatchObject({
      code: 'RUN_WAIT_DEADLINE',
      message: INSTAGRAM_STOP_MESSAGES['run-wait-deadline'][lang],
    });
    expect(contextEnd('run-wait-deadline', lang, true, error.token)).toContain(
      INSTAGRAM_STOP_MESSAGES['run-wait-deadline'][lang],
    );
    expect(contextEnd('platform-check', lang, true, error.token)).toContain(
      INSTAGRAM_STOP_MESSAGES['run-wait-deadline'][lang],
    );
  },
);

test('STALL general budget includes existing dropdown, scroll, expansion and diagnostic waits', () => {
  expect(readingStepBudget(1000, { scrollMs: 0, expandMs: 0 })).toBe(42000);
  expect(readingStepBudget(1000, { scrollMs: 0, expandMs: 0 }, true)).toBe(
    169000,
  );
  expect(readingStepBudget(30000, { scrollMs: 3000, expandMs: 3000 })).toBe(
    450000,
  );
});

test('STALL deadline expires nonsettling work once, is sticky for late work and retains elapsed evidence', async () => {
  vi.useFakeTimers();
  try {
    const observed: unknown[] = [];
    const deadline = stepDeadline((elapsed, budget) =>
      observed.push({ elapsed, budget }),
    );
    let resume!: () => void,
      lateWrite = false;
    const task = deadline.run(async () => {
      deadline.begin(50);
      await new Promise<void>((resolve) => {
        resume = resolve;
      });
      deadline.check();
      lateWrite = true;
    });
    const rejected = expect(task).rejects.toMatchObject({
      code: 'STEP_DEADLINE',
      token: 'step-deadline',
    });
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ budget: 50 });
    expect(() => deadline.check()).toThrow();
    resume();
    await vi.advanceTimersByTimeAsync(1);
    expect(lateWrite).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
test('STALL clearing a finished or paused reading budget does not spend pace or reopen waits', async () => {
  vi.useFakeTimers();
  try {
    const expired = vi.fn(),
      deadline = stepDeadline(expired);
    const task = deadline.run(async () => {
      deadline.begin(5);
      deadline.clear();
      await new Promise((resolve) => setTimeout(resolve, 100));
      deadline.begin(50);
      return 7;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(await task).toBe(7);
    await vi.advanceTimersByTimeAsync(1000);
    expect(expired).not.toHaveBeenCalled();
    expect(deadline.expired).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
