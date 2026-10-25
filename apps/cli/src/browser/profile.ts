import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
  open,
} from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { CliError } from '../cli/errors.ts';
import { canonicalProfileDirectory } from '../workspace/profile-path.ts';
export const PROFILE_MARKER = 'socialprune-profile.json';
export async function profileInUse(directory: string): Promise<boolean> {
  const stat = async (name: string) =>
    lstat(join(directory, name)).catch((error: unknown) => {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return null;
      throw new CliError('PROFILE_INVALID');
    });
  // POSIX Chromium owns this symlink until profile shutdown. Never follow or remove it.
  if (await stat('SingletonLock')) return true;
  const lock = await stat('lockfile');
  if (!lock) return false;
  if (!lock.isFile() || lock.isSymbolicLink())
    throw new CliError('PROFILE_INVALID');
  // Windows Chromium's lockfile shares reads, not writes. Probe without truncating.
  try {
    const handle = await open(join(directory, 'lockfile'), 'r+');
    await handle.close();
    return false;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'ENOENT') return false;
      if (['EACCES', 'EPERM', 'EBUSY'].includes(String(error.code)))
        return true;
    }
    throw new CliError('PROFILE_INVALID');
  }
}
export type ProfilePlatform = 'x' | 'instagram';
export async function validateProfile(
  directory: string,
  platform: ProfilePlatform = 'x',
): Promise<void> {
  directory = await canonicalProfileDirectory(directory);
  if (inDefaultProfile(directory)) throw new CliError('PROFILE_INVALID');
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
    marker.platform !== platform ||
    !('version' in marker) ||
    marker.version !== '0.0.0'
  )
    throw new CliError('PROFILE_INVALID');
}
export async function createProfile(
  directory: string,
  platform: ProfilePlatform = 'x',
): Promise<void> {
  const existing = await lstat(directory).catch(() => null);
  if (existing) {
    if (!existing.isDirectory() || existing.isSymbolicLink())
      throw new CliError('PROFILE_INVALID');
    if (platform === 'instagram') throw new CliError('PROFILE_INVALID');
    if ((await readdir(directory)).length) {
      await validateProfile(directory, platform);
      return;
    }
  } else await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, PROFILE_MARKER),
    JSON.stringify({
      platform,
      createdAt: new Date().toISOString(),
      version: '0.0.0',
    }),
    { flag: 'wx' },
  );
}
export function defaultProfileLocations(home = homedir()): string[] {
  return [
    join(home, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
    join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
    join(home, 'Library', 'Application Support', 'Microsoft Edge'),
    join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
    join(home, '.config', 'microsoft-edge'),
    join(home, '.config', 'google-chrome'),
    join(home, '.config', 'chromium'),
  ];
}
/** Path comparisons only; never inspect a normal browser profile. */
export function inDefaultProfile(
  directory: string,
  roots = defaultProfileLocations(),
): boolean {
  return roots.some((root) => {
    const inside = relative(resolve(root), resolve(directory));
    return (
      inside === '' ||
      (!isAbsolute(inside) &&
        inside !== '..' &&
        !inside.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')))
    );
  });
}
/** Explicit Instagram-only adoption. Reads metadata, never Local State contents. */
export async function adoptInstagramProfile(
  directory: string,
  at: string,
  defaultRoots = defaultProfileLocations(),
): Promise<string> {
  const stat = await lstat(directory).catch(() => null);
  if (
    !stat?.isDirectory() ||
    stat.isSymbolicLink() ||
    resolve(directory) !== (await realpath(directory)) ||
    inDefaultProfile(directory, defaultRoots)
  )
    throw new CliError('PROFILE_INVALID');
  if (await lstat(join(directory, PROFILE_MARKER)).catch(() => null))
    throw new CliError('PROFILE_INVALID');
  const state = await lstat(join(directory, 'Local State')).catch(() => null);
  if (
    !state?.isFile() ||
    state.isSymbolicLink() ||
    (await profileInUse(directory))
  )
    throw new CliError('PROFILE_INVALID');
  const marker = join(directory, PROFILE_MARKER);
  await writeFile(
    marker,
    JSON.stringify({ platform: 'instagram', adoptedAt: at, version: '0.0.0' }),
    { flag: 'wx' },
  );
  return marker;
}
export async function profilePlatform(
  directory: string,
): Promise<ProfilePlatform> {
  try {
    await validateProfile(directory);
    return 'x';
  } catch {
    await validateProfile(directory, 'instagram');
    return 'instagram';
  }
}
export interface ProfileSnapshot {
  files: Map<string, string>;
  extensions: number;
  extensionIds: string[];
}
export async function profileSnapshot(
  directory: string,
): Promise<ProfileSnapshot> {
  const files = new Map<string, string>();
  const extensionIds = new Set<string>();
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new CliError('PROFILE_INVALID');
      const name = `${prefix}${entry.name}`;
      const stat = await lstat(join(path, entry.name)).catch(() => null);
      if (!stat) continue;
      if (entry.isDirectory()) {
        if (entry.name === 'Extensions') {
          for (const extension of await readdir(join(path, entry.name), {
            withFileTypes: true,
          })) {
            if (extension.isSymbolicLink())
              throw new CliError('PROFILE_INVALID');
            if (extension.isDirectory()) extensionIds.add(extension.name);
          }
          continue;
        }
        await visit(join(path, entry.name), name + '/');
      } else if (entry.isFile())
        files.set(name, `${stat.size}:${stat.mtimeMs}`);
    }
  }
  await visit(directory, '');
  return {
    files,
    extensions: extensionIds.size,
    extensionIds: [...extensionIds].sort(),
  };
}
export function extensionsChanged(
  before: ProfileSnapshot,
  after: ProfileSnapshot,
): boolean {
  // Edge can remove default folders when extensions are disabled. Only a new
  // ID, including the new side of a replacement, stops the driven run.
  const known = new Set(before.extensionIds);
  return after.extensionIds.some((id) => !known.has(id));
}
export interface ExtensionProfileReport {
  runId: string;
  extensionsDisabled: true;
  extensionIdsBefore: string[];
  extensionIdsAfter: string[];
  extensionIdsRemoved: string[];
  extensionIdsAdded: string[];
  journalReport: unknown;
  abortedHosts?: Record<string, number>;
}
export async function writeExtensionReport(
  profile: string,
  runId: string,
  before: ProfileSnapshot,
  after: ProfileSnapshot,
  journalReport: unknown,
  abortedHosts: Record<string, number> = {},
  platform: ProfilePlatform = 'x',
): Promise<string> {
  if (!/^[A-Za-z0-9-]{1,128}$/.test(runId))
    throw new CliError('PROFILE_INVALID');
  await validateProfile(profile, platform);
  const path = join(profile, `socialprune-readback-${runId}.json`);
  const report: ExtensionProfileReport = {
    runId,
    extensionsDisabled: true,
    extensionIdsBefore: before.extensionIds,
    extensionIdsAfter: after.extensionIds,
    extensionIdsRemoved: before.extensionIds.filter(
      (id) => !after.extensionIds.includes(id),
    ),
    extensionIdsAdded: after.extensionIds.filter(
      (id) => !before.extensionIds.includes(id),
    ),
    journalReport,
    abortedHosts,
  };
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(JSON.stringify(report));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return path;
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
