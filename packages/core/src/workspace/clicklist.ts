import type { PlatformAdapter } from '../adapter/index.ts';
import { throwIfAborted } from '../archive/limits.ts';
import {
  ClickListEntrySchema,
  ClickListFormatSchema,
} from './clicklist-schema.ts';
import type {
  ClickListEntry,
  ClickListFormat,
  ClickListSummary,
  ClickListWindow,
} from './clicklist-schema.ts';
import { WorkspaceError } from './errors.ts';
import { QueryEngine, DEFAULT_QUERY_SORT } from './query.ts';
import type { QuerySort } from './protocol.ts';
import type { WorkspaceStore } from './store.ts';
import { dayKey, resolveTimeZone } from './time.ts';

export interface ClickListOpenOptions {
  listId: string;
  accountKey: string;
  /** Explicit flag; omitted uses workspace setting, then the named system zone. */
  timeZone?: string;
  workspaceTimeZone?: string | null;
  systemTimeZone?: string;
  signal?: AbortSignal;
}
export interface ClickListWindowOptions {
  listId: string;
  offset: number;
  limit: number;
  signal?: AbortSignal;
}
export interface ClickListExportOptions {
  listId: string;
  format: ClickListFormat;
  chunkBytes?: number;
  signal?: AbortSignal;
}
interface OpenList {
  listId: string;
  accountKey: string;
  timeZone: string;
  timeZoneSource: 'flag' | 'workspace' | 'system';
  flagTimeZone?: string;
  workspaceTimeZone?: string | null;
  observedWorkspaceTimeZone: string | null;
  systemTimeZone: string;
  queryId: string;
  generation: number;
  summary?: ClickListSummary;
}

/** Fixed export columns; each cell is untrusted and checked before quoting. */
export const CLICK_LIST_CSV_COLUMNS = [
  'account',
  'platform',
  'item_id',
  'kind',
  'created_at',
  'day',
  'time_zone',
  'time_zone_source',
  'action',
  'url',
  'owner_handle',
  'via',
  'outcome',
  'text',
] as const;
const DAY_ORDER: QuerySort = [
  { by: 'createdAt', direction: 'desc' },
  { by: 'id', direction: 'asc' },
];
function csvField(value: string | null): string {
  let text = value ?? '';
  // CWE-1236: neutralize formula prefixes before RFC 4180 field quoting.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[,"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function csvRecord(summary: ClickListSummary, entry: ClickListEntry): string {
  return (
    [
      summary.accountKey,
      entry.platform,
      entry.itemId,
      entry.kind,
      entry.createdAt,
      entry.day,
      summary.timeZone,
      summary.timeZoneSource,
      entry.action,
      entry.url,
      entry.ownerHandle,
      entry.via,
      entry.outcome,
      entry.text,
    ]
      .map(csvField)
      .join(',') + '\r\n'
  );
}

