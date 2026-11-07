import { ContextStop } from './report.ts';
import { z } from 'zod';

export const RUN_PHASES = [
  'run-start',
  'browser-launch',
  'browser-setup',
  'checkpoint',
  'attempt',
  'list-open',
  'post-open',
  'post-read',
  'reply-scope',
  'reply-read',
  'capture',
  'answers',
  'compare',
  'canary-check',
  'settlement',
  'progress',
  'confirmation-wait',
  'pace-wait',
  'batch-pause',
  'reopen-wait',
  'finalization',
  'ended',
] as const;
export type RunPhase = (typeof RUN_PHASES)[number];
export const CHECKPOINT_STEPS = [
  'guard',
  'profile-snapshot',
  'extensions-check',
  'complete',
] as const;
const CheckpointStepSchema = z.enum(CHECKPOINT_STEPS).nullable();
const tracePosition = {
  phase: z.enum(RUN_PHASES),
  phaseSequence: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  checkpointStep: CheckpointStepSchema,
  checkpointStepStartedMs: z.number().int().nonnegative().nullable(),
};
export const RunWaitTraceSchema = z.strictObject({
  expiry: z.strictObject(tracePosition).optional(),
  droppedEvents: z.number().int().nonnegative(),
  events: z
    .array(
      z.strictObject({
        ...tracePosition,
        event: z.enum([
          'page-close',
          'browser-disconnected',
          'watchdog-close-request',
        ]),
        order: z.enum(['no-expiry', 'before-expiry', 'after-expiry']),
      }),
    )
    .max(128),
});

/** Diagnostic monotonic ordering only; never arms, resets or checks a guard. */
export function runWaitTrace() {
  let phase: RunPhase = 'run-start',
    phaseSequence = 0,
    at = performance.now();
  let checkpointStep: (typeof CHECKPOINT_STEPS)[number] | null = null;
  let checkpointStepStartedMs: number | null = null;
  const position = () => ({
    phase,
    phaseSequence,
    elapsedMs: Math.max(0, Math.round(performance.now() - at)),
    checkpointStep,
    checkpointStepStartedMs,
  });
  let expiry: ReturnType<typeof position> | undefined;
  let ordinal = 0,
    expiredOrdinal = Infinity,
    droppedEvents = 0;
  const events: (ReturnType<typeof position> & {
    event: 'page-close' | 'browser-disconnected' | 'watchdog-close-request';
    ordinal: number;
  })[] = [];
  return {
    phase(value: RunPhase) {
      if (expiry) return;
      phase = value;
      phaseSequence++;
      at = performance.now();
      checkpointStep = null;
      checkpointStepStartedMs = null;
    },
    checkpoint(value: (typeof CHECKPOINT_STEPS)[number]) {
      if (!expiry) {
        checkpointStep = value;
        checkpointStepStartedMs = Math.max(
          0,
          Math.round(performance.now() - at),
        );
      }
    },
    expire() {
      if (!expiry) {
        expiry = position();
        expiredOrdinal = ++ordinal;
      }
    },
    event(
      event: 'page-close' | 'browser-disconnected' | 'watchdog-close-request',
    ) {
      if (events.length >= 128) {
        droppedEvents++;
        return;
      }
      events.push({ ...position(), event, ordinal: ++ordinal });
    },
    summary() {
      return RunWaitTraceSchema.parse({
        ...(expiry ? { expiry } : {}),
        droppedEvents,
        events: events.map(({ ordinal, ...value }) => ({
          ...value,
          order: !expiry
            ? 'no-expiry'
            : ordinal < expiredOrdinal
              ? 'before-expiry'
              : 'after-expiry',
        })),
      });
    },
  };
}
export const AutomaticRunEvidenceSchema = z.strictObject({
  phases: z.array(z.enum(RUN_PHASES)).max(1000),
  automaticWaits: z
    .array(
      z.strictObject({
        phase: z.enum(['pace-wait', 'batch-pause', 'reopen-wait']),
        expectedMs: z.number().int().nonnegative(),
        budgetMs: z.number().int().nonnegative(),
      }),
    )
    .max(1000),
  runDeadline: z
    .strictObject({
      phase: z.enum(RUN_PHASES),
      budgetMs: z.number().int().nonnegative(),
      elapsedMs: z.number().int().nonnegative(),
    })
    .optional(),
  runWaitTrace: RunWaitTraceSchema.optional(),
});
export const unattendedWaitBudget = (expectedMs: number, responseMs: number) =>
  Math.max(0, expectedMs) + Math.max(30000, responseMs);

/** Run-owned coverage for waits outside the counted-reading watchdog. */
export function automaticRun(
  enabled: boolean,
  expired: (phase: RunPhase, budgetMs: number, elapsedMs: number) => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined,
    failure: ContextStop | undefined;
  let end = Infinity,
    expire: (() => void) | undefined;
  let reject!: (error: ContextStop) => void;
  const stopped = new Promise<never>((_resolve, no) => {
    reject = no;
  });
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    end = Infinity;
  };
  return {
    phase(phase: RunPhase, budgetMs: number) {
      this.check();
      clear();
      if (!enabled) return;
      const at = performance.now();
      end = at + budgetMs;
      expire = () => {
        if (failure) return;
        failure = new ContextStop('RUN_WAIT_DEADLINE', 'run-wait-deadline');
        try {
          expired(phase, budgetMs, Math.round(performance.now() - at));
        } finally {
          reject(failure);
        }
      };
      timer = setTimeout(expire, Math.max(1, budgetMs));
    },
    check() {
      if (performance.now() >= end) expire?.();
      if (failure) throw failure;
    },
    async run<T>(action: () => Promise<T>) {
      try {
        return await Promise.race([Promise.resolve().then(action), stopped]);
      } finally {
        clear();
      }
    },
    close: clear,
    get expired() {
      return failure !== undefined;
    },
  };
}
