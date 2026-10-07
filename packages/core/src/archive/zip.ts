import { BlobReader, ZipReader } from '@zip.js/zip.js';
import type { Diagnostic } from '../model/index.ts';
import { ArchiveReadError } from './errors.ts';
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
  const diagnostics: Diagnostic[] = [];
  const reported = new Set<object>();
  let rejected = 0;
  let seen = 0;
  try {
    for (const source of sources) {
      throwIfAborted(opts.signal);
      // ADR-004: our worker policy has script-src/worker-src 'self', no blob:
      // workers or WebAssembly. The web build aliases zip.js to its native
      // entry; Node keeps the default entry. Neither spawns zip.js workers.
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
            const reject = (
              code: 'unsupported-compression' | 'encrypted-entry',
            ) => {
              const error = new ArchiveReadError(code, {
                archive: source.name,
                path,
                size: file.uncompressedSize,
              });
              if (!reported.has(file)) {
                diagnostics.push(error.diagnostic);
                reported.add(file);
              }
              return error;
            };
            if (file.encrypted) throw reject('encrypted-entry');
            if (
              ![0, 8, 9].includes(file.compressionMethod) ||
              (file.compressionMethod === 9 && opts.allowDeflate64 === false)
            )
              throw reject('unsupported-compression');
            const cancel = new AbortController();
            const combined = combineSignals(signal, cancel.signal);
            const bridge = new TransformStream<Uint8Array, Uint8Array>();
            const task = file
              .getData(bridge.writable, {
                signal: combined,
                useWebWorkers: false,
                useCompressionStream: file.compressionMethod !== 9,
                checkSignature: true,
              })
              .catch((error: unknown) => {
                if (
                  file.compressionMethod === 9 &&
                  error instanceof Error &&
                  /unsupported.*compression|compression.*unsupported/i.test(
                    error.message,
                  )
                )
                  throw reject('unsupported-compression');
                throw error;
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
      diagnostics,
    );
  } catch (error) {
    await Promise.all(readers.map((reader) => reader.close()));
    throw error;
  }
}
