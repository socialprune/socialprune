import { lstat, open, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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
  record: (code: string) => void = () => {},
): Promise<void> {
  const temporary = join(root, `.ui-language-${crypto.randomUUID()}.json`);
  let phase: 'TEMPORARY' | 'REPLACE' = 'TEMPORARY';
  try {
    await writeFile(temporary, JSON.stringify(locale), {
      mode: 0o600,
      flag: 'wx',
    });
    phase = 'REPLACE';
    // A Windows reader can allow reads/writes but deny replacement. Retain the
    // same completed temporary file and retry only sharing/access failures.
    // The 775ms backoff covers the generated 250ms reader regression; six
    // attempts bound a permanent denial. Never unlink/truncate the destination.
    const backoff = [25, 50, 100, 200, 400];
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temporary, join(root, 'ui-language.json'));
        record('LANGUAGE_WRITE_COMMITTED');
        break;
      } catch (error) {
        const code = languageErrorCode(error);
        if (
          process.platform !== 'win32' ||
          !['EPERM', 'EACCES', 'EBUSY'].includes(code) ||
          attempt >= backoff.length
        )
          throw error;
        record(`LANGUAGE_REPLACE_RETRY_${code}`);
        await delay(backoff[attempt]);
      }
    }
  } catch (error) {
    record(`LANGUAGE_WRITE_${phase}_${languageErrorCode(error)}`);
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}

function languageErrorCode(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error ? error.code : null;
  return typeof code === 'string' &&
    [
      'EPERM',
      'EACCES',
      'EBUSY',
      'ENOENT',
      'EEXIST',
      'EISDIR',
      'ENOSPC',
      'EROFS',
    ].includes(code)
    ? code
    : 'OTHER';
}
