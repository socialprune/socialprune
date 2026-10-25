/** Unsubscribe a completed operation instead of retaining it on a pending signal. */
export function interruptibleWork() {
  const listeners = new Set<() => void>();
  let interrupted = false;
  return {
    interrupt() {
      interrupted = true;
      for (const notify of listeners) notify();
      listeners.clear();
    },
    async until<T>(work: Promise<T>): Promise<T | null> {
      let notify!: () => void;
      const signal = new Promise<null>((resolve) => {
        notify = () => resolve(null);
      });
      if (interrupted) notify();
      else listeners.add(notify);
      try {
        return await Promise.race([work, signal]);
      } finally {
        listeners.delete(notify);
      }
    },
  };
}
