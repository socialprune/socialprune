import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import {
  instagramContextFilePath,
  instagramContextFileType,
  INSTAGRAM_IMAGE_MAX_BYTES,
  INSTAGRAM_SCREENSHOT_MAX_BYTES,
} from '../workspace/context-files.ts';

export async function contextMedia(
  workspace: string,
  path: string,
): Promise<{ handle: FileHandle; size: number; contentType: string } | null> {
  const match =
    /^\/context\/instagram\/([A-Za-z0-9_-]{1,64})\/(image\.(?:jpg|png|webp)|shot\.jpg)$/.exec(
      path,
    );
  if (!match) return null;
  const code = match[1]!,
    file = match[2]!;
  let handle: FileHandle | undefined;
  try {
    const store = await SQLiteStore.open(
      join(workspace, 'socialprune.sqlite'),
      { readOnly: true },
    );
    let listed: boolean;
    try {
      listed = await store.read(async (tx) => {
        for await (const record of tx.instagramContext.iterate()) {
          if (
            record.post.code === code &&
            ((record.image.status === 'stored' && record.image.file === file) ||
              (record.screenshot.status === 'stored' &&
                record.screenshot.file === file))
          )
            return true;
        }
        return false;
      });
    } finally {
      await store.close();
    }
    if (!listed) return null;
    const filePath = await instagramContextFilePath(workspace, code, file);
    handle = await open(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const info = await handle.stat();
    // Check the complete chain again after opening, including Windows junctions.
    await instagramContextFilePath(workspace, code, file);
    const current = await lstat(filePath);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.ino !== info.ino ||
      current.dev !== info.dev ||
      info.size >
        (file === 'shot.jpg'
          ? INSTAGRAM_SCREENSHOT_MAX_BYTES
          : INSTAGRAM_IMAGE_MAX_BYTES)
    ) {
      await handle.close();
      return null;
    }
    const bytes = new Uint8Array(12);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const contentType = instagramContextFileType(
      file,
      bytes.subarray(0, bytesRead),
    );
    if (!contentType) {
      await handle.close();
      return null;
    }
    return { handle, size: info.size, contentType };
  } catch {
    await handle?.close();
    return null;
  }
}
