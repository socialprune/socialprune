import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CliError } from '../cli/errors.ts';
export const PROFILE_MARKER = 'socialprune-profile.json';
export async function validateProfile(directory: string): Promise<void> {
  const stat = await lstat(directory).catch(() => null);
  if (
    !stat?.isDirectory() ||
    stat.isSymbolicLink() ||
    resolve(directory) !== (await realpath(directory))
  )
    throw new CliError('PROFILE_INVALID');
  const markerStat = await lstat(join(directory, PROFILE_MARKER)).catch(
    () => null,
  );
  if (!markerStat?.isFile() || markerStat.isSymbolicLink())
    throw new CliError('PROFILE_INVALID');
  let marker: unknown;
  try {
    marker = JSON.parse(
      await readFile(join(directory, PROFILE_MARKER), 'utf8'),
    );
  } catch {
    throw new CliError('PROFILE_INVALID');
  }
  if (
    !marker ||
    typeof marker !== 'object' ||
    !('platform' in marker) ||
    marker.platform !== 'x' ||
    !('version' in marker) ||
    marker.version !== '0.0.0'
  )
    throw new CliError('PROFILE_INVALID');
}
export async function createProfile(directory: string): Promise<void> {
  const existing = await lstat(directory).catch(() => null);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink())
      throw new CliError('PROFILE_INVALID');
    if ((await readdir(directory)).length) {
      await validateProfile(directory);
      return;
    }
  } else await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, PROFILE_MARKER),
    JSON.stringify({
      platform: 'x',
      createdAt: new Date().toISOString(),
      version: '0.0.0',
    }),
    { flag: 'wx' },
  );
}
export interface ProfileSnapshot {
  files: Map<string, string>;
  extensions: number;
}
export async function profileSnapshot(
  directory: string,
): Promise<ProfileSnapshot> {
  const files = new Map<string, string>();
  let extensions = 0;
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new CliError('PROFILE_INVALID');
      const name = `${prefix}${entry.name}`;
      const stat = await lstat(join(path, entry.name)).catch(() => null);
      if (!stat) continue;
      if (entry.isDirectory()) {
        if (prefix === 'Extensions/' || prefix.endsWith('/Extensions/'))
          extensions++;
        await visit(join(path, entry.name), name + '/');
      } else if (entry.isFile())
        files.set(name, `${stat.size}:${stat.mtimeMs}`);
    }
  }
  await visit(directory, '');
  return { files, extensions };
}
export function changedProfileFiles(
  before: ProfileSnapshot,
  after: ProfileSnapshot,
): string[] {
  return [...new Set([...before.files.keys(), ...after.files.keys()])]
    .filter((name) => before.files.get(name) !== after.files.get(name))
    .sort();
}
export async function installedBrowser(
  browser?: 'chrome' | 'edge',
): Promise<string> {
  const locations =
    process.platform === 'win32'
      ? {
          chrome: [
            'C:/Program Files/Google/Chrome/Application/chrome.exe',
            'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          ],
          edge: [
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
            'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
          ],
        }
      : process.platform === 'darwin'
        ? {
            chrome: [
              '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            ],
            edge: [
              '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            ],
          }
        : {
            chrome: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
            edge: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
          };
  for (const kind of browser ? [browser] : (['chrome', 'edge'] as const))
    for (const path of locations[kind])
      if ((await lstat(path).catch(() => null))?.isFile()) return path;
  throw new CliError('BROWSER_NOT_FOUND');
}
