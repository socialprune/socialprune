import { expect, test } from 'vitest';
import { CORE_VERSION } from './index.ts';

test('exports the scaffold version', () => {
  expect(CORE_VERSION).toBe('0.0.0');
});
