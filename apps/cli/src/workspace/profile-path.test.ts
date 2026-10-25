import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import {
  createProfile,
  validateProfile,
  inDefaultProfile,
} from '../browser/profile.ts';
import {
  readXWarningFile,
  writeXWarningFile,
  requireXWarningFileClear,
  X_WARNING_FILE,
} from './x-warning-file.ts';

test.skipIf(process.platform !== 'win32')(
  'D11 actual Windows short alias, case and dotted spellings retain the same validated warning profile',
  async (ctx) => {
    const root = await mkdtemp(join(tmpdir(), 'sp-d11-long-profile-'));
    try {
      await createProfile(root);
      const short = execFileSync(
        'cmd.exe',
        ['/d', '/c', `for %I in ("${root}") do @echo %~sI`],
        { encoding: 'utf8', windowsHide: true },
      ).trim();
      if (!short.includes('~')) {
        ctx.skip();
        return;
      }
      await expect(validateProfile(short)).resolves.toBeUndefined();
      await expect(
        validateProfile(root.toUpperCase()),
      ).resolves.toBeUndefined();
      await expect(validateProfile(join(root, '.'))).resolves.toBeUndefined();
      const warning = {
        runId: 'generated-alias-warning',
        kind: 'http-429' as const,
        day: '2026-10-25',
        zone: 'UTC',
        createdAt: '2026-10-25T12:00:00.000Z',
      };
      await writeXWarningFile(short, warning);
      expect(await readXWarningFile(root)).toEqual(warning);
      await expect(
        requireXWarningFileClear(short, '2026-10-26T12:00:00.000Z', 'UTC'),
      ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
      await expect(validateProfile(short, 'instagram')).rejects.toMatchObject({
        code: 'PROFILE_INVALID',
      });
      expect(inDefaultProfile(join(root, 'Default'), [root])).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test('D11 canonicalization rejects direct and ancestor links and a warning marker link', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-d11-links-'));
  const actual = join(root, 'actual'),
    link = join(root, 'link');
  try {
    await mkdir(actual);
    await createProfile(join(actual, 'profile'));
    await symlink(
      actual,
      link,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(validateProfile(join(link, 'profile'))).rejects.toMatchObject({
      code: 'PROFILE_INVALID',
    });
    await expect(readXWarningFile(join(link, 'profile'))).rejects.toMatchObject(
      { code: 'PROFILE_INVALID' },
    );
    const target = join(root, 'planted');
    await mkdir(target);
    await symlink(
      target,
      join(actual, 'profile', X_WARNING_FILE),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      readXWarningFile(join(actual, 'profile')),
    ).rejects.toMatchObject({ code: 'PROFILE_INVALID' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('D11 ordinary case and dotted spellings preserve identity and a wrong platform refuses', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-d11-spelling-'));
  try {
    await createProfile(root);
    await expect(validateProfile(join(root, '.'))).resolves.toBeUndefined();
    if (process.platform === 'win32')
      await expect(
        validateProfile(root.toUpperCase()),
      ).resolves.toBeUndefined();
    await expect(validateProfile(root, 'instagram')).rejects.toMatchObject({
      code: 'PROFILE_INVALID',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
