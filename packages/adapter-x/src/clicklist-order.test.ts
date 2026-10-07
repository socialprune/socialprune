import { expect, test } from 'vitest';
import { xAdapter } from './index.ts';

test('X declares risk ordering for its click list', () => {
  expect(xAdapter.clickListOrder).toBe('risk');
});
