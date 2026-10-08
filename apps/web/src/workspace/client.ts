import {
  WorkspaceRequestSchema,
  WorkspaceReplySchema,
  WorkspaceNotificationSchema,
  ReviewViewSchema,
} from '@socialprune/core/workspace/protocol';
import type {
  WorkspaceRequest,
  WorkspaceReply,
  WorkspaceNotification,
  ReviewRow,
  WorkspaceSummary,
} from '@socialprune/core/workspace/protocol';

export type WorkspacePort = Pick<
  Worker,
  | 'postMessage'
  | 'addEventListener'
  | 'removeEventListener'
  | 'dispatchEvent'
  | 'terminate'
>;

export class WorkspaceClient {
  readonly worker: WorkspacePort;
  rows: readonly ReviewRow[] = [];
  summary: WorkspaceSummary | null = null;
  storage: Extract<WorkspaceNotification, { type: 'storageState' }> | null =
    null;
  private readonly exportStreams = new Map<
    string,
    {
      listId: string;
      format: 'csv' | 'json';
      index: number;
      revision: number | null;
      queue: Promise<void>;
      bytes: number;
      write: (chunk: string) => Promise<void>;
    }
  >();
  readonly diagnostics: { code: string; requestId: string; at: string }[] = [];
  private readonly pending = new Map<
    string,
    { resolve: (reply: WorkspaceReply) => void; reject: (error: Error) => void }
  >();
  private readonly pendingWrites = new Set<Promise<WorkspaceReply>>();
  private readonly generations = new Map<string, number>();
  private readonly listeners = new Set<
    (notice: WorkspaceNotification) => void
  >();
  private readonly workspaceId: string;
  private readonly summaryListeners = new Set<
    (summary: WorkspaceSummary | null) => void
  >();

