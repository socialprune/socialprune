import {
  HttpReviewRequestSchema,
  WorkspaceReplySchema,
  WorkspaceNotificationSchema,
} from '@socialprune/core/workspace/protocol';
import type {
  WorkspaceRequest,
  WorkspaceReply,
} from '@socialprune/core/workspace/protocol';
import type { WorkspacePort } from '../workspace/client.ts';

export type ReviewFetch = typeof fetch;

export function parseHttpReplies(
  input: unknown,
  requestId: string,
): WorkspaceReply[] {
  if (!Array.isArray(input) || !input.length)
    throw new Error('Invalid review reply array.');
  const replies = input.map((value: unknown) =>
    WorkspaceReplySchema.parse(value),
  );
  for (const [index, reply] of replies.entries()) {
    const intermediate =
      reply.type === 'progress' || reply.type === 'clickListExportChunk';
    if (
      reply.requestId !== requestId ||
      intermediate !== index < replies.length - 1
    )
      throw new Error('Invalid review reply order or identity.');
  }
  return replies;
}

// Implements only the message seam the existing UI client consumes. It has no
// browser workspace, worker, import, backup or restore implementation.
export class HttpWorkspacePort extends EventTarget implements WorkspacePort {
  private readonly requests = new Set<AbortController>();
  private stopped = false;
  private revision: number | null = null;
  private polling = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly visibilityChanged = () => this.schedulePolling();

  private readonly options: {
    csrf: string;
    origin: string;
    pageId: string;
    document: Pick<
      Document,
      'visibilityState' | 'addEventListener' | 'removeEventListener'
    >;
    ended: () => void;
    fetch: ReviewFetch;
  };

  constructor(options: HttpWorkspacePort['options']) {
    super();
    this.options = options;
    options.document.addEventListener(
      'visibilitychange',
      this.visibilityChanged,
    );
  }

  override addEventListener<K extends keyof WorkerEventMap>(
    type: K,
    listener: (event: WorkerEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }
  override removeEventListener<K extends keyof WorkerEventMap>(
    type: K,
    listener: (event: WorkerEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
  }

  private emit(data: unknown) {
    if (this.stopped) return;
    const event = new MessageEvent<unknown>('message', { data });
    this.dispatchEvent(event);
  }

  postMessage(
    message: unknown,
    options: Transferable[] | StructuredSerializeOptions = [],
  ): void {
    const input = message as WorkspaceRequest;
    const transfer = Array.isArray(options)
      ? options
      : (options.transfer ?? []);
    if (this.stopped) {
      this.emitError();
      return;
    }
    const bound =
      input.type === 'previewBulk' ||
      input.type === 'confirmBulk' ||
      input.type === 'releasePreview'
        ? { ...input, pageId: this.options.pageId }
        : input;
    const parsed = HttpReviewRequestSchema.safeParse(bound);
    if (!parsed.success || transfer.length) {
      this.emit({
        type: 'failed',
        requestId: input.requestId,
        code: 'INVALID_REQUEST',
      });
      return;
    }
    void this.send(parsed.data);
  }

  private async send(
    request: ReturnType<typeof HttpReviewRequestSchema.parse>,
  ) {
    const controller = new AbortController();
    this.requests.add(controller);
    try {
      const response = await this.options.fetch(`/api/${request.type}`, {
        method: 'POST',
        headers: {
          Origin: this.options.origin,
          'Content-Type': 'application/json',
          'X-SocialPrune-CSRF': this.options.csrf,
        },
        body: JSON.stringify(request),
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      if (this.stopped) return;
      if (response.status !== 200) {
        this.end();
        return;
      }
      const replies = parseHttpReplies(
        await response.json(),
        request.requestId,
      );
      for (const reply of replies) this.emit(reply);
      const terminal = replies.at(-1)!;
      if (terminal.type === 'opened') {
        this.observeRevision(terminal.summary.revision);
        this.schedulePolling();
      } else if ('revision' in terminal)
        this.observeRevision(terminal.revision);
    } catch {
      if (!this.stopped) this.end();
    } finally {
      this.requests.delete(controller);
    }
  }

  private observeRevision(revision: number) {
    const previous = this.revision;
    if (previous !== null && revision < previous) return;
    this.revision = revision;
    if (previous !== null && previous !== revision)
      this.emit(
        WorkspaceNotificationSchema.parse({
          type: 'changed',
          revision,
          itemIds: 'many',
          countsChanged: true,
        }),
      );
  }

  private schedulePolling() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (
      this.stopped ||
      this.revision === null ||
      this.options.document.visibilityState !== 'visible'
    )
      return;
    this.timer = setInterval(() => {
      if (this.polling || this.options.document.visibilityState !== 'visible')
        return;
      this.polling = true;
      void this.send({
        type: 'revision',
        requestId: crypto.randomUUID(),
      }).finally(() => {
        this.polling = false;
      });
    }, 2000);
  }

  private emitError() {
    this.dispatchEvent(new Event('error'));
  }

  private end() {
    this.terminate();
    this.options.ended();
    this.emitError();
  }

  terminate(): void {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.options.document.removeEventListener(
      'visibilitychange',
      this.visibilityChanged,
    );
    for (const request of this.requests) request.abort();
    this.requests.clear();
  }
}
