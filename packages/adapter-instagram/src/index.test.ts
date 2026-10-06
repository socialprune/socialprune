import { expect, test } from 'vitest';
import { PLATFORM } from './index.ts';

test('identifies the Instagram adapter scaffold', () => {
  expect(PLATFORM).toBe('instagram');
});
