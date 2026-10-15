import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { InstagramPostCodeSchema } from '@socialprune/core';
import { CliError } from '../cli/errors.ts';

export const INSTAGRAM_CONTEXT_FILES = [
  'image.jpg',
  'image.png',
  'image.webp',
  'shot.jpg',
] as const;
export type InstagramContextFile = (typeof INSTAGRAM_CONTEXT_FILES)[number];
export const INSTAGRAM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const INSTAGRAM_SCREENSHOT_MAX_BYTES = 400_000;

export function instagramContextFileName(
  value: string,
): value is InstagramContextFile {
  return INSTAGRAM_CONTEXT_FILES.some((file) => file === value);
}
export function instagramContextDirectory(
  workspace: string,
  code: string,
): string {
  const parsed = InstagramPostCodeSchema.parse(code);
  return join(
    resolve(workspace),
    'context',
    'instagram',
    Buffer.from(parsed, 'utf8').toString('hex'),
  );
}
export function instagramContextFileType(
  file: string,
  bytes: Uint8Array,
): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (!instagramContextFileName(file)) return null;
  if (
    file.endsWith('.jpg') &&
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return 'image/jpeg';
  if (
    file === 'image.png' &&
    bytes.length >= 8 &&
    Buffer.from(bytes.subarray(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    )
  )
    return 'image/png';
  if (
    file === 'image.webp' &&
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** No creation, no link traversal. Reused by writers and the authenticated media route. */
export async function instagramContextFilePath(
  workspace: string,
  code: string,
  file: string,
): Promise<string> {
  if (!instagramContextFileName(file)) throw new Error('INVALID_CONTEXT_FILE');
  const root = await realpath(workspace),
    directory = instagramContextDirectory(root, code);
  const path = join(directory, file),
    inside = relative(root, path);
  if (isAbsolute(inside) || inside.startsWith('..'))
    throw new Error('INVALID_CONTEXT_FILE');
  let current = root;
  for (const segment of relative(root, directory).split(/[\\/]/)) {
    current = join(current, segment);
    const info = await lstat(current).catch((error: unknown) => {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return null;
      throw error;
    });
    if (info && (!info.isDirectory() || info.isSymbolicLink()))
      throw new Error('INVALID_CONTEXT_FILE');
  }
  const info = await lstat(path).catch((error: unknown) => {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return null;
    throw error;
  });
  if (info && (!info.isFile() || info.isSymbolicLink()))
    throw new Error('INVALID_CONTEXT_FILE');
  return path;
}

export async function instagramContextFileSummary(
  workspace: string,
): Promise<{ files: number; bytes: number }> {
  const root = join(resolve(workspace), 'context', 'instagram');
  let current = resolve(workspace);
  for (const segment of ['context', 'instagram']) {
    current = join(current, segment);
    const info = await lstat(current).catch((error: unknown) => {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return null;
      throw error;
    });
    if (!info) return { files: 0, bytes: 0 };
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new CliError('BACKUP_FAILED');
  }
  let files = 0,
    bytes = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      !/^(?:[0-9a-f]{2}){1,64}$/.test(entry.name)
    )
      continue;
    for (const name of await readdir(join(root, entry.name))) {
      if (!instagramContextFileName(name)) continue;
      const info = await lstat(join(root, entry.name, name));
      if (info.isFile() && !info.isSymbolicLink()) {
        files++;
        bytes += info.size;
      }
    }
  }
  return { files, bytes };
}
