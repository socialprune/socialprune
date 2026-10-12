import { lstat, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { originalDirectory } from '../originals/media.ts';
import { imageExtension } from '../originals/syndication.ts';
import type { ReviewDatabase } from './database.ts';
const types: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
};
export function byteRange(
  range: string | undefined,
  size: number,
  ifRange = false,
): { status: 200 | 206 | 416; start: number; end: number } {
  const all = { status: 200 as const, start: 0, end: Math.max(0, size - 1) };
  if (!range || ifRange) return all;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return all;
  let start: number, end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix === 0)
      return { status: 416, start: 0, end: 0 };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    if (Number.isSafeInteger(start) && start >= size)
      return { status: 416, start: 0, end: 0 };
    end = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end
    )
      return all;
    end = Math.min(end, size - 1);
  }
  if (start >= size) return { status: 416, start: 0, end: 0 };
  return { status: 206, start, end };
}
export async function originalMedia(
  workspace: string,
  path: string,
  database: ReviewDatabase,
): Promise<{ handle: FileHandle; size: number; contentType: string } | null> {
  const match =
    /^\/originals\/(\d{1,40})\/([1-4](?:\.(jpg|png|gif|webp|mp4)|-poster\.(jpg|png|webp)))$/.exec(
      path,
    );
  if (!match) return null;
  const id = match[1]!,
    file = match[2]!,
    extension = match[3] ?? match[4]!;
  const replies = await database.run({
      type: 'getOriginals',
      requestId: crypto.randomUUID(),
      ids: [id],
    }),
    reply = replies.at(-1);
  if (
    reply?.type !== 'originals' ||
    !reply.originals.some(
      (original) =>
        original.id === id &&
        original.media.some(
          (media) =>
            (media.status === 'stored' && media.file === file) ||
            media.poster === file,
        ),
    )
  )
    return null;
  let handle: FileHandle | undefined;
  try {
    const directory = await originalDirectory(workspace, id),
      path = join(directory, file),
      stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    handle = await open(path, 'r');
    const bytes = new Uint8Array(12);
    await handle.read(bytes, 0, 12, 0);
    const contentType = types[extension]!;
    if (
      extension === 'mp4'
        ? Buffer.from(bytes.subarray(4, 8)).toString('ascii') !== 'ftyp'
        : imageExtension(bytes, contentType) !== extension
    ) {
      await handle.close();
      return null;
    }
    return { handle, size: stat.size, contentType };
  } catch {
    await handle?.close();
    return null;
  }
}
