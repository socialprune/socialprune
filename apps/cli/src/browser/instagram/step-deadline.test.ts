import { expect, test, vi } from 'vitest';
import { stepDeadline, readingStepBudget } from './step-deadline.ts';

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
      code: 'PLATFORM_CHECK',
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
