import type { BrowserRun, BrowserAttempt } from '@socialprune/core';
import type {
  RunView,
  RunEntry,
  InstagramResponses,
  RunStopDetail,
} from '@socialprune/core/workspace/desktop-protocol';
import type {
  ConfirmationPort,
  ConfirmationView,
} from './confirmation-state.ts';
import type { ProfileSnapshot } from './profile.ts';
import type { RunControls } from './run-controls.ts';

/** Embedding hooks are not CLI flags and cannot change the run's pace or order. */
export interface RunSession {
  controls: RunControls;
  browser(close: () => Promise<void>): void;
  failed(error: unknown): void;
  confirmation(
    initial: Omit<ConfirmationView, 'version'>,
  ): Promise<ConfirmationPort>;
  before(snapshot: ProfileSnapshot, account: string | null): void;
  entry(entry: RunEntry | null): void;
  progress(used: number, completed: number, attempts: BrowserAttempt[]): void;
  update(value: Record<string, unknown>): void;
  waiting(remainingMs: number, nextStepAt: string): void;
  instagram(value: InstagramResponses): void;
  finish(
    run: Pick<BrowserRun, 'endReason' | 'profileReport'>,
    error: unknown,
    after?: ProfileSnapshot,
    detail?: RunStopDetail,
  ): void;
}
export function entryView(
  item: { kind: RunEntry['kind']; createdAt: string; text: string },
  action: RunEntry['action'],
): RunEntry {
  const line = item.text.split(/[\r\n]/, 1)[0] ?? '';
  const firstLine = line
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .slice(0, 10_000);
  return {
    kind: item.kind,
    date: item.createdAt,
    firstLine,
    textTruncated: item.text !== firstLine,
    action,
  };
}
export type ActiveRunView = Exclude<RunView, { phase: 'idle' }>;
