import { expect, test } from 'vitest';
import { tokenMessage } from './messages.ts';
test('IG-18 desktop journal has a bilingual manual-result message rather than a stop or confirmation', () => {
  expect(tokenMessage('list-image-only')).toBe('desktop.token.list-image-only');
});
