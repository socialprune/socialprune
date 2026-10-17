import { expect, test } from 'vitest';
import { assertProductionModules } from '../packaging/boundary.ts';

test('production bundle check rejects the generated engine and every fake owner', () => {
  assertProductionModules([
    'apps/cli/src/engine/index.ts',
    'apps/desktop/src/main/index.ts',
  ]);
  for (const id of [
    'apps/cli/e2e/engine-test-entry.ts',
    'apps/cli/e2e/fake-x/server.ts',
    'apps/cli/e2e/fake-instagram/server.ts',
  ])
    expect(() => assertProductionModules([id])).toThrow(
      'PRODUCTION_TEST_IMPORT',
    );
});
