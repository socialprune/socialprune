import { expect, test, vi } from 'vitest';
import {
  automaticRun,
  unattendedWaitBudget,
  RUN_PHASES,
} from './automatic-run.ts';
test('STALL2 carried waits retain their full scheduled time plus a bounded completion margin', () => {
  expect(unattendedWaitBudget(900000, 30000)).toBe(930000);
  expect(unattendedWaitBudget(30000, 30000)).toBe(60000);
  expect(unattendedWaitBudget(60000, 1000)).toBe(90000);
  expect(new Set(RUN_PHASES).size).toBe(RUN_PHASES.length);
});
test('STALL2 unattended watchdog stops an unresolved phase and late guard work', async () => {
  vi.useFakeTimers();
  try {
    const expired = vi.fn(),
      run = automaticRun(true, expired);
    let release!: () => void,
      written = false;
    const result = run.run(async () => {
      run.phase('pace-wait', 50);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      run.check();
      written = true;
    });
    const rejected = expect(result).rejects.toMatchObject({
      token: 'run-wait-deadline',
    });
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(expired).toHaveBeenCalledWith('pace-wait', 50, expect.any(Number));
    release();
    await vi.advanceTimersByTimeAsync(1);
    expect(written).toBe(false);
    expect(run.expired).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
test('STALL2 manual runs retain person waits and completed automatic runs cancel their timer', async () => {
  vi.useFakeTimers();
  try {
    const expired = vi.fn(),
      manual = automaticRun(false, expired);
    manual.phase('confirmation-wait', 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(expired).not.toHaveBeenCalled();
    manual.close();
    const run = automaticRun(true, expired);
    expect(
      await run.run(() => {
        run.phase('canary-check', 5);
        return Promise.resolve(7);
      }),
    ).toBe(7);
    await vi.advanceTimersByTimeAsync(1000);
    expect(expired).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
