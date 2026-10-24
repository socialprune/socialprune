import { lstat, open, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { DialogLocale } from './dialogs.ts';
import { dialogLocale } from './dialogs.ts';

/** Closed language preference, not renderer text or a path capability. */
export async function readLanguage(
  root: string,
  fallback: string,
): Promise<DialogLocale> {
  let file;
  try {
    const path = join(root, 'ui-language.json');
    const before = await lstat(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.size > 64
    )
      return dialogLocale(null, fallback);
    file = await open(path, 'r');
    const current = await file.stat();
    if (
      current.ino !== before.ino ||
      current.dev !== before.dev ||
      current.nlink !== 1
    )
      return dialogLocale(null, fallback);
    const bytes = Buffer.alloc(65),
      { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 64) return dialogLocale(null, fallback);
    const value: unknown = JSON.parse(
      bytes.subarray(0, bytesRead).toString('utf8'),
    );
    return dialogLocale(value, fallback);
  } catch {
    return dialogLocale(null, fallback);
  } finally {
    await file?.close();
  }
}
export async function writeLanguage(
  root: string,
  locale: DialogLocale,
): Promise<void> {
  const temporary = join(root, `.ui-language-${crypto.randomUUID()}.json`);
  try {
    await writeFile(temporary, JSON.stringify(locale), {
      mode: 0o600,
      flag: 'wx',
    });
    // Replace the name atomically rather than following a planted link.
    await rename(temporary, join(root, 'ui-language.json'));
  } finally {
    await rm(temporary, { force: true });
  }
}
