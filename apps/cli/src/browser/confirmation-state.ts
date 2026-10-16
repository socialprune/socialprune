import {
  RunViewSchema,
  RunReadbackOutcomeSchema,
  xRateOperationToken,
} from '@socialprune/core/workspace/desktop-protocol';
import type {
  RunView,
  DesktopRunAction,
  RunProfileReadback,
  XRateWindow,
} from '@socialprune/core/workspace/desktop-protocol';
import { CliError } from '../cli/errors.ts';
import { endText } from './copy.ts';
import type { BrowserLanguage } from './copy.ts';

export interface ConfirmationView {
  platform?: 'x' | 'instagram';
  marked?: number;
  lang?: BrowserLanguage;
  phase: 'start' | 'running' | 'canary' | 'match' | 'ended';
  version: number;
  warning: string;
  profileWarning: string;
  expectedHandle?: string;
  planned: number;
  bulk: number;
  estimateMs: number;
  list: string;
  rows: unknown[];
  completed: number;
  result: string;
}
export type ConfirmationAction = 'start' | 'continue' | 'matches';
export function confirmationWarning(text: string, seen: boolean) {
  return {
    form: seen ? ('short' as const) : ('full' as const),
    acknowledged: false,
    text: seen
      ? text
          .split(/(?<=[.!?])\s+/u)
          .slice(0, 2)
          .join(' ')
      : text,
  };
}
export interface ConfirmationPort {
  readonly url: string;
  readonly launchUrl: string;
  readonly stopped: boolean;
  update(update: Partial<Omit<ConfirmationView, 'version'>>): void;
  wait(action: ConfirmationAction): Promise<boolean>;
  onStop(listener: () => void): void;
  close(): Promise<void>;
}

