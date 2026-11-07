import { ContextStop } from './report.ts';

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
    failure = new ContextStop('PLATFORM_CHECK', 'step-deadline');
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
      clear();
      this.check();
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
