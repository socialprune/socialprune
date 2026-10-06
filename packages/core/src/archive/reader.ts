import {
  abortable,
  combineSignals,
  resolveImportLimits,
  throwIfAborted,
  ArchiveLimitError,
} from './limits.ts';
import type { ImportLimits } from './limits.ts';

export interface ArchiveEntry {
  readonly archive: string;
  readonly path: string;
  readonly size: number;
}
export interface ArchiveReader {
  readonly archives: readonly string[];
  readonly rejectedEntries: number;
  list(): readonly ArchiveEntry[];
  readText(
    entry: ArchiveEntry,
    opts?: { signal?: AbortSignal; maxBytes?: number },
  ): Promise<string>;
  streamText(
    entry: ArchiveEntry,
    opts?: { signal?: AbortSignal },
  ): AsyncIterable<string>;
  close(): Promise<void>;
}
export interface ArchiveOptions {
  signal?: AbortSignal;
  limits?: Partial<ImportLimits>;
  chunkSize?: number;
}
export interface ByteEntry {
  entry: ArchiveEntry;
  open(signal: AbortSignal): ReadableStream<Uint8Array>;
}
export function normalizeArchivePath(path: string): string | null {
  const normalized = path.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..'))
    return null;
  const trimmed = normalized.replace(/^(?:\.\/)+/, '');
  if (!trimmed || /^[A-Za-z]:/.test(trimmed) || trimmed.includes('\0'))
    return null;
  return (
    trimmed
      .split('/')
      .filter((part) => part !== '' && part !== '.')
      .join('/') || null
  );
}

// Internal byte-source bridge shared by Blob-backed ZIPs and Node directories.
export class ByteArchiveReader implements ArchiveReader {
  readonly archives: readonly string[];
  readonly rejectedEntries: number;
  private readonly sources: Map<ArchiveEntry, ByteEntry>;
  private readonly entries: readonly ArchiveEntry[];
  private readonly limits: ImportLimits;
  private readonly controller = new AbortController();
  private readonly active = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  private readonly signal: AbortSignal;
  private readonly dispose: () => Promise<void>;
  constructor(
    archives: readonly string[],
    entries: ByteEntry[],
    rejectedEntries: number,
    opts: ArchiveOptions = {},
    dispose: () => Promise<void> = async () => {},
  ) {
    this.dispose = dispose;
    this.archives = Object.freeze([...archives]);
    this.rejectedEntries = rejectedEntries;
    this.entries = Object.freeze(
      entries.map(({ entry }) => Object.freeze(entry)),
    );
    this.sources = new Map(entries.map((source) => [source.entry, source]));
    this.limits = resolveImportLimits(opts.limits);
    this.signal = combineSignals(opts.signal, this.controller.signal);
    if (entries.length > this.limits.maxEntries)
      throw new ArchiveLimitError('maxEntries', this.limits.maxEntries);
  }
  list(): readonly ArchiveEntry[] {
    return this.entries;
  }
  async readText(
    entry: ArchiveEntry,
    opts: { signal?: AbortSignal; maxBytes?: number } = {},
  ): Promise<string> {
    const maximum = opts.maxBytes ?? this.limits.maxTextBytes;
    if (!Number.isSafeInteger(maximum) || maximum < 0)
      throw new RangeError('Invalid text byte limit.');
    const chunks: string[] = [];
    for await (const chunk of this.decode(
      entry,
      maximum,
      'maxTextBytes',
      opts.signal,
    ))
      chunks.push(chunk);
    return chunks.join('');
  }
  streamText(
    entry: ArchiveEntry,
    opts: { signal?: AbortSignal } = {},
  ): AsyncIterable<string> {
    return this.decode(
      entry,
      this.limits.maxStreamBytes,
      'maxStreamBytes',
      opts.signal,
    );
  }
  private async *decode(
    entry: ArchiveEntry,
    maximum: number,
    limit: keyof ImportLimits,
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const combined = combineSignals(this.signal, signal);
    throwIfAborted(combined);
    const source = this.sources.get(entry);
    if (!source)
      throw new TypeError('Entry does not belong to this archive reader.');
    const reader = source.open(combined).getReader();
    this.active.add(reader);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let total = 0;
    try {
      for (;;) {
        const result = await abortable(reader.read(), combined);
        throwIfAborted(combined);
        if (result.done) break;
        total += result.value.byteLength;
        if (total > maximum) throw new ArchiveLimitError(limit, maximum);
        const text = decoder.decode(result.value, { stream: true });
        if (text) yield text;
      }
      const tail = decoder.decode();
      if (tail) yield tail;
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      this.active.delete(reader);
    }
  }
  async close(): Promise<void> {
    this.controller.abort();
    await Promise.all(
      [...this.active].map((reader) => reader.cancel().catch(() => undefined)),
    );
    await this.dispose();
  }
}

export function createMemoryArchive(
  name: string,
  files: Record<string, string | Uint8Array>,
  opts: ArchiveOptions = {},
): ArchiveReader {
  const chunkSize = opts.chunkSize ?? 64 * 1024;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1)
    throw new RangeError('Invalid chunk size.');
  const entries: ByteEntry[] = [];
  const limits = resolveImportLimits(opts.limits);
  let rejected = 0;
  let seen = 0;
  for (const [path, value] of Object.entries(files)) {
    throwIfAborted(opts.signal);
    if (++seen > limits.maxEntries)
      throw new ArchiveLimitError('maxEntries', limits.maxEntries);
    const normalized = normalizeArchivePath(path);
    if (!normalized) {
      rejected++;
      continue;
    }
    if (path.endsWith('/') || path.endsWith('\\')) continue;
    const bytes =
      typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value.slice();
    entries.push({
      entry: { archive: name, path: normalized, size: bytes.byteLength },
      open(signal) {
        let offset = 0;
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            throwIfAborted(signal);
            if (offset >= bytes.length) {
              controller.close();
              return;
            }
            controller.enqueue(bytes.subarray(offset, offset + chunkSize));
            offset += chunkSize;
          },
        });
      },
    });
  }
  return new ByteArchiveReader([name], entries, rejected, opts);
}
