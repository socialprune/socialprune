import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createProfile } from '../browser/profile.ts';
import {
  X_WARNING_FILE,
  clearXWarningFile,
  readXWarningFile,
  requireXWarningFileClear,
  writeXWarningFile,
} from './x-warning-file.ts';

const { rename } = vi.hoisted(() => ({ rename: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: rename.mockImplementation(actual.rename) };
});
afterEach(() => vi.clearAllMocks());

const warning = {
  runId: 'generated-warning',
  kind: 'http-429' as const,
  day: '2026-10-11',
  zone: 'UTC',
  createdAt: '2026-10-11T12:00:00.000Z',
};
const uuid = '12345678-1234-4234-9234-123456789abc';
const deadPart = `.socialprune-x-warning-2147483647-${uuid}.part`;

test.each(['run', 'acknowledgement'] as const)(
  'D8 %s removes a positively dead warning temp but preserves the real gate',
  async (entry) => {
    const directory = await mkdtemp(join(tmpdir(), 'sp-d8-warning-temp-'));
    try {
      await createProfile(directory);
      await writeXWarningFile(directory, warning);
      const real = await readFile(join(directory, X_WARNING_FILE), 'utf8');
      await writeFile(join(directory, deadPart), '{"incomplete":');
      const probe = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('Generated dead writer'), {
          code: 'ESRCH',
        });
      });
      try {
        if (entry === 'run') {
          await expect(
            requireXWarningFileClear(
              directory,
              '2026-10-13T12:00:00.000Z',
              'UTC',
            ),
          ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
        } else {
          await expect(
            clearXWarningFile(directory, 'wrong-run'),
          ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
        }
        expect(probe).toHaveBeenCalledWith(2147483647, 0);
      } finally {
        probe.mockRestore();
      }
      expect(await readFile(join(directory, X_WARNING_FILE), 'utf8')).toBe(
        real,
      );
      expect(await readdir(directory)).not.toContain(deadPart);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('D8 orphan bytes are never a gate copy, and live, unknown and legacy temp files are untouched', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-d8-warning-ignore-'));
  const names = [
    deadPart,
    `.socialprune-x-warning-${process.pid}-${uuid}.part`,
    `.socialprune-x-warning-2147483646-${uuid}.part`,
    `.socialprune-x-warning-${uuid}.part`,
    '.socialprune-x-warning-not-owned.part',
  ];
  try {
    await createProfile(directory);
    for (const name of names)
      await writeFile(join(directory, name), JSON.stringify(warning));
    const probe = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid === 2147483647)
        throw Object.assign(new Error('Generated dead writer'), {
          code: 'ESRCH',
        });
      if (pid === 2147483646)
        throw Object.assign(new Error('Generated unknown writer'), {
          code: 'EPERM',
        });
      return true;
    });
    try {
      await expect(
        requireXWarningFileClear(directory, '2026-10-13T12:00:00.000Z', 'UTC'),
      ).resolves.toBeUndefined();
      expect(await readXWarningFile(directory)).toBeNull();
    } finally {
      probe.mockRestore();
    }
    expect(
      await lstat(join(directory, X_WARNING_FILE)).catch(() => null),
    ).toBeNull();
    expect(await readdir(directory)).not.toContain(deadPart);
    for (const name of names.slice(1))
      expect(await readFile(join(directory, name), 'utf8')).toBe(
        JSON.stringify(warning),
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('D8 a failed atomic rename removes its own temp and preserves the original gate bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-d8-warning-rename-'));
  try {
    await createProfile(directory);
    await writeXWarningFile(directory, warning);
    const before = await readFile(join(directory, X_WARNING_FILE), 'utf8');
    const failure = Object.assign(new Error('Generated rename failure'), {
      code: 'EPERM',
    });
    rename.mockRejectedValueOnce(failure);
    await expect(
      writeXWarningFile(directory, {
        ...warning,
        runId: 'new-warning',
        day: '2026-10-12',
        createdAt: '2026-10-12T12:00:00.000Z',
      }),
    ).rejects.toBe(failure);
    expect(await readFile(join(directory, X_WARNING_FILE), 'utf8')).toBe(
      before,
    );
    expect(await readdir(directory)).toEqual(
      expect.arrayContaining(['socialprune-profile.json', X_WARNING_FILE]),
    );
    expect(
      (await readdir(directory)).filter((name) => name.endsWith('.part')),
    ).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('D8 temp cleanup never follows a planted directory link or removes its target gate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-d8-warning-link-'));
  const profile = join(root, 'profile');
  const target = join(root, 'target');
  try {
    await createProfile(profile);
    await createProfile(target);
    await writeXWarningFile(target, warning);
    const before = await readFile(join(target, X_WARNING_FILE), 'utf8');
    await symlink(
      target,
      join(profile, deadPart),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const probe = vi.spyOn(process, 'kill');
    try {
      expect(await readXWarningFile(profile)).toBeNull();
      expect(probe).not.toHaveBeenCalled();
    } finally {
      probe.mockRestore();
    }
    expect((await lstat(join(profile, deadPart))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(target, X_WARNING_FILE), 'utf8')).toBe(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
