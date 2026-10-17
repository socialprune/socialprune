import { assertFuses } from './fuses.ts';
import { executable } from './paths.ts';

for (const variant of ['release', 'test'] as const)
  console.log(
    JSON.stringify({
      variant,
      wire: await assertFuses(executable(variant), variant === 'test'),
    }),
  );
