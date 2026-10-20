import { test } from 'vitest';
import {
  collectLimitedProofMatrix,
  MATRIX_TIMEOUT_MS,
} from './limited-proof-matrix.ts';

test.skipIf(process.platform !== 'win32')(
  'diagnostic-only runner matrix records launch outcomes without asserting them or replacing any restricted proof',
  async () => {
    await collectLimitedProofMatrix();
  },
  MATRIX_TIMEOUT_MS + 30_000,
);
