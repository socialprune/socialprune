import { lstat } from 'node:fs/promises';

// A broken link is still an existing boundary entry. Permission and I/O errors
// must not be mistaken for a fresh or cleared install path.
export async function pathExists(
  path: string,
  inspect: (path: string) => Promise<unknown> = lstat,
): Promise<boolean> {
  try {
    await inspect(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return false;
    throw error;
  }
}
