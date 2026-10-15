import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  lstat,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi, beforeEach } from 'vitest';
import {
  adoptInstagramProfile,
  createProfile,
  validateProfile,
  PROFILE_MARKER,
  inDefaultProfile,
  defaultProfileLocations,
} from '../profile.ts';
import { executeCli } from '../../cli/adapter.ts';
import { createNodeContext } from '../../cli/node-context.ts';
import * as profiles from '../profile.ts';
import { CliError } from '../../cli/errors.ts';

const launcher = vi.hoisted(() => vi.fn());
vi.mock('../setup.ts', () => ({ ordinarySetup: launcher }));
beforeEach(() => launcher.mockReset());
test('F3a a missing browser leaves no Instagram setup marker or directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-ig-missing-browser-')),
    directory = join(root, 'profile');
  const browser = vi
    .spyOn(profiles, 'installedBrowser')
    .mockRejectedValue(new CliError('BROWSER_NOT_FOUND'));
  try {
    const context = createNodeContext({ write() {} }, { write() {} });
    expect(
      await executeCli(
        ['browser', 'setup', '--platform', 'instagram', '--profile', directory],
        { ...context, stdoutIsTerminal: true },
      ),
    ).toBe(1);
    expect(await readdir(root)).toEqual([]);
    expect(launcher).not.toHaveBeenCalled();
  } finally {
    browser.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
async function tree(
  directory: string,
): Promise<Record<string, { bytes: string; mtime: number }>> {
  const result: Record<string, { bytes: string; mtime: number }> = {};
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = join(path, entry.name),
        key = prefix + entry.name;
      if (entry.isDirectory()) await visit(full, key + '/');
      else {
        const info = await lstat(full);
        result[key] = {
          bytes: (await readFile(full)).toString('hex'),
          mtime: info.mtimeMs,
        };
      }
    }
  }
  await visit(directory, '');
  return result;
}
test('adoption writes only a timed Instagram marker and never calls the browser launcher', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-ig-adopt-')),
    directory = join(root, 'profile');
  await mkdir(directory);
  await writeFile(
    join(directory, 'Local State'),
    'Generated content never read by adoption',
  );
  await mkdir(join(directory, 'Default'));
  await writeFile(join(directory, 'Default', 'History'), 'Generated history');
  const before = await tree(directory),
    stdout: string[] = [];
  try {
    const code = await executeCli(
      [
        'browser',
        'setup',
        '--platform',
        'instagram',
        '--profile',
        directory,
        '--adopt',
        '--json',
      ],
      createNodeContext({ write: (text) => stdout.push(text) }, { write() {} }),
    );
    expect(code).toBe(0);
    expect(launcher).not.toHaveBeenCalled();
    const marker = JSON.parse(
      await readFile(join(directory, PROFILE_MARKER), 'utf8'),
    ) as { platform: string; adoptedAt: string };
    expect(marker.platform).toBe('instagram');
    expect(Number.isFinite(Date.parse(marker.adoptedAt))).toBe(true);
    const after = await tree(directory);
    delete after[PROFILE_MARKER];
    expect(after).toEqual(before);
    expect(stdout.join('')).toContain(PROFILE_MARKER);
    await validateProfile(directory, 'instagram');
    await expect(validateProfile(directory)).rejects.toMatchObject({
      code: 'PROFILE_INVALID',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test.each([
  'missing',
  'no-state',
  'marked-x',
  'marked-instagram',
  'in-use',
  'junction',
] as const)(
  'adoption refuses %s without changing any bytes or modification time',
  async (variant) => {
    const root = await mkdtemp(join(tmpdir(), 'sp-ig-refuse-')),
      directory = join(root, 'profile');
    if (variant !== 'missing') await mkdir(directory);
    if (!['missing', 'no-state'].includes(variant))
      await writeFile(join(directory, 'Local State'), 'Generated local state');
    if (variant.startsWith('marked'))
      await writeFile(
        join(directory, PROFILE_MARKER),
        JSON.stringify({
          platform: variant === 'marked-x' ? 'x' : 'instagram',
          version: '0.0.0',
        }),
      );
    if (variant === 'in-use')
      await writeFile(
        join(directory, 'SingletonLock'),
        'Generated occupied lock decoy',
      );
    let target = directory;
    if (variant === 'junction') {
      target = join(root, 'link');
      await symlink(
        directory,
        target,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    const before = await tree(root);
    try {
      await expect(
        adoptInstagramProfile(target, '2026-10-15T12:00:00.000Z'),
      ).rejects.toMatchObject({ code: 'PROFILE_INVALID' });
      expect(await tree(root)).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test('default locations are refused by path only; setup refuses existing unmarked Instagram directories and setup orders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-ig-default-'));
  try {
    const roots = defaultProfileLocations(root);
    for (const path of roots) {
      expect(inDefaultProfile(path, roots)).toBe(true);
      expect(inDefaultProfile(join(path, 'Default'), roots)).toBe(true);
      expect(inDefaultProfile(path + '-not-default', roots)).toBe(false);
      await mkdir(path, { recursive: true });
      await writeFile(
        join(path, 'Local State'),
        'Generated default-profile decoy',
      );
      const before = await tree(path);
      await expect(
        adoptInstagramProfile(path, '2026-10-15T12:00:00.000Z', roots),
      ).rejects.toMatchObject({ code: 'PROFILE_INVALID' });
      expect(await tree(path)).toEqual(before);
    }
    await expect(createProfile(root, 'instagram')).rejects.toMatchObject({
      code: 'PROFILE_INVALID',
    });
    for (const platform of ['x', 'instagram']) {
      const output: string[] = [];
      expect(
        await executeCli(
          [
            'browser',
            'setup',
            '--platform',
            platform,
            '--profile',
            root,
            '--order',
            'generated-order',
            '--json',
          ],
          createNodeContext(
            { write: (text) => output.push(text) },
            { write() {} },
          ),
        ),
      ).toBe(2);
      expect(output.join('')).toContain('INVALID_ARGUMENTS');
    }
    expect(launcher).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
