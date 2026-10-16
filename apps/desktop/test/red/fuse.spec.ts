import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import { test } from '@playwright/test';
import { executable } from '../../build/paths.ts';
import { assertFuses } from '../../build/fuses.ts';

test('RED planted fuse must fail exact readback', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'socialprune-red-fuse-'));
  try {
    const altered = join(temp, 'SocialPrune.exe');
    await cp(executable('test'), altered);
    await flipFuses(altered, {
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: true,
    });
    await assertFuses(altered, true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
