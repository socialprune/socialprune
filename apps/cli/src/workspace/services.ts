import { lstat, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  EndpointSource,
  ScanError,
  normalize,
  runBatches,
  sourceVersion,
  loopback,
  RUBRIC_VERSION,
  sourceConfigurationHash,
} from '@socialprune/classify';
import type {
  RunEntry,
  RunCriterion,
  SourceConfig,
  SourceLabelFile,
  RunProgress,
} from '@socialprune/classify';
import {
  loadSourceConfig,
  loadSourceKey,
  nodeTransport,
  sourceKeyPath,
  recordSourceCheck,
} from '@socialprune/classify/node';
import {
  PRESETS,
  criterionHash,
  currentChecks,
} from '@socialprune/core/criteria';
import { importArchive, stableId, UtcTimestampSchema } from '@socialprune/core';
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
import {
  LabelService,
  LabelValidationError,
} from '@socialprune/core/workspace/labels';
import { LabelFileSchema } from '@socialprune/core/workspace/payloads';
import { deriveState } from '@socialprune/core/workspace/state';
import { ClickListService } from '@socialprune/core/workspace/clicklist';
import {
  createBackup,
  restoreBackup,
  RestoreFailure,
} from '@socialprune/core/workspace/backup';
import { CliError, LABEL_FAILURE_CODES, CLI_ERRORS } from '../cli/errors.ts';
import { SQLiteStore } from './sqlite-store.ts';
import { fetchOriginals } from '../originals/fetch.ts';
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
export interface BatchCall extends WorkspaceCall {
  shareWithAgent: boolean;
  account?: string;
  size?: number;
  cursor?: string;
  sourceName?: string;
}
export interface LabelsCall extends WorkspaceCall {
  file: string;
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
    const summary = await new LabelService(store).summary();
    const { feedCounts } = await import('@socialprune/core/criteria');
    const data = {
      ...summary,
      tabs: feedCounts(await store.read(readWorkspace)).tabs,
    };
    return {
      workspace: { id: data.workspaceId, revision: data.revision },
      data,
    };
  } finally {
    await store.close();
  }
}

function validateCursor(cursor: string): void {
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    if (!cursor || bytes.toString('base64url') !== cursor)
      throw new CliError('INVALID_CURSOR');
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    if (
      !value ||
      typeof value !== 'object' ||
      Object.keys(value).sort().join(',') !== 'account,after,sourceName,v' ||
      !('v' in value) ||
      value.v !== 1 ||
      !('account' in value) ||
      typeof value.account !== 'string' ||
      !value.account ||
      !('sourceName' in value) ||
      typeof value.sourceName !== 'string' ||
      !value.sourceName ||
      !('after' in value) ||
      !Array.isArray(value.after) ||
      value.after.length !== 2 ||
      !UtcTimestampSchema.safeParse(value.after[0]).success ||
      typeof value.after[1] !== 'string' ||
      !value.after[1]
    )
      throw new CliError('INVALID_CURSOR');
  } catch {
    throw new CliError('INVALID_CURSOR');
  }
}

function labelServiceError(error: unknown): never {
  if (error instanceof LabelValidationError)
    throw new CliError('INVALID_LABELS', undefined, {
      failures: error.failures.map((failure) => ({
        index: failure.index,
        code:
          LABEL_FAILURE_CODES.find((code) => code === failure.code) ??
          'INVALID_LABEL',
      })),
    });
  if (error && typeof error === 'object' && 'code' in error) {
    switch (error.code) {
      case 'SHARING_NOT_CONFIRMED':
      case 'INVALID_CURSOR':
      case 'ACCOUNT_REQUIRED':
      case 'SUBMISSION_CONFLICT':
        throw new CliError(error.code);
      case 'INVALID_REQUEST':
        throw new CliError('INVALID_ARGUMENTS');
      case 'INVALID_LABELS':
      case 'CONTENT_CHANGED':
        throw new CliError('INVALID_LABELS', undefined, {
          failures: [
            {
              index: -1,
              code:
                error.code === 'CONTENT_CHANGED'
                  ? 'CONTENT_CHANGED'
                  : 'INVALID_LABEL',
            },
          ],
        });
    }
  }
  throw error;
}

