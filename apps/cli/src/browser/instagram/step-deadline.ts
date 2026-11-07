import { ContextStop } from './report.ts';
import { POST_REOPEN_WAIT_MS } from './retry.ts';

/** Ceiling for the existing post path, not extra focal-search attempts. */
export function postReadingBudget(
  responseMs: number,
  pace: { expandMs: number },
) {
  const bounds = {
    navigationMs: 4 * responseMs, // navigation and readiness, twice if reopened
    reopenMs: POST_REOPEN_WAIT_MS,
    focalSearchMs: 11 * responseMs + 10 * (5000 + 2 * pace.expandMs),
    replyResponseMs: responseMs,
    marginMs: Math.max(30000, responseMs),
  };
  return {
    ...bounds,
    budgetMs: Object.values(bounds).reduce((total, value) => total + value, 0),
  };
}

// Sum the existing bounded work rather than treating responseMs as its whole
// duration: six selectOption waits, ten list scrolls/expansions, and (only for
// list diagnostics) four extra navigations, two date windows and probe settles.
// Pace, confirmation and the explicit reopen wait stay outside this budget.
export const readingStepBudget = (
  responseMs: number,
  pace: { scrollMs: number; expandMs: number },
  diagnostic = false,
) =>
  responseMs * 12 +
  6 * 5000 +
  10 * (pace.scrollMs + pace.expandMs) +
  (diagnostic
    ? 4 * (15000 + responseMs) + 2 * 6 * 5000 + 14 * pace.scrollMs + 3000
    : 0);

/** One active reading budget, not a pace or person-confirmation timeout. */
export function stepDeadline(
  expired: (elapsedMs: number, budgetMs: number) => void,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failure: ContextStop | undefined;
  let started = 0,
    budget = 0;
  let end = Infinity;
  let reject!: (error: ContextStop) => void;
  const stopped = new Promise<never>((_resolve, no) => {
    reject = no;
  });
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    end = Infinity;
  };
  const expire = () => {
    if (failure) return;
    failure = new ContextStop('STEP_DEADLINE', 'step-deadline');
    try {
      expired(
        Math.max(0, Math.round(performance.now() - started)),
        Math.round(budget),
      );
    } finally {
      reject(failure);
    }
  };
  return {
    begin(ms: number) {
      this.check();
      clear();
      started = performance.now();
      budget = Math.max(1, ms);
      end = started + budget;
      timer = setTimeout(expire, budget);
    },
    check() {
      if (performance.now() >= end) expire();
      if (failure) throw failure;
    },
    clear,
    async run<T>(action: () => Promise<T>) {
      try {
        return await Promise.race([Promise.resolve().then(action), stopped]);
      } finally {
        clear();
      }
    },
    get expired() {
      return failure !== undefined;
    },
  };
}
