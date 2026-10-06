import type { PlatformAdapter } from '../adapter/index.ts';
import type { ArchiveReader, ImportLimits } from '../archive/index.ts';
import {
  abortable,
  resolveImportLimits,
  throwIfAborted,
} from '../archive/limits.ts';
import {
  AccountSchema,
  DiagnosticSchema,
  ImportRecordSchema,
  ItemSchema,
  UtcTimestampSchema,
} from '../model/index.ts';
import type { Diagnostic, ImportRecord, Item } from '../model/index.ts';

export const EXIT_CODES = Object.freeze({
  ok: 0,
  error: 1,
  usage: 2,
  unknownFormat: 3,
  partial: 4,
});
export interface ImportSummary {
  status: 'ok' | 'partial' | 'unknown-format' | 'html-export';
  records: ImportRecord[];
}
export function importExitCode(status: ImportSummary['status']): number {
  return status === 'unknown-format'
    ? EXIT_CODES.unknownFormat
    : status === 'html-export'
      ? EXIT_CODES.error
      : EXIT_CODES[status];
}
export async function stableId(parts: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
export interface ImportOptions {
  signal?: AbortSignal;
  limits?: Partial<ImportLimits>;
  batchSize?: number;
  onProgress?(progress: { items: number }): void;
  onItems?(batch: Item[]): void | Promise<void>;
  now?(): Date;
}
export async function importArchive(
  archive: ArchiveReader,
  adapters: readonly PlatformAdapter[],
  opts: ImportOptions = {},
): Promise<ImportSummary> {
  const limits = resolveImportLimits(opts.limits);
  const batchSize = opts.batchSize ?? 1000;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1)
    throw new RangeError('Invalid item batch size.');
  const now = () => (opts.now ? opts.now() : new Date());
  const detections = [];
  for (const adapter of adapters) {
    throwIfAborted(opts.signal);
    detections.push({
      adapter,
      detection: await abortable(adapter.detect(archive), opts.signal),
    });
  }
  const matches = detections.filter(
    ({ detection }) => detection.result === 'match',
  );
  if (!matches.length)
    return {
      status: detections.some(
        ({ detection }) => detection.result === 'html-export',
      )
        ? 'html-export'
        : 'unknown-format',
      records: [],
    };
  const records: ImportRecord[] = [];
  let totalItems = 0;
  for (const { adapter, detection } of matches) {
    const importedAt = now().toISOString();
    const diagnostics: Diagnostic[] = [];
    const accounts = new Map<string, ReturnType<typeof AccountSchema.parse>>();
    const ids = new Set<string>();
    let duplicates = 0;
    let invalid = 0;
    let exportCreatedAt: string | null = null;
    let batch: Item[] = [];
    let consumerFailed = false;
    const flush = async () => {
      if (!batch.length) return;
      throwIfAborted(opts.signal);
      const current = batch;
      batch = [];
      try {
        await opts.onItems?.(current);
        opts.onProgress?.({ items: totalItems });
      } catch (error) {
        consumerFailed = true;
        throw error;
      }
      throwIfAborted(opts.signal);
    };
    const iterator = adapter
      .parse(archive, { signal: opts.signal, limits, now })
      [Symbol.asyncIterator]();
    try {
      for (;;) {
        const event = await abortable(iterator.next(), opts.signal);
        throwIfAborted(opts.signal);
        if (event.done) break;
        const value = event.value;
        if (value.type === 'item') {
          const parsed = ItemSchema.safeParse(value.item);
          if (!parsed.success || parsed.data.platform !== adapter.platform) {
            invalid++;
            continue;
          }
          if (ids.has(parsed.data.id)) {
            duplicates++;
            continue;
          }
          ids.add(parsed.data.id);
          accounts.set(
            parsed.data.account.key,
            accounts.get(parsed.data.account.key) ?? parsed.data.account,
          );
          batch.push(parsed.data);
          totalItems++;
          if (batch.length === batchSize) await flush();
        } else if (value.type === 'account') {
          const parsed = AccountSchema.safeParse(value.account);
          if (!parsed.success) {
            invalid++;
            continue;
          }
          accounts.set(
            parsed.data.key,
            accounts.get(parsed.data.key) ?? parsed.data,
          );
        } else if (value.type === 'diagnostic') {
          const parsed = DiagnosticSchema.safeParse(value.diagnostic);
          if (!parsed.success) invalid++;
          else diagnostics.push(parsed.data);
        } else if (value.type === 'meta') {
          const parsed = UtcTimestampSchema.nullable().safeParse(
            value.exportCreatedAt,
          );
          if (!parsed.success) invalid++;
          else exportCreatedAt = parsed.data;
        }
      }
    } catch (error) {
      throwIfAborted(opts.signal);
      if (consumerFailed) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw error;
      diagnostics.push({
        category: 'adapter',
        status: 'unreadable',
        files: [],
        count: 0,
        message: 'Adapter parsing failed.',
      });
    } finally {
      const cleanup = iterator.return?.();
      if (opts.signal?.aborted) void cleanup?.catch(() => undefined);
      else await cleanup;
    }
    await flush();
    if (invalid)
      diagnostics.push({
        category: 'invalid-items',
        status: 'unreadable',
        files: [],
        count: invalid,
        message: 'Adapter emitted invalid data.',
      });
    if (duplicates)
      diagnostics.push({
        category: 'duplicate-items',
        status: 'skipped',
        files: [],
        count: duplicates,
        message: 'Duplicate item IDs were omitted.',
      });
    records.push(
      ImportRecordSchema.parse({
        id: `${adapter.platform}:${await stableId([adapter.name, importedAt, ...archive.archives])}`,
        platform: adapter.platform,
        importedAt,
        archives: [...archive.archives],
        exportCreatedAt,
        accounts: [...accounts.values()],
        adapter: { name: adapter.name, version: adapter.version },
        variant: detection.variant,
        diagnostics,
        itemCount: ids.size,
      }),
    );
  }
  return {
    status: records.some((record) =>
      record.diagnostics.some(({ status }) => status === 'unreadable'),
    )
      ? 'partial'
      : 'ok',
    records,
  };
}
