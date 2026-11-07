import { ContextStop } from './report.ts';

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
        failure = new ContextStop('PLATFORM_CHECK', 'run-wait-deadline');
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
