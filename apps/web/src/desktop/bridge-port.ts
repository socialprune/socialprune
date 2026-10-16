import { HttpReviewRequestSchema } from '@socialprune/core/workspace/protocol';
import type { WorkspaceRequest } from '@socialprune/core/workspace/protocol';
import { WorkspaceNotificationSchema } from '@socialprune/core/workspace/protocol';
import type { DesktopBridge } from '@socialprune/core/workspace/desktop-protocol';
import type { WorkspacePort } from '../workspace/client.ts';
import { request } from './bridge.ts';

/** Worker-shaped transport only. No worker, storage, fetch or session token. */
export class BridgeWorkspacePort extends EventTarget implements WorkspacePort {
  private stopped = false;
  private readonly pageId = crypto.randomUUID();
  private readonly bridge: DesktopBridge;
  private revision: number | null = null;

  constructor(bridge: DesktopBridge) {
    super();
    this.bridge = bridge;
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

  postMessage(
    raw: unknown,
    options: Transferable[] | StructuredSerializeOptions = [],
  ): void {
    if (this.stopped) {
      this.dispatchEvent(new Event('error'));
      return;
    }
    const input = raw as WorkspaceRequest;
    const transfer = Array.isArray(options) ? options : options.transfer;
    const bound =
      input.type === 'previewBulk' ||
      input.type === 'confirmBulk' ||
      input.type === 'releasePreview'
        ? { ...input, pageId: this.pageId }
        : input;
    const parsed = HttpReviewRequestSchema.safeParse(bound);
    if (!parsed.success || transfer?.length) {
      this.emit({
        type: 'failed',
        requestId: input.requestId,
        code: 'INVALID_REQUEST',
      });
      return;
    }
    void request(this.bridge, parsed.data)
      .then((reply) => {
        if (reply.type !== 'reviewReply')
          throw new Error('Review reply required.');
        for (const message of reply.replies) this.emit(message);
        const terminal = reply.replies.at(-1)!;
        const revision =
          terminal.type === 'opened'
            ? terminal.summary.revision
            : 'revision' in terminal
              ? terminal.revision
              : null;
        if (
          revision !== null &&
          (this.revision === null || revision >= this.revision)
        ) {
          const previous = this.revision;
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
      })
      .catch(() => {
        if (!this.stopped) this.dispatchEvent(new Event('error'));
      });
  }

  private emit(data: unknown) {
    if (!this.stopped)
      this.dispatchEvent(new MessageEvent('message', { data }));
  }

  terminate(): void {
    this.stopped = true;
  }
}
