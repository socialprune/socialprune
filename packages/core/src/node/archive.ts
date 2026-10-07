import { openAsBlob, createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { ByteArchiveReader, normalizeArchivePath } from '../archive/reader.ts';
import type {
  ArchiveOptions,
  ArchiveReader,
  ByteEntry,
} from '../archive/reader.ts';
import {
  ArchiveLimitError,
  resolveImportLimits,
  throwIfAborted,
} from '../archive/limits.ts';
import { openZipArchives } from '../archive/zip.ts';

export async function openArchivePaths(
  paths: string[],
  opts: ArchiveOptions = {},
): Promise<ArchiveReader> {
  const limits = resolveImportLimits(opts.limits);
  const readers: ArchiveReader[] = [];
  let total = 0;
  try {
    for (const path of paths) {
      throwIfAborted(opts.signal);
      const root = resolve(path);
      const stat = await lstat(root);
      if (stat.isSymbolicLink())
        throw new TypeError('Archive paths cannot be symbolic links.');
      if (stat.isDirectory()) {
        const entries: ByteEntry[] = [];
        let rejected = 0;
        const name = basename(root);
        const walk = async (directory: string, prefix = ''): Promise<void> => {
          for (const child of (
            await readdir(directory, { withFileTypes: true })
          ).sort((a, b) => (a.name < b.name ? -1 : 1))) {
            throwIfAborted(opts.signal);
            if (child.isSymbolicLink()) {
              rejected++;
              continue;
            }
            const diskPath = join(directory, child.name);
            const relative = prefix ? `${prefix}/${child.name}` : child.name;
            if (child.isDirectory()) await walk(diskPath, relative);
            else if (child.isFile()) {
              if (++total > limits.maxEntries)
                throw new ArchiveLimitError('maxEntries', limits.maxEntries);
              const normalized = normalizeArchivePath(relative);
              if (!normalized) {
                rejected++;
                continue;
              }
              entries.push({
                entry: {
                  archive: name,
                  path: normalized,
                  size: (await lstat(diskPath)).size,
                },
                open(signal) {
                  return Readable.toWeb(
                    createReadStream(diskPath, {
                      signal,
                      highWaterMark: opts.chunkSize ?? 64 * 1024,
                    }),
                  ) as ReadableStream<Uint8Array>;
                },
              });
            }
          }
        };
        await walk(root);
        readers.push(new ByteArchiveReader([name], entries, rejected, opts));
      } else if (stat.isFile() && /\.zip$/i.test(root)) {
        const reader = await openZipArchives(
          [{ name: basename(root), blob: await openAsBlob(root) }],
          {
            ...opts,
            limits: { ...limits, maxEntries: limits.maxEntries - total },
          },
        );
        total += reader.list().length + reader.rejectedEntries;
        readers.push(reader);
      } else throw new TypeError('Expected a ZIP file or directory.');
    }
    const owners = new Map(
      readers.flatMap((reader) =>
        reader.list().map((entry) => [entry, reader] as const),
      ),
    );
    return {
      archives: readers.flatMap((reader) => [...reader.archives]),
      rejectedEntries: readers.reduce(
        (sum, reader) => sum + reader.rejectedEntries,
        0,
      ),
      list: () => [...owners.keys()],
      get diagnostics() {
        return readers.flatMap((reader) => reader.diagnostics ?? []);
      },
      readText(entry, options) {
        const owner = owners.get(entry);
        if (!owner) throw new TypeError('Unknown archive entry.');
        return owner.readText(entry, options);
      },
      streamText(entry, options) {
        const owner = owners.get(entry);
        if (!owner) throw new TypeError('Unknown archive entry.');
        return owner.streamText(entry, options);
      },
      async close() {
        await Promise.all(readers.map((reader) => reader.close()));
      },
    };
  } catch (error) {
    await Promise.all(readers.map((reader) => reader.close()));
    throw error;
  }
}
