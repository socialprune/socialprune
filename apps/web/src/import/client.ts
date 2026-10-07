import type { ImportSummary } from '@socialprune/core';
import type {
  ImportMessage,
  ImportRequest,
  PolicyViolation,
} from './protocol.ts';

export interface ImportSnapshot {
  /** Legacy diagnostics only: never populated. Item bytes live in the worker. */
  items: readonly never[];
  phase: 'idle' | 'importing' | 'aborting' | 'complete' | 'aborted' | 'error';
  receivedItems: number;
  batches: number;
  summary: ImportSummary | null;
  message: string | null;
  durationMs: number | null;
  abortLatencyMs: number | null;
  policyViolations: readonly PolicyViolation[];
}

export class ImportClient {
  private readonly workerFactory: () => Worker;
  private readonly connectWorkspace: ((port: MessagePort) => void) | undefined;
  private worker: Worker | null = null;
  private id = 0;
  private disposed = false;
  private startedAt = 0;
  private abortAt: number | null = null;
  private state: ImportSnapshot = {
    items: [],
    phase: 'idle',
    receivedItems: 0,
    batches: 0,
    summary: null,
    message: null,
    durationMs: null,
    abortLatencyMs: null,
    policyViolations: [],
  };
  private readonly listeners = new Set<(state: ImportSnapshot) => void>();

  constructor(
    workerFactory: () => Worker,
    connectWorkspace?: (port: MessagePort) => void,
  ) {
    this.workerFactory = workerFactory;
    this.connectWorkspace = connectWorkspace;
    this.createWorker();
  }

  private createWorker(): void {
    this.worker = this.workerFactory();
    this.worker.onmessage = (event: MessageEvent<ImportMessage>) =>
      this.receive(event.data);
    this.worker.onerror = () => {
      this.update({
        phase: 'error',
        message: 'The import worker stopped unexpectedly.',
      });
      this.worker?.terminate();
      this.worker = null;
    };
  }

  get snapshot(): ImportSnapshot {
    return this.state;
  }

  subscribe(listener: (state: ImportSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(files: File[]): void {
    if (this.disposed) throw new Error('The import client was disposed.');
    if (this.state.phase === 'importing' || this.state.phase === 'aborting')
      throw new Error('An import is already running.');
    if (!files.length) throw new Error('Choose at least one ZIP file.');
    if (!this.worker) this.createWorker();
    if (this.connectWorkspace) {
      const channel = new MessageChannel();
      this.connectWorkspace(channel.port1);
      this.attach(channel.port2);
    }
    this.id++;
    this.startedAt = performance.now();
    this.abortAt = null;
    this.update({
      phase: 'importing',
      receivedItems: 0,
      batches: 0,
      summary: null,
      message: null,
      durationMs: null,
      abortLatencyMs: null,
    });
    this.send({ type: 'import', id: this.id, files });
  }

  abort(): void {
    if (this.state.phase !== 'importing') return;
    this.abortAt = performance.now();
    this.update({ phase: 'aborting' });
    this.send({ type: 'abort', id: this.id });
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.listeners.clear();
  }

  private send(request: ImportRequest) {
    this.worker?.postMessage(request);
  }
  attach(port: MessagePort): void {
    this.worker?.postMessage({ type: 'attach', port }, [port]);
  }

  private update(changes: Partial<ImportSnapshot>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of this.listeners) listener(this.state);
  }

  private receive(message: ImportMessage): void {
    if (this.disposed) return;
    if (message.type === 'policy-violation') {
      this.update({
        policyViolations: [...this.state.policyViolations, message.violation],
      });
      return;
    }
    if (message.id !== this.id) return;
    if (this.state.phase !== 'importing' && this.state.phase !== 'aborting')
      return;
    if (message.type === 'items') {
      throw new Error('Item batches must not reach the page.');
    } else if (message.type === 'progress') {
      this.update({
        receivedItems: message.items,
        batches: Math.ceil(message.items / 1000),
      });
    } else if (message.type === 'summary') {
      this.update({
        phase: 'complete',
        summary: message.summary,
        durationMs: performance.now() - this.startedAt,
      });
    } else {
      this.update({
        phase: message.type === 'aborted' ? 'aborted' : 'error',
        message: message.type === 'error' ? message.message : null,
        durationMs: performance.now() - this.startedAt,
        abortLatencyMs:
          this.abortAt === null ? null : performance.now() - this.abortAt,
      });
    }
  }
}

declare global {
  interface Window {
    // Read-only import diagnostics used by local measurements. No approval or
    // platform action is exposed here. Item batches remain on the main thread.
    socialprune: { getImportSnapshot(): ImportSnapshot };
  }
}