/** Read-only click-list rules shared by browser and CLI; no platform actions. */
export class ClickListService {
  private readonly store: WorkspaceStore;
  private readonly adapters: Map<string, PlatformAdapter>;
  private readonly query: QueryEngine;
  private readonly lists = new Map<string, OpenList>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    store: WorkspaceStore,
    adapters: readonly PlatformAdapter[],
    options: { query?: QueryEngine } = {},
  ) {
    this.store = store;
    this.adapters = new Map();
    for (const adapter of adapters) {
      if (
        this.adapters.has(adapter.platform) ||
        !['risk', 'day'].includes(adapter.clickListOrder)
      )
        throw new WorkspaceError('INVALID_REQUEST');
      this.adapters.set(adapter.platform, adapter);
    }
    this.query = options.query ?? new QueryEngine(store);
  }
  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  open(input: ClickListOpenOptions): Promise<ClickListSummary> {
    return this.serialized(async () => {
      throwIfAborted(input.signal);
      if (
        !input.listId ||
        input.listId.length > 512 ||
        !input.accountKey ||
        input.accountKey.length > 512
      )
        throw new WorkspaceError('INVALID_REQUEST');
      const meta = await this.store.read((tx) => tx.meta.get());
      const systemTimeZone =
        input.systemTimeZone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone;
      const zone = resolveTimeZone(
        input.timeZone,
        input.workspaceTimeZone === undefined
          ? meta.settings.timeZone
          : input.workspaceTimeZone,
        systemTimeZone,
      );
      this.release(input.listId);
      if (this.lists.size >= 4) this.release(this.lists.keys().next().value!);
      const list: OpenList = {
        listId: input.listId,
        accountKey: input.accountKey,
        timeZone: zone.timeZone,
        timeZoneSource: zone.source,
        flagTimeZone: input.timeZone,
        workspaceTimeZone: input.workspaceTimeZone,
        observedWorkspaceTimeZone: meta.settings.timeZone,
        systemTimeZone,
        queryId: `click-list:${input.listId}`,
        generation: 0,
      };
      this.lists.set(input.listId, list);
      try {
        return structuredClone(await this.refresh(list, input.signal));
      } catch (error) {
        this.release(input.listId);
        throw error;
      }
    });
  }
  private list(listId: string): OpenList {
    const list = this.lists.get(listId);
    if (!list) throw new WorkspaceError('QUERY_EXPIRED');
    return list;
  }
  private async refresh(
    list: OpenList,
    signal?: AbortSignal,
  ): Promise<ClickListSummary> {
    for (;;) {
      throwIfAborted(signal);
      // Automatically reopen against current settings on revision refresh. A
      // caller's explicit flag remains authoritative; a cleared setting falls
      // back to the system zone captured when this list was opened.
      const snapshot = await this.store.read(async (tx) => ({
        meta: await tx.meta.get(),
        revision: (await tx.runtime.get()).revision,
      }));
      const meta = snapshot.meta;
      if (meta.settings.timeZone !== list.observedWorkspaceTimeZone) {
        list.workspaceTimeZone = undefined;
        list.observedWorkspaceTimeZone = meta.settings.timeZone;
      }
      const zone = resolveTimeZone(
        list.flagTimeZone,
        list.workspaceTimeZone === undefined
          ? meta.settings.timeZone
          : list.workspaceTimeZone,
        list.systemTimeZone,
      );
      list.timeZone = zone.timeZone;
      list.timeZoneSource = zone.source;
      const platform = await this.query.accountPlatform(list.accountKey);
      const adapter = platform ? this.adapters.get(platform) : undefined;
      if (!adapter) throw new WorkspaceError('INVALID_REQUEST');
      const result = await this.query.query({
        queryId: list.queryId,
        generation: ++list.generation,
        accountKey: list.accountKey,
        filter: { decisions: ['delete'] },
        sort:
          adapter.clickListOrder === 'risk' ? DEFAULT_QUERY_SORT : DAY_ORDER,
        timeZone: list.timeZone,
        signal,
      });
      const revision = this.query.decisionWindow(
        list.queryId,
        list.generation,
        0,
        1,
      ).revision;
      if (revision !== snapshot.revision) continue;
      list.summary = {
        listId: list.listId,
        accountKey: list.accountKey,
        timeZone: list.timeZone,
        timeZoneSource: list.timeZoneSource,
        revision,
        total: result.total,
        counts: {
          deletedByYou: result.counts.outcomes['deleted-by-user'],
          skipped: result.counts.outcomes.skipped,
          left: result.counts.outcomes.unknown,
        },
      };
      return list.summary;
    }
  }
  private async current(
    list: OpenList,
    signal?: AbortSignal,
  ): Promise<ClickListSummary> {
    throwIfAborted(signal);
    const revision = await this.store.read(
      async (tx) => (await tx.runtime.get()).revision,
    );
    if (list.summary?.revision !== revision) return this.refresh(list, signal);
    try {
      this.query.decisionWindow(list.queryId, list.generation, 0, 1);
    } catch (error) {
      if (
        !(error instanceof WorkspaceError) ||
        !['STALE', 'QUERY_EXPIRED'].includes(error.code)
      )
        throw error;
      return this.refresh(list, signal);
    }
    return list.summary;
  }
  window(input: ClickListWindowOptions): Promise<ClickListWindow> {
    return this.serialized(async () => {
      if (
        !Number.isSafeInteger(input.offset) ||
        input.offset < 0 ||
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 200
      )
        throw new WorkspaceError('INVALID_REQUEST');
      const list = this.list(input.listId);
      for (;;) {
        const summary = await this.current(list, input.signal);
        const result = await this.store.read(async (tx) => {
          throwIfAborted(input.signal);
          if ((await tx.runtime.get()).revision !== summary.revision)
            return null;
          const projected = this.query.decisionWindow(
            list.queryId,
            list.generation,
            input.offset,
            input.limit,
          );
          const entries: ClickListEntry[] = [];
          for (const state of projected.entries) {
            throwIfAborted(input.signal);
            const stored = await tx.items.get(state.itemId);
            if (
              !stored ||
              stored.item.account.key !== list.accountKey ||
              state.decision !== 'delete' ||
              !state.via
            )
              throw new WorkspaceError('STALE');
            const item = stored.item;
            const adapter = this.adapters.get(item.platform);
            if (!adapter) throw new WorkspaceError('INVALID_REQUEST');
            const hint = adapter.deletionHint(item);
            entries.push(
              ClickListEntrySchema.parse({
                itemId: item.id,
                platform: item.platform,
                kind: item.kind,
                createdAt: item.createdAt,
                outcome: state.outcome,
                action: hint.action,
                url: hint.url,
                day: dayKey(item.createdAt, list.timeZone),
                text: item.text,
                ownerHandle: item.reference.ownerHandle,
                via: state.via,
              }),
            );
          }
          return {
            ...summary,
            counts: { ...summary.counts },
            offset: input.offset,
            entries,
          };
        });
        if (result) {
          const revision = await this.store.read(
            async (tx) => (await tx.runtime.get()).revision,
          );
          throwIfAborted(input.signal);
          if (revision === result.revision) {
            try {
              if (
                this.query.decisionWindow(list.queryId, list.generation, 0, 1)
                  .revision === result.revision
              )
                return result;
            } catch (error) {
              if (
                !(error instanceof WorkspaceError) ||
                !['STALE', 'QUERY_EXPIRED'].includes(error.code)
              )
                throw error;
            }
          }
        }
      }
    });
  }
  export(input: ClickListExportOptions): AsyncIterable<Uint8Array> {
    return this.exportChunks(input);
  }
  private async *exportChunks(
    input: ClickListExportOptions,
  ): AsyncGenerator<Uint8Array> {
    if (!ClickListFormatSchema.safeParse(input.format).success)
      throw new WorkspaceError('INVALID_REQUEST');
    const chunkBytes = input.chunkBytes ?? 64 * 1024;
    if (
      !Number.isSafeInteger(chunkBytes) ||
      chunkBytes < 1 ||
      chunkBytes > 64 * 1024
    )
      throw new WorkspaceError('INVALID_REQUEST');
    const summary = await this.serialized(async () =>
      structuredClone(
        await this.current(this.list(input.listId), input.signal),
      ),
    );
    const header = {
      accountKey: summary.accountKey,
      timeZone: summary.timeZone,
      timeZoneSource: summary.timeZoneSource,
    };
    const pieces = async function* (service: ClickListService) {
      if (input.format === 'csv')
        yield '\uFEFF' + CLICK_LIST_CSV_COLUMNS.join(',') + '\r\n';
      else yield JSON.stringify(header).slice(0, -1) + ',"entries":[';
      let first = true;
      for (let offset = 0; offset < summary.total; offset += 200) {
        throwIfAborted(input.signal);
        const window = await service.window({
          listId: input.listId,
          offset,
          limit: 200,
          signal: input.signal,
        });
        if (
          window.revision !== summary.revision ||
          window.accountKey !== summary.accountKey ||
          window.timeZone !== summary.timeZone ||
          window.timeZoneSource !== summary.timeZoneSource
        )
          throw new WorkspaceError('STALE');
        for (const entry of window.entries) {
          if (input.format === 'csv') yield csvRecord(summary, entry);
          else {
            yield `${first ? '' : ','}${JSON.stringify(entry)}`;
            first = false;
          }
        }
      }
      const revision = await service.store.read(
        async (tx) => (await tx.runtime.get()).revision,
      );
      throwIfAborted(input.signal);
      if (revision !== summary.revision) throw new WorkspaceError('STALE');
      if (input.format === 'json') yield ']}';
    };
    let buffer = new Uint8Array(chunkBytes),
      used = 0;
    for await (const text of pieces(this)) {
      const bytes = new TextEncoder().encode(text);
      for (let offset = 0; offset < bytes.length;) {
        throwIfAborted(input.signal);
        const length = Math.min(chunkBytes - used, bytes.length - offset);
        buffer.set(bytes.subarray(offset, offset + length), used);
        used += length;
        offset += length;
        if (used === chunkBytes) {
          yield buffer;
          buffer = new Uint8Array(chunkBytes);
          used = 0;
        }
      }
    }
    if (used) yield buffer.slice(0, used);
  }
  release(listId: string): void {
    const list = this.lists.get(listId);
    if (list) this.query.release(list.queryId);
    this.lists.delete(listId);
  }
}
