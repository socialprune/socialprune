import { assertFuses } from './fuses.ts';
import { executable } from './paths.ts';
import { extractFile } from '@electron/asar';
import { join } from 'node:path';
import { dist } from './paths.ts';
import { assertReleaseEntry } from './release-entry-check.ts';

// This post-build check deliberately fails when the release ASAR is absent.
assertReleaseEntry(
  extractFile(join(dist, 'release/resources/app.asar'), 'main.mjs').toString(),
);
console.log(JSON.stringify({ proof: 'release-test-entry-excluded' }));

for (const variant of ['release', 'test'] as const)
  console.log(
    JSON.stringify({
      variant,
      wire: await assertFuses(executable(variant), variant === 'test'),
    }),
  );
