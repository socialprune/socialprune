import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { originalDirectory } from '../originals/media.ts';
import { imageExtension, MAX_PHOTO_BYTES } from '../originals/syndication.ts';
import type { ReviewDatabase } from './database.ts';

const types: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};
export async function originalMedia(
  workspace: string,
  path: string,
  database: ReviewDatabase,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  // Route captures become IDs/basenames only after this exact grammar check.
  // No URL decoding, traversal, arbitrary workspace file or external fallback.
  const match =
    /^\/originals\/([0-9]{1,40})\/([1-4]\.(jpg|png|gif|webp))$/.exec(path);
  if (!match) return null;
  const id = match[1]!,
    file = match[2]!,
    extension = match[3]!;
  const replies = await database.run({
    type: 'getOriginals',
    requestId: crypto.randomUUID(),
    ids: [id],
  });
  const reply = replies.at(-1);
  if (
    reply?.type !== 'originals' ||
    !reply.originals.some(
      (original) =>
        original.id === id &&
        original.photos.some(
          (photo) => photo.status === 'stored' && photo.file === file,
        ),
    )
  )
    return null;
  try {
    const directory = await originalDirectory(workspace, id);
    const target = join(directory, file);
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PHOTO_BYTES)
      return null;
    const bytes = await readFile(target);
    const contentType = types[extension]!;
    if (imageExtension(bytes, contentType) !== extension) return null;
    return { bytes, contentType };
  } catch {
    return null;
  }
}
