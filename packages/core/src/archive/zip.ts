import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { ByteArchiveReader, normalizeArchivePath } from './reader.ts';
import type { ArchiveOptions, ArchiveReader, ByteEntry } from './reader.ts';
import {
  ArchiveLimitError,
  combineSignals,
  resolveImportLimits,
  throwIfAborted,
} from './limits.ts';

export interface ZipSource {
  name: string;
  blob: Blob;
}
export async function openZipArchives(
  sources: ZipSource[],
  opts: ArchiveOptions = {},
): Promise<ArchiveReader> {
  const limits = resolveImportLimits(opts.limits);
  const readers: ZipReader<Blob>[] = [];
  const entries: ByteEntry[] = [];
  let rejected = 0;
  let seen = 0;
  try {
    for (const source of sources) {
      throwIfAborted(opts.signal);
      // S3: our own worker runs with script-src 'self' 'wasm-unsafe-eval'
      // and worker-src 'self', without blob:. Do not spawn zip.js workers.
      const zip = new ZipReader(new BlobReader(source.blob), {
        useWebWorkers: false,
        useCompressionStream: true,
        signal: opts.signal,
      });
      readers.push(zip);
      // Keep the raw names long enough to count and drop rejected paths here.
      // No entry is ever extracted to disk, and only normalized paths survive.
      for await (const file of zip.getEntriesGenerator({
        filenameValidation: 'tolerant',
      })) {
        throwIfAborted(opts.signal);
        if (++seen > limits.maxEntries)
          throw new ArchiveLimitError('maxEntries', limits.maxEntries);
        const path = normalizeArchivePath(file.filename);
        if (!path) {
          rejected++;
          continue;
        }
        if (file.directory || file.symlink) continue;
        entries.push({
          entry: { archive: source.name, path, size: file.uncompressedSize },
          open(signal) {
            const cancel = new AbortController();
            const combined = combineSignals(signal, cancel.signal);
            const bridge = new TransformStream<Uint8Array, Uint8Array>();
            const task = file.getData(bridge.writable, {
              signal: combined,
              useWebWorkers: false,
              useCompressionStream: true,
            });
            // Pre-decompression failures (for example an encrypted entry) can
            // occur before zip.js owns the writer. Forward them to the reader
            // instead of leaving its pending read waiting on an open bridge.
            void task.catch(async (error: unknown) => {
              await bridge.writable.abort(error).catch(() => undefined);
            });
            const reader = bridge.readable.getReader();
            return new ReadableStream<Uint8Array>({
              async pull(controller) {
                try {
                  const next = await reader.read();
                  if (next.done) {
                    await task;
                    controller.close();
                    reader.releaseLock();
                  } else controller.enqueue(next.value);
                } catch (error) {
                  controller.error(error);
                }
              },
              async cancel() {
                cancel.abort();
                await reader.cancel().catch(() => undefined);
                await task.catch(() => undefined);
              },
            });
          },
        });
      }
    }
    return new ByteArchiveReader(
      sources.map(({ name }) => name),
      entries,
      rejected,
      opts,
      async () => {
        await Promise.all(readers.map((reader) => reader.close()));
      },
    );
  } catch (error) {
    await Promise.all(readers.map((reader) => reader.close()));
    throw error;
  }
}
