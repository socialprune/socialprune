import {
  WorkspaceRequestSchema,
  WorkspaceReplySchema,
  WorkspaceNotificationSchema,
} from '@socialprune/core/workspace/protocol';
import type {
  WorkspaceRequest,
  WorkspaceReply,
  WorkspaceNotification,
  ReviewRow,
  WorkspaceSummary,
} from '@socialprune/core/workspace/protocol';

export class WorkspaceClient {
  readonly worker: Worker;
  rows: readonly ReviewRow[] = [];
  summary: WorkspaceSummary | null = null;
  readonly diagnostics: { code: string; requestId: string; at: string }[] = [];
  private readonly pending = new Map<
    string,
    { resolve: (reply: WorkspaceReply) => void; reject: (error: Error) => void }
  >();
  private readonly generations = new Map<string, number>();
  private readonly listeners = new Set<
    (notice: WorkspaceNotification) => void
  >();

  constructor(worker: Worker) {
    this.worker = worker;
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      const notice = WorkspaceNotificationSchema.safeParse(event.data);
      if (notice.success) {
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
      if (reply.type === 'opened') this.summary = reply.summary;
      request.resolve(reply);
    });
    worker.addEventListener('error', () => {
      for (const pending of this.pending.values())
        pending.reject(new Error('Workspace worker stopped.'));
      this.pending.clear();
    });
  }
  async backup(save: (file: File) => Promise<void>): Promise<void> {
    const chunks: BlobPart[] = [];
    const target = new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk as Uint8Array<ArrayBuffer>);
      },
      close: async () => {
        await save(
          new File(chunks, 'socialprune-backup.json', {
            type: 'application/json',
          }),
        );
        chunks.length = 0;
      },
      abort() {
        chunks.length = 0;
      },
    });
    const reply = await this.request(
      { type: 'backup', requestId: crypto.randomUUID(), target },
      [target],
    );
    if (reply.type !== 'done') throw new Error('Backup did not complete.');
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
      const handle = await chooser({
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
    return new Promise((resolve, reject) => {
      this.pending.set(value.requestId, { resolve, reject });
      this.worker.postMessage(value, transfer);
    });
  }
  subscribe(listener: (notice: WorkspaceNotification) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async open(workspaceId = 'active') {
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
    for (const pending of this.pending.values())
      pending.reject(new Error('Workspace client disposed.'));
    this.pending.clear();
  }
}

declare global {
  interface Window {
    workspace: WorkspaceClient;
  }
}