export async function nextBatch(input: BatchCall) {
  input.signal.throwIfAborted();
  if (input.shareWithAgent !== true)
    throw new CliError('SHARING_NOT_CONFIRMED');
  if (input.cursor !== undefined) validateCursor(input.cursor);
  const store = await readOnlyWorkspace(input);
  try {
    const data = await new LabelService(store).batchNext(input);
    return { workspace: await identity(store), data };
  } catch (error) {
    labelServiceError(error);
  } finally {
    await store.close();
  }
}

export async function submitLabelFile(input: LabelsCall) {
  input.signal.throwIfAborted();
  const file = await lstat(input.file).catch(() => null);
  if (!file?.isFile() || file.isSymbolicLink()) throw new CliError('IO_ERROR');
  let text: string;
  try {
    text = await readFile(input.file, {
      encoding: 'utf8',
      signal: input.signal,
    });
  } catch (error) {
    if (input.signal.aborted) throw error;
    throw fileError(error);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError('INVALID_LABELS', undefined, {
      failures: [{ index: -1, code: 'INVALID_LABEL' }],
    });
  }
  const target = await workspacePath(input.workspace, false);
  const store = await SQLiteStore.open(target.path, {
    readOnly: Boolean(input.dryRun),
  });
  try {
    const data = await new LabelService(store, { now: input.now }).submitLabels(
      value,
      { dryRun: input.dryRun },
    );
    // Core has accepted the entire file. This advisory count changes neither
    // the submission receipt nor its nullable-evidence validation contract.
    const highRiskWithoutEvidence = LabelFileSchema.parse(value).labels.filter(
      (label) => label.risk >= 2 && label.evidence === null,
    ).length;
    return {
      workspace: await identity(store),
      data,
      warnings: highRiskWithoutEvidence
        ? [
            `${highRiskWithoutEvidence} labels at risk 2 or 3 have evidence set to null. Review those suggestions individually.`,
          ]
        : [],
    };
  } catch (error) {
    labelServiceError(error);
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
    if (staging)
      await (store as SQLiteStore).browserOutcomeWriter().rebuildXWarnings();
    const workspace = await identity(store);
    await store.close();
    if (staging) {
      input.signal.throwIfAborted();
      if (target.exists) {
        const current = await SQLiteStore.open(target.path);
        try {
          await current.checkExclusive();
          if (current.browserOutcomeWriter().hasUnacknowledgedXWarning())
            throw new CliError('X_WARNING_RESTORE_BLOCKED');
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

export interface ScanCheckCall {
  source: string;
  signal: AbortSignal;
  progress: (text: string) => void;
}
export interface ScanRunCall extends WorkspaceCall {
  source: string;
  account?: string;
  limit?: number;
  plan?: string;
  confirmEndpoint?: string;
  confirmModel?: string;
  progress: (text: string) => void;
}
function scanFailure(error: unknown): never {
  if (error instanceof ScanError) {
    if (Object.hasOwn(CLI_ERRORS, error.code))
      throw new CliError(error.code as keyof typeof CLI_ERRORS);
    if (error.code === 'CONNECTION' || error.code === 'TLS')
      throw new CliError('ENDPOINT_UNREACHABLE');
    if (error.code === 'REQUEST_TIMEOUT' || error.code === 'RETRYABLE_STATUS')
      throw new CliError('ENDPOINT_RETRY_EXHAUSTED');
    throw new CliError('SCAN_FAILED');
  }
  labelServiceError(error);
}
function shareScan(
  config: SourceConfig,
  file: string,
  count: number,
  progress: (text: string) => void,
  terms: boolean,
  dryRun = false,
  invented = false,
) {
  const origin = new URL(config.baseUrl).origin;
  if (dryRun)
    progress(
      'Dry run: no request is sent, no key file is opened and nothing is written. The following describes the planned run.',
    );
  progress(
    invented
      ? 'One invented entry and preset criteria; nothing from your workspace is sent.'
      : `${count} ${count === 1 ? 'entry' : 'entries'}: platform, kind and full text, with criterion definitions. No originals, engagement or keep rules.`,
  );
  const subject = invented
    ? 'The invented entry and preset criteria'
    : "Your entries' text and your criteria";
  progress(
    loopback(new URL(origin).hostname)
      ? `${subject} go to ${origin}, a program on this computer, for the model ${config.model}. SocialPrune cannot see where that program sends them. If it passes them to a service on the internet, they leave your computer and can count against your plan or cost money there.`
      : `${subject} leave your computer for ${origin}, for the model ${config.model}. That service handles them under its own terms and can charge your account. SocialPrune cannot see or limit what happens to them there.`,
  );
  const keyPath = sourceKeyPath(config, file);
  progress(
    keyPath
      ? `Key file: ${keyPath}. SocialPrune reads a key only from this file.`
      : 'Without a key.',
  );
  if (config.allowPaid)
    progress('This source allows requests that can cost money.');
  if (terms)
    progress(
      `The terms of the service behind ${origin} apply to what you send there, and so do the terms of X and Instagram. SocialPrune does not check them for you.`,
    );
}
function inventedCheck() {
  return {
    criteria: PRESETS.filter((c) => !['harmless', 'unclear'].includes(c.id)),
    entries: [
      {
        id: 'e1',
        platform: 'x' as const,
        kind: 'post' as const,
        text: 'An invented museum note for the endpoint check.',
      },
    ],
  };
}
export async function checkScanSource(input: ScanCheckCall) {
  try {
    input.signal.throwIfAborted();
    const config = await loadSourceConfig(input.source);
    shareScan(config, input.source, 1, input.progress, true, false, true);
    const { key, keyPath } = await loadSourceKey(config, input.source);
    const origin = new URL(config.baseUrl).origin;
    const network = nodeTransport(origin);
    try {
      const source = new EndpointSource(config, network.transport, key);
      const listed = await source.exchange(
        config.baseUrl + '/models',
        null,
        input.signal,
      );
      const models =
        listed !== null &&
        typeof listed === 'object' &&
        'data' in listed &&
        Array.isArray(listed.data)
          ? (listed.data as unknown[])
          : [];
      const modelListed = models.some(
        (model) =>
          model !== null &&
          typeof model === 'object' &&
          'id' in model &&
          model.id === config.model,
      );
      const request = inventedCheck();
      const answer = await source.check(request, input.signal);
      const valid = normalize(request, answer);
      if (
        !answer.answeredBy ||
        answer.answeredBy.length > 200 ||
        /[\r\n]/.test(answer.answeredBy)
      )
        throw new ScanError('MODEL_CHANGED');
      const recordedCheck =
        valid.valid.size === 1
          ? await recordSourceCheck(
              input.source,
              config,
              {
                origin,
                answeringModel: answer.answeredBy,
                rubricVersion: RUBRIC_VERSION,
                checkedAt: new Date().toISOString(),
                configurationHash: sourceConfigurationHash(config),
              },
              input.signal,
            )
          : null;
      return {
        data: {
          origin,
          model: config.model,
          keyFile: keyPath,
          modelListed,
          answeringModel: answer.answeredBy,
          structuredOutput: valid.valid.size === 1,
          usageReported: answer.usage.promptTokens !== null,
          cachedTokensReported: answer.usage.cachedPromptTokens !== null,
          rubricVersion: RUBRIC_VERSION,
          recordedCheck,
        },
      };
    } finally {
      network.close();
    }
  } catch (error) {
    scanFailure(error);
  }
}
export async function runScan(input: ScanRunCall) {
  let store: WorkspaceStore | undefined;
  let network: ReturnType<typeof nodeTransport> | undefined;
  try {
    input.signal.throwIfAborted();
    const config = await loadSourceConfig(input.source);
    const origin = new URL(config.baseUrl).origin;
    const recorded = config.check;
    const checkMatches = Boolean(
      recorded &&
      recorded.origin === origin &&
      recorded.rubricVersion === RUBRIC_VERSION &&
      recorded.configurationHash === sourceConfigurationHash(config),
    );
    if (
      !input.dryRun &&
      (!input.plan ||
        input.confirmEndpoint !== origin ||
        !input.confirmModel ||
        !checkMatches ||
        input.confirmModel !== recorded?.answeringModel)
    ) {
      input.progress(
        `No request sent. Origin from source: ${origin}; you confirmed ${input.confirmEndpoint ?? 'none'}. Recorded answering model: ${checkMatches ? recorded!.answeringModel : 'no recorded check'}; you confirmed ${input.confirmModel ?? 'none'}. Run scan check --source with this named source file, then make a fresh dry-run plan and confirm the values it printed.`,
      );
      throw new CliError('ENDPOINT_NOT_CONFIRMED');
    }
    store = await readOnlyWorkspace(input);
    const snapshot = await store.read(async (tx) => ({
      workspace: await readWorkspace(tx),
      items: await records(tx.items),
      revision: (await tx.runtime.get()).revision,
    }));
    await store.close();
    store = undefined;
    const workspace = snapshot.workspace;
    const complete = new Set(
      workspace.imports.filter((i) => i.status === 'complete').map((i) => i.id),
    );
    const visible = snapshot.items
      .filter((item) => !item.importId || complete.has(item.importId))
      .map((item) => item.item);
    const accounts = [...new Set(visible.map((item) => item.account.key))];
    const account =
      input.account ?? (accounts.length === 1 ? accounts[0] : undefined);
    if (!account && accounts.length > 1) throw new CliError('ACCOUNT_REQUIRED');
    if (input.account && !accounts.includes(input.account))
      throw new CliError('INVALID_ARGUMENTS');
    const criteria: RunCriterion[] = (
      workspace.settings.criteria?.selected ?? []
    ).map((id) => {
      const preset = PRESETS.find((c) => c.id === id);
      const own = workspace.settings.criteria?.custom.find((c) => c.id === id);
      if (!preset && !own) throw new CliError('INVALID_ARGUMENTS');
      return {
        id,
        label: own?.label ?? preset!.label,
        definition: own?.description ?? preset!.definition,
        hash: criterionHash(id, workspace.settings),
      };
    });
    if (!criteria.length) throw new CliError('INVALID_ARGUMENTS');
    const confirmedModel = input.confirmModel ?? null;
    if (
      confirmedModel &&
      (confirmedModel.length > 200 || /[\r\n]/.test(confirmedModel))
    )
      throw new CliError('ENDPOINT_NOT_CONFIRMED');
    const plan =
      'sha256:' +
      createHash('sha256')
        .update(
          JSON.stringify([
            config,
            RUBRIC_VERSION,
            account ?? null,
            criteria.map(({ id, hash }) => ({ id, hash })),
            workspace.id,
          ]),
        )
        .digest('hex');
    if (!input.dryRun && plan !== input.plan) throw new CliError('STALE_PLAN');
    let observedModel: string | null = null;
    let source: EndpointSource | undefined;
    const sourceSummary = {
      name: config.name,
      origin,
      model: config.model,
      confirmedModel,
      answeringModel: observedModel as string | null,
      rubricVersion: RUBRIC_VERSION,
      keyFile: sourceKeyPath(config, input.source),
      recordedCheck: checkMatches ? recorded : null,
    };
    if (!input.dryRun) {
      shareScan(config, input.source, 1, input.progress, true, false, true);
      input.progress(
        'Sending model check: 1 invented entry; no workspace entries.',
      );
      const { key } = await loadSourceKey(config, input.source);
      network = nodeTransport(origin);
      source = new EndpointSource(config, network.transport, key);
      const check = source.check.bind(source);
      source.check = async (request, signal) => {
        const answer = await check(request, signal);
        sourceSummary.answeringModel =
          answer.answeredBy &&
          answer.answeredBy.length <= 200 &&
          !/[\r\n]/.test(answer.answeredBy)
            ? answer.answeredBy
            : null;
        return answer;
      };
      let preflightCode: keyof typeof CLI_ERRORS | null = null;
      try {
        const answer = await source.check(inventedCheck(), input.signal);
        observedModel =
          answer.answeredBy &&
          answer.answeredBy.length <= 200 &&
          !/[\r\n]/.test(answer.answeredBy)
            ? answer.answeredBy
            : null;
        sourceSummary.answeringModel = observedModel;
        if (observedModel !== confirmedModel) preflightCode = 'MODEL_CHANGED';
      } catch (error) {
        try {
          scanFailure(error);
        } catch (failure) {
          if (!(failure instanceof CliError)) throw failure;
          preflightCode = failure.code;
        }
      }
      if (preflightCode)
        return {
          workspace: { id: workspace.id, revision: snapshot.revision },
          status: 'partial' as const,
          exitCode: CLI_ERRORS[preflightCode].exitCode,
          warnings: [
            preflightCode === 'MODEL_CHANGED'
              ? `MODEL_CHANGED: The endpoint answered as ${observedModel ?? 'no model'}; you confirmed ${confirmedModel}. Nothing was stored.`
              : `${preflightCode}: ${CLI_ERRORS[preflightCode].message}`,
          ],
          data: {
            dryRun: false,
            plan,
            source: sourceSummary,
            coverageCounted: false,
            entries: null,
            requests: {
              planned: 0,
              sent: 0,
              retried: 0,
              split: 0,
              secondPass: 0,
              failed: 1,
            },
            modelCheck: { sent: 1 },
            tokens: null,
            batchSize: config.entriesPerRequest,
            hits: {},
            criteria: {},
            labelsPerRisk: {},
            unclear: {},
            durationMs: 0,
            stopDetail: preflightCode,
          },
        };
    }
    const model =
      observedModel ?? (checkMatches ? recorded!.answeringModel : config.model);
    const version = sourceVersion(model);
    const checks = currentChecks(workspace);
    const entries: RunEntry[] = [];
    let skipped = 0;
    const sorted = visible
      .filter((item) => item.account.key === account)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
    for (const item of sorted) {
      const current = checks.get(item.id) ?? [];
      const covered = criteria.filter((c) =>
        current.some(
          (check) =>
            check.criterion === c.id &&
            check.source.kind === 'model' &&
            check.source.name === config.name &&
            check.source.version === version,
        ),
      );
      if (covered.length === criteria.length) {
        skipped++;
        continue;
      }
      if (entries.length >= (input.limit ?? Infinity)) continue;
      entries.push({
        itemId: item.id,
        contentHash:
          'sha256:' + createHash('sha256').update(item.text).digest('hex'),
        platform: item.platform === 'instagram' ? 'instagram' : 'x',
        kind: item.kind,
        text: item.text,
        checked: [
          {
            sourceKind: 'model',
            sourceName: config.name,
            version,
            criteria: covered.map(({ id, hash }) => ({ id, hash })),
          },
        ],
      });
    }
    const groups = new Map<string, Set<string>>();
    for (const entry of entries) {
      const missing = criteria.filter(
        (c) => !entry.checked![0]!.criteria.some((value) => value.id === c.id),
      );
      const group = JSON.stringify(missing.map((c) => [c.id, c.hash]));
      const texts = groups.get(group) ?? new Set<string>();
      texts.add(JSON.stringify([entry.platform, entry.kind, entry.text]));
      groups.set(group, texts);
    }
    const plannedRequests = [...groups.values()].reduce(
      (sum, texts) => sum + Math.ceil(texts.size / config.entriesPerRequest),
      0,
    );
    if (!input.dryRun)
      input.progress(
        JSON.stringify({ event: 'planned', planned: plannedRequests }),
      );
    const states = deriveState(workspace);
    const alreadyDecided = entries.filter(
      (entry) => states.get(entry.itemId)?.decision !== 'undecided',
    ).length;
    const checkedElsewhere = entries.filter((entry) =>
      (checks.get(entry.itemId) ?? []).some(
        (check) =>
          check.source.kind !== 'model' ||
          check.source.name !== config.name ||
          check.source.version !== version,
      ),
    ).length;
    const perCriterion = Object.fromEntries(
      criteria.map((criterion) => [
        criterion.id,
        entries.filter(
          (entry) =>
            !entry.checked![0]!.criteria.some(
              (value) => value.id === criterion.id,
            ),
        ).length,
      ]),
    );
    shareScan(
      config,
      input.source,
      entries.length,
      input.progress,
      false,
      Boolean(input.dryRun),
    );
    if (input.dryRun)
      return {
        workspace: { id: workspace.id, revision: snapshot.revision },
        data: {
          dryRun: true,
          plan,
          source: sourceSummary,
          coverageCounted: true,
          coverageModel: model,
          coverageProvisional: !checkMatches,
          entries: {
            planned: entries.length,
            skipped: { currentSource: skipped },
            alreadyDecided,
            checkedElsewhere,
            uniqueTexts: [...groups.values()].reduce((n, g) => n + g.size, 0),
          },
          requests: { planned: plannedRequests },
          criteria: perCriterion,
          batchSize: config.entriesPerRequest,
        },
      };
    const started = Date.now();
    let progress: RunProgress | undefined;
    const hits: Record<string, number> = {};
    const risks: Record<string, number> = {};
    const unclear: Record<string, number> = {};
    let stopDetail: string | null = null;
    let errorCode: keyof typeof CLI_ERRORS | null = null;
    const target = await workspacePath(input.workspace, false);
    store = await SQLiteStore.open(target.path);
    const writer = new LabelService(store, { now: input.now });
    try {
      progress = await runBatches({
        source: source!,
        answeringModel: model,
        confirmedOrigin: origin,
        entries,
        criteria,
        entriesPerRequest: config.entriesPerRequest,
        parallelRequests: config.parallelRequests,
        signal: input.signal,
        progress: (value) => {
          progress = value;
          input.progress(JSON.stringify(value));
        },
        submit: async (file: SourceLabelFile) => {
          const result = await writer.submitSourceLabels(file);
          if (!result.duplicate)
            for (const label of file.labels) {
              risks[label.risk] = (risks[label.risk] ?? 0) + 1;
              if (label.category === 'unclear') {
                const kind = entries.find(
                  (entry) => entry.itemId === label.itemId,
                )!.kind;
                const cause = label.reason.includes('exact quote')
                  ? 'quote'
                  : 'answer';
                unclear[`${kind}:${cause}`] =
                  (unclear[`${kind}:${cause}`] ?? 0) + 1;
              } else if (label.category !== 'harmless')
                hits[label.category] = (hits[label.category] ?? 0) + 1;
            }
        },
      });
    } catch (error) {
      if (error instanceof ScanError) {
        stopDetail = error.code;
        input.progress(
          JSON.stringify({ stopDetail, waitSeconds: error.waitSeconds }),
        );
      }
      try {
        scanFailure(error);
      } catch (failure) {
        if (!(failure instanceof CliError)) throw failure;
        errorCode = failure.code;
        stopDetail ??= failure.code;
      }
    }
    const final = await identity(store);
    return {
      workspace: final,
      ...(errorCode
        ? {
            status: 'partial' as const,
            exitCode: CLI_ERRORS[errorCode].exitCode,
            warnings: [
              errorCode === 'MODEL_CHANGED'
                ? `MODEL_CHANGED: The endpoint answered as ${sourceSummary.answeringModel ?? 'no model'}; you confirmed ${confirmedModel}. This response was not stored; earlier stored suggestions remain.`
                : `${errorCode}: ${CLI_ERRORS[errorCode].message}`,
            ],
          }
        : {}),
      data: {
        dryRun: false,
        plan,
        source: sourceSummary,
        coverageCounted: true,
        coverageModel: model,
        coverageProvisional: false,
        modelCheck: { sent: 1 },
        entries: {
          planned: entries.length,
          skipped: { currentSource: skipped },
          checked: progress?.stored ?? 0,
          alreadyDecided,
          checkedElsewhere,
          remaining: progress?.remaining ?? entries.length,
          uniqueTexts: [...groups.values()].reduce((n, g) => n + g.size, 0),
        },
        requests: {
          planned: plannedRequests,
          sent: progress?.requests ?? 0,
          retried: progress?.retries ?? 0,
          split: progress?.split ?? 0,
          secondPass: progress?.secondPassRequests ?? 0,
          failed: errorCode ? 1 : 0,
        },
        tokens: progress?.tokens ?? null,
        batchSize: progress?.batchSize ?? config.entriesPerRequest,
        hits,
        criteria: perCriterion,
        labelsPerRisk: risks,
        unclear,
        durationMs: Date.now() - started,
        stopDetail,
      },
    };
  } catch (error) {
    scanFailure(error);
  } finally {
    network?.close();
    await store?.close();
  }
}

export const workspaceServices = {
  checkScanSource,
  runScan,
  fetchOriginals,
  importWorkspace,
  summarizeWorkspace,
  exportBackup,
  restoreWorkspace,
  exportClickList,
  nextBatch,
  submitLabelFile,
};
export type WorkspaceServices = typeof workspaceServices;
