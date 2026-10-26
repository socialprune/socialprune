/** One human command stream per client, including work not sent yet. */
export class CommandQueue {
  private tail: Promise<unknown> = Promise.resolve();
  pending = 0;
  private listeners = new Set<() => void>();
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed() {
    for (const listener of this.listeners) listener();
  }
  enqueue<T>(run: () => Promise<T>): Promise<T> {
    this.pending++;
    this.changed();
    const result = this.tail.catch(() => undefined).then(run);
    this.tail = result.finally(() => {
      this.pending--;
      this.changed();
    });
    void this.tail.catch(() => undefined);
    return result;
  }
  async flush() {
    while (this.pending) await this.tail.catch(() => undefined);
  }
}
