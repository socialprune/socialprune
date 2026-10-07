import { expect, test } from 'vitest';
import { tabChange } from './tab-channel.ts';

test('malformed or another-workspace peer messages are ignored', () => {
  expect(
    tabChange(
      { workspaceId: 'active', revision: 'invented', itemIds: 'many' },
      'active',
    ),
  ).toBeNull();
  expect(
    tabChange({ workspaceId: 'other', revision: 1, itemIds: [] }, 'active'),
  ).toBeNull();
  expect(
    tabChange(
      { workspaceId: 'active', revision: 1, itemIds: ['x:invented'] },
      'active',
    ),
  ).toEqual({ workspaceId: 'active', revision: 1, itemIds: ['x:invented'] });
});
