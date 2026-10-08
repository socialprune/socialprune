import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CliError } from '../cli/errors.ts';

export const DATABASE_NAME = 'socialprune.sqlite';

export async function workspacePath(
  directory: string,
  create: boolean,
  dryRun = false,
): Promise<{ path: string; exists: boolean }> {
  const path = join(directory, DATABASE_NAME);
  const folder = await lstat(directory).catch(() => null);
  if (folder && (!folder.isDirectory() || folder.isSymbolicLink()))
    throw new CliError('MISSING_WORKSPACE');
  const stat = folder ? await lstat(path).catch(() => null) : null;
  if (stat && (!stat.isFile() || stat.isSymbolicLink()))
    throw new CliError('MISSING_WORKSPACE');
  if (!stat) {
    if (!create || (folder && (await readdir(directory)).length))
      throw new CliError('MISSING_WORKSPACE');
    if (!dryRun) await mkdir(directory, { recursive: true });
  }
  return { path, exists: Boolean(stat) };
}

export async function validateArchivePaths(
  paths: readonly string[],
): Promise<void> {
  for (const path of paths) {
    const stat = await lstat(path).catch(() => null);
    if (
      !stat ||
      stat.isSymbolicLink() ||
      (!stat.isDirectory() && !(stat.isFile() && /\.zip$/i.test(path)))
    )
      throw new CliError('INVALID_ARCHIVE_PATH');
  }
}

export async function assertOutput(
  path: string,
  workspace: string,
): Promise<void> {
  const parent = await lstat(dirname(path)).catch(() => null);
  const stat = await lstat(path).catch(() => null);
  // Never replace workspace internals or a source under an accidental --out.
  const output = resolve(path);
  const directory = resolve(workspace);
  if (
    !parent?.isDirectory() ||
    parent.isSymbolicLink() ||
    (stat && (!stat.isFile() || stat.isSymbolicLink())) ||
    output === resolve(directory, DATABASE_NAME) ||
    (dirname(output) === directory &&
      /\.sqlite(?:-(?:journal|wal|shm))?$/i.test(output))
  )
    throw new CliError('IO_ERROR');
}

export function fileChunks(
  path: string,
  signal: AbortSignal,
): AsyncIterable<Uint8Array> {
  return createReadStream(path, { highWaterMark: 64 * 1024, signal });
}

export function fileError(error: unknown): CliError {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined;
  return new CliError(code === 'ENOSPC' ? 'STORAGE_FULL' : 'IO_ERROR');
}

/** Close and flush the temporary file before publishing it under the named path. */
export async function writeChunks(
  path: string,
  chunks: AsyncIterable<Uint8Array>,
  signal: AbortSignal,
): Promise<number> {
  const temporary = join(
    dirname(path),
    `.socialprune-output-${crypto.randomUUID()}.tmp`,
  );
  let handle;
  let bytes = 0;
  try {
    handle = await open(temporary, 'wx');
    for await (const chunk of chunks) {
      signal.throwIfAborted();
      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = await handle.write(
          chunk,
          offset,
          chunk.byteLength - offset,
        );
        if (!written.bytesWritten) throw new CliError('IO_ERROR');
        offset += written.bytesWritten;
      }
      bytes += chunk.byteLength;
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    signal.throwIfAborted();
    await rename(temporary, path);
    return bytes;
  } catch (error) {
    if (error instanceof CliError || signal.aborted) throw error;
    // Generator validation failures keep their symbolic core error for the caller.
    if (error instanceof Error && error.name === 'WorkspaceError') throw error;
    throw fileError(error);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}
