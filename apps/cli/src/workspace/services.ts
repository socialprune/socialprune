import { lstat, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { importArchive, stableId } from '@socialprune/core';
import type {
  ArchiveReader,
  ImportRecord,
  PlatformAdapter,
} from '@socialprune/core';
import { openArchivePaths } from '@socialprune/core/node';
import { xAdapter } from '@socialprune/adapter-x';
import { instagramAdapter } from '@socialprune/adapter-instagram';
import { mergeImport } from '@socialprune/core/workspace/merge';
import {
  createWorkspace,
  readWorkspace,
  records,
} from '@socialprune/core/workspace/store';
import type { WorkspaceStore } from '@socialprune/core/workspace/store';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '@socialprune/core/workspace/memory-store';
import { LabelService } from '@socialprune/core/workspace/labels';
import { ClickListService } from '@socialprune/core/workspace/clicklist';
import {
  createBackup,
  restoreBackup,
  RestoreFailure,
} from '@socialprune/core/workspace/backup';
import { CliError } from '../cli/errors.ts';
import { SQLiteStore } from './sqlite-store.ts';
import {
  assertOutput,
  fileChunks,
  fileError,
  validateArchivePaths,
  workspacePath,
  writeChunks,
} from './files.ts';

const adapters = [xAdapter, instagramAdapter];
export interface WorkspaceCall {
  workspace: string;
  dryRun?: boolean;
  signal: AbortSignal;
  now: () => Date;
}
export interface ImportCall extends WorkspaceCall {
  paths: readonly string[];
}
export interface BackupExportCall extends WorkspaceCall {
  out: string;
}
export interface RestoreCall extends WorkspaceCall {
  file: string;
}
export interface ClickListCall extends BackupExportCall {
  account: string;
  format: 'csv' | 'json';
  timeZone?: string;
  systemTimeZone?: string;
}

async function identity(store: WorkspaceStore) {
  return store.read(async (tx) => ({
    id: (await tx.meta.get()).id,
    revision: (await tx.runtime.get()).revision,
  }));
}
async function openWorkspace(
  input: WorkspaceCall,
  create = false,
): Promise<WorkspaceStore> {
  const target = await workspacePath(
    input.workspace,
    create,
    Boolean(input.dryRun),
  );
  if (input.dryRun) {
    if (!target.exists)
      return createMemoryStore(
        new MemoryStoreBacking(createWorkspace({ now: input.now() })),
      );
    const source = await SQLiteStore.open(target.path, { readOnly: true });
    try {
      const data = await source.read(async (tx) => ({
        workspace: await readWorkspace(tx),
        runtime: await tx.runtime.get(),
        items: await records(tx.items),
      }));
      const backing = new MemoryStoreBacking(data.workspace);
      backing.current.runtime = data.runtime;
      backing.current.items = new Map(
        data.items.map((value) => [value.item.id, value]),
      );
      return createMemoryStore(backing);
    } finally {
      await source.close();
    }
  }
  return SQLiteStore.open(target.path, {
    initial: target.exists ? undefined : createWorkspace({ now: input.now() }),
  });
}
async function readOnlyWorkspace(input: WorkspaceCall): Promise<SQLiteStore> {
  const target = await workspacePath(input.workspace, false);
  return SQLiteStore.open(target.path, { readOnly: true });
}

export async function importWorkspace(input: ImportCall) {
  await validateArchivePaths(input.paths);
  const store = await openWorkspace(input, true);
  let archive: ArchiveReader | undefined;
  try {
    archive = await openArchivePaths([...input.paths], {
      signal: input.signal,
    });
    const archiveNames = [...archive.archives];
    const prior = await store.read((tx) => records(tx.imports));
    const pending = new Map<string, ImportRecord>();
    const perPlatform = new Map<
      string,
      { added: number; updated: number; conflicts: number }
    >();
    const totals = { added: 0, updated: 0, conflicts: 0 };
    const wrapped: PlatformAdapter[] = [];
    let time = input.now().toISOString();
    while (prior.some((record) => record.importedAt === time))
      time = new Date(Date.parse(time) + 1).toISOString();
    for (const adapter of adapters) {
      const detection = await adapter.detect(archive);
      const incomplete = prior.findLast(
        (record) =>
          record.status === 'incomplete' &&
          record.platform === adapter.platform &&
          JSON.stringify(record.archives) === JSON.stringify(archiveNames),
      );
      const importedAt = incomplete?.importedAt ?? time;
      const record: ImportRecord = {
        id:
          incomplete?.id ??
          `${adapter.platform}:${await stableId([adapter.name, importedAt, ...archiveNames])}`,
        platform: adapter.platform,
        importedAt,
        archives: archiveNames,
        exportCreatedAt: null,
        accounts: [],
        adapter: { name: adapter.name, version: adapter.version },
        variant: detection.variant ?? null,
        diagnostics: [],
        itemCount: 0,
        status: 'incomplete',
      };
      if (detection.result === 'match') {
        pending.set(adapter.platform, record);
        await mergeImport(store, record, []);
      }
      wrapped.push({
        ...adapter,
        detect: () => Promise.resolve(detection),
        async *parse(source, options) {
          for await (const event of adapter.parse(source, options)) {
            if (event.type === 'meta')
              record.exportCreatedAt = event.exportCreatedAt;
            if (
              event.type === 'account' &&
              !record.accounts.some((value) => value.key === event.account.key)
            )
              record.accounts.push(event.account);
            yield event;
          }
        },
      });
    }
    const result = await importArchive(archive, wrapped, {
      signal: input.signal,
      now: () => new Date(time),
      batchSize: 1000,
      async onItems(items) {
        const record = pending.get(items[0]!.platform)!;
        record.itemCount += items.length;
        for (const item of items)
          if (!record.accounts.some((value) => value.key === item.account.key))
            record.accounts.push(item.account);
        const merged = await mergeImport(store, record, items);
        const counts = perPlatform.get(record.platform) ?? {
          added: 0,
          updated: 0,
          conflicts: 0,
        };
        counts.added += merged.added;
        counts.updated += merged.updated;
        counts.conflicts += merged.conflicts;
        perPlatform.set(record.platform, counts);
        totals.added += merged.added;
        totals.updated += merged.updated;
        totals.conflicts += merged.conflicts;
      },
    });
    if (result.status === 'unknown-format')
      throw new CliError('UNKNOWN_FORMAT');
    if (result.status === 'html-export') throw new CliError('HTML_EXPORT');
    for (const record of result.records) {
      const diagnostics = [...record.diagnostics];
      const conflicts = perPlatform.get(record.platform)?.conflicts ?? 0;
      if (conflicts)
        diagnostics.push({
          category: 'conflicting-items',
          status: 'skipped',
          files: [],
          count: conflicts,
          message: 'Conflicting item IDs were omitted.',
        });
      const owner = pending.get(record.platform)!;
      record.id = owner.id;
      record.importedAt = owner.importedAt;
      record.diagnostics = diagnostics;
      await mergeImport(store, record, []);
    }
    return {
      workspace: await identity(store),
      data: {
        dryRun: Boolean(input.dryRun),
        imports: result.records.length,
        items: result.records.reduce(
          (sum, record) => sum + record.itemCount,
          0,
        ),
        ...totals,
        diagnostics: result.records.flatMap((record) =>
          record.diagnostics.map((value) => ({
            category: value.category,
            status: value.status,
            count: value.count,
          })),
        ),
      },
      partial: result.status === 'partial' || totals.conflicts > 0,
    };
  } finally {
    await archive?.close();
    await store.close();
  }
}

export async function summarizeWorkspace(input: WorkspaceCall) {
  const store = await readOnlyWorkspace(input);
  try {
    const data = await new LabelService(store).summary();
    return {
      workspace: { id: data.workspaceId, revision: data.revision },
      data,
    };
  } finally {
    await store.close();
  }
}

export async function exportBackup(input: BackupExportCall) {
  await assertOutput(input.out, input.workspace);
  const store = await openWorkspace(input);
  let snapshot: Awaited<ReturnType<SQLiteStore['snapshot']>> | undefined;
  try {
    if (input.dryRun) {
      const summary = await new LabelService(store).summary();
      return {
        workspace: await identity(store),
        data: { dryRun: true, out: input.out, counts: summary.counts },
      };
    }
    snapshot = await (store as SQLiteStore).snapshot();
    const summary = await new LabelService(snapshot.store).summary();
    const session = createBackup(snapshot.store, {
      now: input.now(),
      signal: input.signal,
      batchSize: 1000,
    });
    const bytes = await writeChunks(input.out, session.chunks, input.signal);
    await snapshot.close();
    snapshot = undefined;
    // Complete only after flush, close and publication, and after releasing the reader lock.
    await session.complete();
    return {
      workspace: await identity(store),
      data: {
        dryRun: false,
        out: input.out,
        counts: summary.counts,
        bytes,
        lastBackupAt: session.createdAt,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'BACKUP_CHANGED')
      throw new CliError('BACKUP_CHANGED');
    throw error;
  } finally {
    await snapshot?.close();
    await store.close();
  }
}

export async function restoreWorkspace(input: RestoreCall) {
  const target = await workspacePath(input.workspace, true, true);
  const file = await lstat(input.file).catch(() => null);
  if (!file?.isFile() || file.isSymbolicLink()) throw new CliError('IO_ERROR');
  const staging = input.dryRun
    ? undefined
    : join(
        input.workspace,
        `socialprune.restore-${crypto.randomUUID()}.sqlite`,
      );
  if (!input.dryRun) await workspacePath(input.workspace, true);
  const store = staging
    ? await SQLiteStore.open(staging, {
        initial: createWorkspace({ now: input.now() }),
      })
    : createMemoryStore();
  let previous: string | null = null;
  let moved = false;
  let storageFailure: CliError | undefined;
  // Core deliberately flattens foreign adapter errors to STORAGE. Keep the
  // technology receipt here so a full disk/busy store is not called bad JSON.
  const stagingPort: WorkspaceStore = {
    read: (operation) => store.read(operation),
    async write(operation) {
      try {
        return await store.write(operation);
      } catch (error) {
        if (error instanceof CliError) storageFailure = error;
        throw error;
      }
    },
    close: () => store.close(),
  };
  try {
    const result = await restoreBackup(
      stagingPort,
      fileChunks(input.file, input.signal),
      { signal: input.signal },
    );
    const workspace = await identity(store);
    await store.close();
    if (staging) {
      input.signal.throwIfAborted();
      if (target.exists) {
        const current = await SQLiteStore.open(target.path);
        try {
          await current.checkExclusive();
        } finally {
          await current.close();
        }
        const stamp = input.now().toISOString().replaceAll(':', '-');
        previous = join(
          input.workspace,
          `socialprune.${stamp}.previous.sqlite`,
        );
        if (await lstat(previous).catch(() => null))
          throw new CliError('WORKSPACE_BUSY');
        await rename(target.path, previous);
        moved = true;
      }
      try {
        await rename(staging, target.path);
      } catch (error) {
        if (moved && previous) await rename(previous, target.path);
        throw error;
      }
    }
    return {
      workspace,
      data: {
        dryRun: Boolean(input.dryRun),
        counts: result.counts,
        previousFile: previous,
        migratedFrom: result.migratedFrom,
      },
    };
  } catch (error) {
    if (storageFailure) throw storageFailure;
    if (error instanceof RestoreFailure)
      throw new CliError(
        error.code === 'BACKUP_SCHEMA_UNSUPPORTED'
          ? 'BACKUP_SCHEMA_UNSUPPORTED'
          : 'BACKUP_INVALID',
      );
    if (error instanceof CliError || input.signal.aborted) throw error;
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'EPERM' || error.code === 'EBUSY')
    )
      throw new CliError('WORKSPACE_BUSY');
    throw fileError(error);
  } finally {
    await store.close();
    if (staging) {
      await rm(staging, { force: true });
      await rm(`${staging}-journal`, { force: true });
    }
  }
}

export async function exportClickList(input: ClickListCall) {
  await assertOutput(input.out, input.workspace);
  const store = await readOnlyWorkspace(input);
  const service = new ClickListService(store, adapters);
  const listId = crypto.randomUUID();
  try {
    const summary = await service.open({
      listId,
      accountKey: input.account,
      timeZone: input.timeZone,
      systemTimeZone: input.systemTimeZone,
      signal: input.signal,
    });
    const bytes = input.dryRun
      ? 0
      : await writeChunks(
          input.out,
          service.export({
            listId,
            format: input.format,
            signal: input.signal,
          }),
          input.signal,
        );
    return {
      workspace: await identity(store),
      data: {
        dryRun: Boolean(input.dryRun),
        out: input.out,
        format: input.format,
        count: summary.total,
        timeZone: summary.timeZone,
        timeZoneSource: summary.timeZoneSource,
        bytes,
      },
    };
  } finally {
    service.release(listId);
    await store.close();
  }
}

export const workspaceServices = {
  importWorkspace,
  summarizeWorkspace,
  exportBackup,
  restoreWorkspace,
  exportClickList,
};
export type WorkspaceServices = typeof workspaceServices;
