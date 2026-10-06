import { expect, test } from 'vitest';
import { helpText } from './index.ts';

test('help consumes the linked core package', () => {
  expect(helpText()).toContain('core 0.0.0');
  expect(helpText()).toContain('structure');
});
