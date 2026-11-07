import { expect, test, vi } from 'vitest';
import {
  automaticRun,
  unattendedWaitBudget,
  RUN_PHASES,
  AutomaticRunEvidenceSchema,
  runWaitTrace,
  RunWaitTraceSchema,
} from './automatic-run.ts';
test('STALL2 carried waits retain their full scheduled time plus a bounded completion margin', () => {
  expect(unattendedWaitBudget(900000, 30000)).toBe(930000);
  expect(unattendedWaitBudget(30000, 30000)).toBe(60000);
  expect(unattendedWaitBudget(60000, 1000)).toBe(90000);
  expect(new Set(RUN_PHASES).size).toBe(RUN_PHASES.length);
});
test('WAIT3 checkpoint trace freezes the pending read and orders equal-tick close events around expiry', () => {
  vi.useFakeTimers();
  try {
    const trace = runWaitTrace();
    trace.phase('checkpoint');
    trace.checkpoint('profile-snapshot');
    vi.advanceTimersByTime(10);
    trace.event('page-close');
    trace.expire();
    trace.event('watchdog-close-request');
    trace.phase('finalization');
    trace.checkpoint('complete');
    trace.event('browser-disconnected');
    const result = trace.summary();
    expect(result.expiry).toMatchObject({
      phase: 'checkpoint',
      checkpointStep: 'profile-snapshot',
      elapsedMs: 10,
    });
    expect(result.events.map((event) => event.order)).toEqual([
      'before-expiry',
      'after-expiry',
      'after-expiry',
    ]);
    expect(
      result.events.every(
        (event) =>
          event.phaseSequence === result.expiry?.phaseSequence &&
          event.elapsedMs === 10,
      ),
    ).toBe(true);
    expect(
      RunWaitTraceSchema.safeParse({
        ...result,
        events: [{ ...result.events[0], text: 'Generated private text' }],
      }).success,
    ).toBe(false);
    expect(
      RunWaitTraceSchema.safeParse({
        ...result,
        expiry: { ...result.expiry, checkpointStep: 'unknown' },
      }).success,
    ).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
test('WAIT3 trace retention is bounded and keeps explicit dropped-event evidence', () => {
  const trace = runWaitTrace();
  trace.phase('checkpoint');
  trace.checkpoint('guard');
  for (let index = 0; index < 130; index++) trace.event('page-close');
  trace.expire();
  expect(trace.summary().events).toHaveLength(128);
  expect(trace.summary().droppedEvents).toBe(2);
  expect(
    trace.summary().events.every((event) => event.order === 'before-expiry'),
  ).toBe(true);
});
test('STALL2 progress evidence accepts closed phases and numbers only', () => {
  const base = {
    phases: ['batch-pause', 'post-open', 'reply-scope'],
    automaticWaits: [
      { phase: 'batch-pause', expectedMs: 900000, budgetMs: 930000 },
    ],
  };
  expect(AutomaticRunEvidenceSchema.safeParse(base).success).toBe(true);
  for (const invalid of [
    { ...base, phases: ['Generated entry'] },
    { ...base, text: 'Generated private text' },
    {
      ...base,
      runDeadline: { phase: 'pace-wait', budgetMs: -1, elapsedMs: 3 },
    },
  ])
    expect(AutomaticRunEvidenceSchema.safeParse(invalid).success).toBe(false);
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
      code: 'RUN_WAIT_DEADLINE',
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
