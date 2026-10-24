import { expect, test } from 'vitest';
import { createWorkspace } from '@socialprune/core/workspace/store';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '@socialprune/core/workspace/memory-store';
import { EngineReviewDispatch } from '../engine/review-dispatch.ts';

test('desktop engine review dispatch carries removal through the actual review runtime without changing history', async () => {
  const value = createWorkspace();
  value.settings.categories = [
    'earlier-generated',
    ...value.settings.categories,
  ];
  const store = createMemoryStore(new MemoryStoreBacking(value));
  const dispatch = await EngineReviewDispatch.fromStore(store);
  try {
    const raw = {
      type: 'setCriteria',
      requestId: 'generated-remove',
      criteria: value.settings.criteria!,
      removeCategories: ['earlier-generated'],
    };
    const replies = await dispatch.run(raw);
    expect(replies).toMatchObject([{ type: 'settingsChanged', revision: 0 }]);
    const reply = replies[0];
    if (reply?.type !== 'settingsChanged')
      throw new Error('Expected generated settings reply');
    expect(reply.categories).not.toContain('earlier-generated');
    expect(() =>
      dispatch.run({ ...raw, removeCategories: ['duplicate', 'duplicate'] }),
    ).toThrow();
  } finally {
    await dispatch.close();
    await store.close();
  }
});
