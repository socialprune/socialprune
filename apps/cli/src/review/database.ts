import { Worker } from 'node:worker_threads';
import type { WorkerOptions } from 'node:worker_threads';
import {
  WorkspaceReplySchema,
  WorkspaceSummarySchema,
} from '@socialprune/core/workspace/protocol';
import type {
  HttpReviewRequest,
  WorkspaceReply,
  WorkspaceSummary,
} from '@socialprune/core/workspace/protocol';
import { CliError, CLI_ERRORS } from '../cli/errors.ts';

export function reviewDatabaseWorkerUrl(): URL {
  return import.meta.url.endsWith('.ts')
    ? new URL('./database-worker.ts', import.meta.url)
    : new URL('./database-worker.mjs', import.meta.url);
}

export class ReviewDatabase {
  readonly summary: WorkspaceSummary;
  private readonly worker: Worker;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      requestId: string;
      resolve(value: WorkspaceReply[]): void;
      reject(error: Error): void;
    }
  >();
  private closing?: Promise<void>;
  private exited = false;
  private constructor(worker: Worker, summary: WorkspaceSummary) {
    this.worker = worker;
    this.summary = summary;
    worker.on(
      'message',
      (message: { type: string; id: number; replies?: unknown }) => {
        if (message.type !== 'reply' && message.type !== 'failure') return;
        const task = this.pending.get(message.id);
        if (!task) return;
        this.pending.delete(message.id);
        const parsed = WorkspaceReplySchema.array()
          .min(1)
          .safeParse(message.replies);
        if (
          message.type === 'reply' &&
          parsed.success &&
          parsed.data.every((reply) => reply.requestId === task.requestId) &&
          parsed.data
            .slice(0, -1)
            .every(
              (reply) =>
                reply.type === 'progress' ||
                reply.type === 'clickListExportChunk',
            ) &&
          !['progress', 'clickListExportChunk'].includes(
            parsed.data.at(-1)!.type,
          )
        )
          task.resolve(parsed.data);
        else task.reject(new CliError('REVIEW_FAILED'));
      },
    );
    const fail = () => {
      for (const task of this.pending.values())
        task.reject(new CliError('REVIEW_FAILED'));
      this.pending.clear();
    };
    worker.on('error', fail);
    worker.on('exit', () => {
      this.exited = true;
      fail();
    });
  }
  static open(
    path: string,
    options: {
      workerUrl?: URL;
      createWorker?: (url: URL, options: WorkerOptions) => Worker;
    } = {},
  ): Promise<ReviewDatabase> {
    const worker = (
      options.createWorker ?? ((url, options) => new Worker(url, options))
    )(options.workerUrl ?? reviewDatabaseWorkerUrl(), {
      workerData: { path },
      stdout: true,
      stderr: true,
    });
    // Core diagnostics are fixed codes. Worker output is never a token channel.
    worker.stdout.resume();
    worker.stderr.resume();
    return new Promise((resolve, reject) => {
      const fail = () => {
        void worker.terminate();
        reject(new CliError('REVIEW_FAILED'));
      };
      worker.once('error', fail);
      worker.once('exit', fail);
      worker.once(
        'message',
        (message: { type: string; summary?: unknown; code?: unknown }) => {
          worker.removeListener('error', fail);
          worker.removeListener('exit', fail);
          const parsed = WorkspaceSummarySchema.safeParse(message.summary);
          if (message.type === 'ready' && parsed.success)
            resolve(new ReviewDatabase(worker, parsed.data));
          else {
            void worker.terminate();
            const code =
              typeof message.code === 'string' &&
              Object.hasOwn(CLI_ERRORS, message.code)
                ? (message.code as keyof typeof CLI_ERRORS)
                : 'REVIEW_FAILED';
            reject(new CliError(code));
          }
        },
      );
    });
  }
  run(
    input: HttpReviewRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceReply[]> {
    const id = ++this.sequence;
    const abort = () => this.worker.postMessage({ type: 'cancel', id });
    const promise = new Promise<WorkspaceReply[]>((resolve, reject) => {
      this.pending.set(id, { requestId: input.requestId, resolve, reject });
      this.worker.postMessage({ type: 'request', id, input });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    return promise.finally(() => signal?.removeEventListener('abort', abort));
  }
  close(): Promise<void> {
    if (this.exited) return Promise.resolve();
    this.closing ??= new Promise<void>((resolve) => {
      this.worker.once('exit', () => resolve());
      this.worker.postMessage({ type: 'close' });
    });
    return this.closing;
  }
  async terminate(): Promise<void> {
    await this.worker.terminate();
  }
}
