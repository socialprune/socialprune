import {
  createBackup,
  restoreBackup,
} from '@socialprune/core/workspace/backup';
import { IndexedDBStore, deleteWorkspaceDatabase } from './idb-store.ts';
import { publishWorkspace } from './registry.ts';

export interface WorkspaceBackupFile {
  file: File;
  createdAt: string;
  scratchName: string;
}
async function* fileChunks(file: Blob): AsyncGenerator<Uint8Array> {
  const reader = file.stream().getReader();
  try {
    while (true) {
      const value = await reader.read();
      if (value.done) return;
      yield value.value;
    }
  } finally {
    reader.releaseLock();
  }
}
export async function writeBackup(
  store: IndexedDBStore,
  target: WritableStream<Uint8Array>,
): Promise<void> {
  const writer = target.getWriter();
  const backup = createBackup(store, { batchSize: 1000 });
  let root: FileSystemDirectoryHandle;
  try {
    root = await navigator.storage.getDirectory();
  } catch {
    // OPFS can be unavailable in a browser's disposable/private context.
    // Stream directly to the caller's sink then, still bounded in the worker.
    // The fallback's page sink can create a blob; no full item graph is read.
    try {
      for await (const chunk of backup.chunks) await writer.write(chunk);
      await writer.close();
      await backup.complete();
    } catch (error) {
      await writer.abort(error);
      throw error;
    } finally {
      writer.releaseLock();
    }
    return;
  }
  const scratchName = `sp-backup-${crypto.randomUUID()}.json`;
  const handle = await root.getFileHandle(scratchName, { create: true });
  let sink: FileSystemSyncAccessHandle;
  try {
    sink = await (
      handle as FileSystemFileHandle & {
        createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
      }
    ).createSyncAccessHandle();
  } catch (error) {
    await root.removeEntry(scratchName);
    await writer.abort(error);
    writer.releaseLock();
    throw error;
  }
  try {
    let offset = 0;
    for await (const chunk of backup.chunks) {
      let written = 0;
      while (written < chunk.length) {
        const length = sink.write(chunk.subarray(written), { at: offset });
        if (length < 1) throw new Error('OPFS stopped accepting backup bytes.');
        written += length;
        offset += length;
      }
    }
    sink.flush();
    sink.close();
  } catch (error) {
    sink.close();
    await root.removeEntry(scratchName);
    await writer.abort(error);
    writer.releaseLock();
    throw error;
  }
  try {
    for await (const chunk of fileChunks(await handle.getFile()))
      await writer.write(chunk);
    await writer.close();
    await backup.complete();
  } catch (error) {
    await writer.abort(error);
    throw error;
  } finally {
    writer.releaseLock();
    await root.removeEntry(scratchName);
  }
}

export async function stageRestore(
  file: Blob,
): Promise<{ store: IndexedDBStore; storageId: string }> {
  const storageId = crypto.randomUUID();
  const store = await IndexedDBStore.open(storageId);
  try {
    const result = await restoreBackup(store, fileChunks(file), {
      batchSize: 1000,
    });
    await publishWorkspace({
      id: storageId,
      kind: result.meta.kind,
      createdAt: result.meta.createdAt,
    });
    return { store, storageId };
  } catch (error) {
    await store.close();
    await deleteWorkspaceDatabase(storageId);
    throw error;
  }
}