/** Owns confirmations for both renderers; HTTP only carries these values. */
export class ConfirmationState {
  private view: ConfirmationView;
  private desktop: RunView | undefined;
  private pending:
    { action: ConfirmationAction; resolve(value: boolean): void } | undefined;
  private stopListeners = new Set<() => void>();
  private listeners = new Set<(view: RunView) => void>();
  stopped = false;
  constructor(initial: Omit<ConfirmationView, 'version'>, desktop?: RunView) {
    this.view = { ...initial, version: 1 };
    if (desktop) this.desktop = RunViewSchema.parse(desktop);
  }
  get legacyView(): ConfirmationView {
    return { ...this.view };
  }
  get runView(): RunView {
    if (!this.desktop) throw new CliError('NOT_AVAILABLE');
    return structuredClone(this.desktop);
  }
  subscribe(listener: (view: RunView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  updateRun(update: Record<string, unknown>): void {
    if (!this.desktop) return;
    const value: Record<string, unknown> = {
      ...this.desktop,
      ...update,
      version: this.desktop.version + 1,
    };
    if (update.phase !== undefined) {
      for (const key of [
        'remainingMs',
        'until',
        'resetAt',
        'reload',
        'pausedAt',
        'end',
      ])
        if (!(key in update)) delete value[key];
    }
    this.desktop = RunViewSchema.parse(value);
    for (const listener of this.listeners) listener(this.runView);
  }
  update(update: Partial<Omit<ConfirmationView, 'version'>>): void {
    this.view = { ...this.view, ...update, version: this.view.version + 1 };
    if (!this.desktop || this.desktop.phase === 'idle') return;
    const patch: Record<string, unknown> = {
      progress: {
        ...this.desktop.progress,
        completed: Math.min(this.view.completed, this.desktop.progress.planned),
      },
    };
    if (update.phase === 'canary') {
      patch.phase = 'awaiting-continue';
      patch.canary = true;
    }
    if (update.phase === 'match') {
      patch.phase = 'canary-review';
      patch.canary = true;
    }
    // The runner publishes its structured end separately, not by parsing prose.
    if (update.phase === 'ended' && this.desktop.phase !== 'ended') {
      patch.phase = 'ending';
      patch.end = null;
    }
    this.updateRun(patch);
  }
  wait(action: ConfirmationAction): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    if (this.pending) throw new Error('Already waiting');
    return new Promise((resolve) => {
      this.pending = { action, resolve };
    });
  }
  onStop(listener: () => void): void {
    this.stopListeners.add(listener);
  }
  private stop(): void {
    this.stopped = true;
    this.pending?.resolve(false);
    this.pending = undefined;
    for (const listener of this.stopListeners) listener();
    const lang = this.view.lang ?? 'en';
    this.view = {
      ...this.view,
      phase: 'ended',
      version: this.view.version + 1,
      result:
        this.view.platform === 'instagram'
          ? lang === 'de'
            ? 'Du hast diesen Instagram-Lauf gestoppt.'
            : 'You stopped this Instagram run.'
          : endText('stopped-by-person', lang),
    };
  }
  legacyAction(action: unknown, version: unknown): boolean {
    if (version !== this.view.version) return false;
    if (
      (action === 'stop' ||
        (action === 'does-not-match' && this.view.phase === 'match')) &&
      this.view.phase !== 'ended'
    ) {
      this.stop();
      return true;
    }
    if (
      this.pending &&
      this.pending.action === action &&
      ((action === 'start' && this.view.phase === 'start') ||
        (action === 'continue' && this.view.phase === 'canary') ||
        (action === 'matches' && this.view.phase === 'match'))
    ) {
      this.pending.resolve(true);
      this.pending = undefined;
      this.view = {
        ...this.view,
        phase: 'running',
        version: this.view.version + 1,
      };
      return true;
    }
    return false;
  }
  action(
    runId: string,
    version: number,
    action: DesktopRunAction,
    controls: { requestPause(): void; resume(): void; stop(): void },
  ): void {
    const view = this.runView;
    if (
      view.phase === 'idle' ||
      view.runId !== runId ||
      (action !== 'stop' && view.version !== version)
    )
      throw new CliError('INVALID_ARGUMENTS');
    if (action === 'acknowledge-warning' && view.phase === 'awaiting-warning') {
      this.updateRun({
        phase: 'awaiting-start',
        warning: { ...view.warning, acknowledged: true },
      });
      return;
    }
    if (action === 'stop') {
      if (view.phase === 'ended') return;
      this.stop();
      controls.stop();
      this.updateRun({ phase: 'ending', end: null });
      return;
    }
    if (
      action === 'pause' &&
      [
        'running',
        'batch-pause',
        'rate-wait',
        'reload-wait',
        'awaiting-continue',
      ].includes(view.phase)
    ) {
      controls.requestPause();
      return;
    }
    if (action === 'resume' && view.phase === 'paused') {
      controls.resume();
      return;
    }
    if (action === 'does-not-match' && view.phase === 'canary-review') {
      this.stop();
      controls.stop();
      this.updateRun({ phase: 'ending', end: null });
      return;
    }
    const expected =
      view.phase === 'awaiting-start' && view.warning?.acknowledged
        ? 'start'
        : view.phase === 'canary-review'
          ? 'matches'
          : view.phase === 'awaiting-continue'
            ? 'continue'
            : null;
    const pending = this.pending;
    if (action !== expected || !pending || pending.action !== action)
      throw new CliError('INVALID_ARGUMENTS');
    this.pending = undefined;
    this.view = {
      ...this.view,
      phase: 'running',
      version: this.view.version + 1,
    };
    this.updateRun({ phase: 'running' });
    pending.resolve(true);
  }
  close(): Promise<void> {
    this.pending?.resolve(false);
    this.pending = undefined;
    return Promise.resolve();
  }
}

export function rateWindow(
  operationName: string,
  limit: number,
  remaining: number,
  resetAt: number,
): XRateWindow {
  const operation = xRateOperationToken(operationName);
  return {
    operation,
    operationName:
      operation === 'graphql-other' && operationName !== 'graphql-other'
        ? operationName
        : null,
    limit,
    remaining,
    resetAt: new Date(resetAt).toISOString(),
  };
}
export function profileReadback(
  value: Omit<RunProfileReadback, 'outcome'>,
): RunProfileReadback {
  const outcome =
    !value.profileObserved || !value.accountBefore || !value.accountAfter
      ? 'not-completed'
      : value.extensionIdsAdded.length || value.extensionIdsRemoved.length
        ? 'extensions-changed'
        : value.accountBefore.toLowerCase() !== value.accountAfter.toLowerCase()
          ? 'account-changed'
          : 'unchanged';
  return { ...value, outcome: RunReadbackOutcomeSchema.parse(outcome) };
}
