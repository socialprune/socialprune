import { expect, test } from 'vitest';
import { PLATFORM } from './index.ts';

test('identifies the X adapter scaffold', () => {
  expect(PLATFORM).toBe('x');
});
