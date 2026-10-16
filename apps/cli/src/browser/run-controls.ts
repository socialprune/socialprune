import { CliError } from '../cli/errors.ts';

export type RunControlPhase =
  { phase: 'running' } | { phase: 'paused'; pausedAt: string };

/** Requests never touch the step's abort signal. Only boundary waits observe them. */
export class RunControls {
  private requested = false;
  private paused = false;
  private stopped = false;
  private wake!: () => void;
  private changed = this.newChange();
  private resumed: (() => void) | undefined;
  private readonly now: () => Date;
  private readonly notify: (
    phase: RunControlPhase | null,
    pending: boolean,
  ) => void;
  pausedMs = 0;

  constructor(
    now: () => Date,
    notify: (phase: RunControlPhase | null, pending: boolean) => void,
  ) {
    this.now = now;
    this.notify = notify;
  }
  private newChange(): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve;
    });
  }
  requestPause(): void {
    if (this.stopped || this.requested || this.paused)
      throw new CliError('INVALID_ARGUMENTS');
    this.requested = true;
    this.notify(null, true);
    this.wake();
  }
  resume(): void {
    if (!this.paused || !this.resumed) throw new CliError('INVALID_ARGUMENTS');
    this.resumed();
    this.resumed = undefined;
  }
  stop(): void {
    this.stopped = true;
    this.wake();
    this.resumed?.();
    this.resumed = undefined;
  }
  async checkpoint(
    recheck: () => Promise<void>,
    signal: AbortSignal,
  ): Promise<number> {
    if (signal.aborted || this.stopped) throw new CliError('CANCELLED');
    if (!this.requested) return 0;
    const started = this.now().getTime();
    this.paused = true;
    this.requested = false;
    this.changed = this.newChange();
    const resumed = new Promise<void>((resolve) => {
      this.resumed = resolve;
    });
    this.notify({ phase: 'paused', pausedAt: this.now().toISOString() }, false);
    const abort = () => this.stop();
    signal.addEventListener('abort', abort, { once: true });
    try {
      await resumed;
      if (signal.aborted || this.stopped) throw new CliError('CANCELLED');
      await recheck();
      if (signal.aborted || this.stopped) throw new CliError('CANCELLED');
      const elapsed = Math.max(0, this.now().getTime() - started);
      this.pausedMs += elapsed;
      this.paused = false;
      this.notify({ phase: 'running' }, false);
      return elapsed;
    } finally {
      signal.removeEventListener('abort', abort);
      this.resumed = undefined;
    }
  }
  async delay(
    ms: number,
    sleep: (ms: number, signal: AbortSignal) => Promise<void>,
    recheck: () => Promise<void>,
    signal: AbortSignal,
    remainingWait?: (remainingMs: number, nextStepAt: string) => void,
  ): Promise<void> {
    let remaining = ms;
    while (remaining > 0) {
      await this.checkpoint(recheck, signal);
      remainingWait?.(
        remaining,
        new Date(this.now().getTime() + remaining).toISOString(),
      );
      const started = this.now().getTime();
      const timer = new AbortController();
      const sleeping = sleep(
        remaining,
        AbortSignal.any([signal, timer.signal]),
      );
      try {
        await Promise.race([sleeping, this.changed]);
      } finally {
        timer.abort();
        void sleeping.catch(() => undefined);
      }
      if (signal.aborted || this.stopped) throw new CliError('CANCELLED');
      remaining = Math.max(
        0,
        remaining - Math.max(0, this.now().getTime() - started),
      );
      if (!this.requested) return;
    }
    await this.checkpoint(recheck, signal);
  }
}
