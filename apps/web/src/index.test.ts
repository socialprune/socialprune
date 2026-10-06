import { expect, test } from 'vitest';
import { WEB_TITLE } from './index.ts';

test('names the web scaffold', () => {
  expect(WEB_TITLE).toBe('SocialPrune');
});
