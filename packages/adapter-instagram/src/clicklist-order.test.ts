import { expect, test } from 'vitest';
import { instagramAdapter } from './index.ts';

test('Instagram declares day ordering for its click list', () => {
  expect(instagramAdapter.clickListOrder).toBe('day');
});
