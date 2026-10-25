import { lstat, realpath } from 'node:fs/promises';
import { parse, resolve, join } from 'node:path';
import { CliError } from '../cli/errors.ts';

/** Canonicalize Windows aliases after refusing link-bearing components.
 * resolve/realpath inequality alone cannot distinguish an 8.3 alias from a link. */
export async function canonicalProfileDirectory(
  input: string,
): Promise<string> {
  const full = resolve(input),
    root = parse(full).root;
  let cursor = root;
  for (const component of full
    .slice(root.length)
    .split(/[\\/]/)
    .filter(Boolean)) {
    cursor = join(cursor, component);
    const info = await lstat(cursor).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink())
      throw new CliError('PROFILE_INVALID');
  }
  const canonical = await realpath(full);
  if (process.platform !== 'win32' && full !== canonical)
    throw new CliError('PROFILE_INVALID');
  const [spelled, actual] = await Promise.all([lstat(full), lstat(canonical)]);
  if (
    spelled.isSymbolicLink() ||
    actual.isSymbolicLink() ||
    spelled.dev !== actual.dev ||
    spelled.ino !== actual.ino
  )
    throw new CliError('PROFILE_INVALID');
  return canonical;
}
