import demoImportWorkerURL from '../import/demo-import-worker.ts?worker&url';
import { ImportClient } from '../import/client.ts';
import type { ImportSnapshot } from '../import/client.ts';
import { WorkspaceClient } from '../workspace/client.ts';
import { scriptURL } from './trusted-urls.ts';
import type { WorkerGate } from './gate.ts';

export class DemoSession {
  readonly workspace: WorkspaceClient;
  readonly imports: ImportClient;
  private disposed = false;
  private closing: Promise<void> | null = null;
  constructor(gate: WorkerGate) {
    const worker = gate.startDemo();
    if (!worker) throw new Error('A framed page cannot open the demo.');
    this.workspace = new WorkspaceClient(worker, 'demo');
    this.imports = new ImportClient(
      () =>
        gate.trackDemo(
          new Worker(scriptURL(demoImportWorkerURL), { type: 'module' }),
        ),
      (port) => {
        void this.workspace.connectImport(port).catch(() => undefined);
      },
    );
    gate.trackDemo(worker, () => this.close());
  }
  async open(): Promise<void> {
    const reply = await this.workspace.open();
    if (this.disposed) throw new Error('The demo was closed.');
    if (reply.type !== 'opened') throw new Error('The demo did not open.');
    if (reply.summary.kind !== 'demo')
      throw new Error('The demo kind differs.');
    if (!reply.summary.counts.items) await this.import();
  }
  private async import(): Promise<void> {
    const { archives } = await import('virtual:sp-demo-archives');
    if (this.disposed) throw new Error('The demo was closed.');
    await new Promise<void>((resolve, reject) => {
      this.imports.start(
        archives.map(
          ({ bytes, name }) =>
            new File([bytes], name, { type: 'application/zip' }),
        ),
      );
      const unsubscribe = this.imports.subscribe((snapshot: ImportSnapshot) => {
        if (snapshot.phase === 'complete') {
          unsubscribe();
          resolve();
        } else if (snapshot.phase === 'error' || snapshot.phase === 'aborted') {
          unsubscribe();
          reject(new Error('The demo import did not complete.'));
        }
      });
    });
    const reply = await this.workspace.open();
    if (reply.type !== 'opened') throw new Error('The demo did not settle.');
  }
  async reset(): Promise<void> {
    await this.workspace.flushCommands();
    const deleted = await this.workspace.request({
      type: 'deleteWorkspace',
      requestId: crypto.randomUUID(),
      workspaceId: 'demo',
    });
    if (deleted.type !== 'workspaceDeleted')
      throw new Error('The demo was not reset.');
    await this.open();
  }
  dispose(): void {
    this.disposed = true;
    this.imports.dispose();
    void this.close()
      .catch(() => undefined)
      .finally(() => this.workspace.dispose());
  }
  private close(): Promise<void> {
    this.closing ??= (async () => {
      this.disposed = true;
      this.imports.dispose();
      await this.workspace.request({
        type: 'shutdown',
        requestId: crypto.randomUUID(),
      });
    })();
    return this.closing;
  }
}