  constructor(worker: WorkspacePort, workspaceId = 'active') {
    this.worker = worker;
    this.workspaceId = workspaceId;
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      const notice = WorkspaceNotificationSchema.safeParse(event.data);
      if (notice.success) {
        if (notice.data.type === 'storageState') this.storage = notice.data;
        for (const listener of this.listeners) listener(notice.data);
        return;
      }
      const parsed = WorkspaceReplySchema.safeParse(event.data);
      if (!parsed.success) return;
      const reply = parsed.data;
      if (reply.type === 'failed')
        this.diagnostics.push({
          code: reply.code,
          requestId: reply.requestId,
          at: new Date().toISOString(),
        });
      if (reply.type === 'progress') return;
      if (reply.type === 'clickListExportChunk') {
        const stream = this.exportStreams.get(reply.requestId);
        if (!stream) return;
        if (
          reply.listId !== stream.listId ||
          reply.format !== stream.format ||
          reply.index !== stream.index ||
          (stream.revision !== null && reply.revision !== stream.revision)
        ) {
          this.exportStreams.delete(reply.requestId);
          this.pending
            .get(reply.requestId)
            ?.reject(new Error('Click-list export identity changed.'));
          this.pending.delete(reply.requestId);
          return;
        }
        stream.revision = reply.revision;
        stream.index++;
        stream.bytes += new TextEncoder().encode(reply.chunk).byteLength;
        stream.queue = stream.queue.then(() => stream.write(reply.chunk));
        void stream.queue.catch(() => undefined);
        return;
      }
      const request = this.pending.get(reply.requestId);
      if (!request) return;
      this.pending.delete(reply.requestId);
      if (
        (reply.type === 'queryResult' || reply.type === 'rows') &&
        reply.generation !== this.generations.get(reply.queryId)
      ) {
        request.resolve({
          type: 'cancelled',
          requestId: reply.requestId,
          queryId: reply.queryId,
          generation: reply.generation,
        });
        return;
      }
      if (reply.type === 'rows') this.rows = reply.rows;
      if (reply.type === 'opened') {
        this.summary = reply.summary;
        for (const listener of this.summaryListeners) listener(this.summary);
      }
      if (reply.type === 'settingsChanged' && this.summary)
        this.summary = {
          ...this.summary,
          timeZone: reply.timeZone,
          revision: reply.revision,
        };
      if (reply.type === 'reviewViewChanged' && this.summary)
        this.summary = { ...this.summary, review: reply.review };
      if (reply.type === 'workspaceDeleted') {
        this.summary = null;
        this.rows = [];
        for (const listener of this.summaryListeners) listener(null);
      }
      request.resolve(reply);
    });
    worker.addEventListener('error', () => {
      for (const pending of this.pending.values())
        pending.reject(new Error('Workspace worker stopped.'));
      this.pending.clear();
      this.exportStreams.clear();
    });
  }
  async exportClickList(
    listId: string,
    format: 'csv' | 'json',
    write: (chunk: string) => Promise<void>,
  ): Promise<void> {
    const requestId = crypto.randomUUID();
    const stream = {
      listId,
      format,
      index: 0,
      revision: null as number | null,
      queue: Promise.resolve(),
      bytes: 0,
      write,
    };
    this.exportStreams.set(requestId, stream);
    try {
      const reply = await this.request({
        type: 'clickListExport',
        requestId,
        listId,
        format,
      });
      await stream.queue;
      if (
        reply.type !== 'clickListExported' ||
        reply.listId !== listId ||
        reply.format !== format ||
        (stream.revision !== null && reply.revision !== stream.revision)
      )
        throw new Error('Click-list export did not complete.');
      if (reply.bytes !== stream.bytes)
        throw new Error('Click-list byte receipt differs.');
    } finally {
      this.exportStreams.delete(requestId);
    }
  }
  async backup(save: (file: File) => Promise<void>): Promise<void> {
    const chunks: BlobPart[] = [];
    let saved = () => {};
    let saveFailed: (error: unknown) => void = () => {};
    const savedReceipt = new Promise<void>((resolve, reject) => {
      saved = resolve;
      saveFailed = reject;
    });
    void savedReceipt.catch(() => undefined);
    const target = new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk as Uint8Array<ArrayBuffer>);
      },
      close: async () => {
        try {
          await save(
            new File(chunks, 'socialprune-backup.json', {
              type: 'application/json',
            }),
          );
          saved();
        } catch (error) {
          saveFailed(error);
          throw error;
        } finally {
          chunks.length = 0;
        }
      },
      abort(reason: unknown) {
        chunks.length = 0;
        saveFailed(
          reason instanceof Error
            ? reason
            : new Error('Backup stream aborted.'),
        );
      },
    });
    const reply = await this.request(
      { type: 'backup', requestId: crypto.randomUUID(), target },
      [target],
    );
    if (reply.type !== 'done') {
      saveFailed(new Error('Backup did not complete.'));
      throw new Error('Backup did not complete.');
    }
    // A transferred WritableStream close can settle before its receiver's
    // async close callback in WebKit. The caller's save receipt is separate.
    await savedReceipt;
  }
  async backupTo(target: WritableStream<Uint8Array>): Promise<void> {
    const reply = await this.request(
      { type: 'backup', requestId: crypto.randomUUID(), target },
      [target],
    );
    if (reply.type !== 'done') throw new Error('Backup did not complete.');
  }
  async downloadBackup(): Promise<void> {
    const chooser = (
      window as Window & {
        showSaveFilePicker?: (options: {
          suggestedName: string;
        }) => Promise<FileSystemFileHandle>;
      }
    ).showSaveFilePicker;
    if (chooser) {
      const handle = await chooser.call(window, {
        suggestedName: 'socialprune-backup.json',
      });
      await this.backupTo(await handle.createWritable());
    } else
      await this.backup((file) => {
        const url = URL.createObjectURL(file);
        try {
          const link = document.createElement('a');
          link.href = url;
          link.download = file.name;
          link.click();
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        return Promise.resolve();
      });
  }

  request(
    input: WorkspaceRequest,
    transfer: Transferable[] = [],
  ): Promise<WorkspaceReply> {
    const value = WorkspaceRequestSchema.parse(input);
    if (value.type === 'query')
      this.generations.set(value.queryId, value.generation);
    const result = new Promise<WorkspaceReply>((resolve, reject) => {
      this.pending.set(value.requestId, { resolve, reject });
      this.worker.postMessage(value, transfer);
    });
    if (
      [
        'decide',
        'outcome',
        'confirmBulk',
        'undo',
        'redo',
        'restore',
        'backup',
        'setTimeZone',
        'setReviewView',
        'deleteWorkspace',
      ].includes(value.type)
    ) {
      this.pendingWrites.add(result);
      return result.finally(() => this.pendingWrites.delete(result));
    }
    return result;
  }
  async flushCommands(): Promise<void> {
    await Promise.all([...this.pendingWrites]);
  }
  parseReviewView(value: unknown) {
    const result = ReviewViewSchema.safeParse(value);
    return result.success ? result.data : undefined;
  }
  subscribe(listener: (notice: WorkspaceNotification) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  subscribeSummary(listener: (summary: WorkspaceSummary | null) => void) {
    this.summaryListeners.add(listener);
    listener(this.summary);
    return () => {
      this.summaryListeners.delete(listener);
    };
  }
  async open(workspaceId = this.workspaceId) {
    return this.request({
      type: 'open',
      requestId: crypto.randomUUID(),
      workspaceId,
    });
  }
  async checkStorage(): Promise<{
    usage: number;
    quota: number;
    adequate: boolean;
  }> {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage ?? 0,
      quota = estimate.quota ?? 0;
    return { usage, quota, adequate: quota > 0 && usage / quota < 0.8 };
  }
  requestPersistentStorage(): Promise<boolean> {
    return navigator.storage.persist();
  }
  async connectImport(port: MessagePort): Promise<WorkspaceReply> {
    return this.request(
      { type: 'attachImport', requestId: crypto.randomUUID(), port },
      [port],
    );
  }
  dispose() {
    this.worker.terminate();
    this.rows = [];
    this.listeners.clear();
    this.summaryListeners.clear();
    for (const pending of this.pending.values())
      pending.reject(new Error('Workspace client disposed.'));
    this.pending.clear();
    this.exportStreams.clear();
  }
}

declare global {
  interface Window {
    workspace: WorkspaceClient;
  }
}
