import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright-core';
import { auditBrowserTabs } from './browser-tabs.ts';

function fixture(
  mode:
    | 'normal'
    | 'unclosed'
    | 'late'
    | 'unobservable'
    | 'missing-owned' = 'normal',
) {
  const targets = new Map([
    ['own-page', { type: 'page', browserContextId: 'run', window: 1 }],
    ['own-tab', { type: 'tab', browserContextId: 'run', window: 1 }],
    ['sleeping-tab', { type: 'tab', browserContextId: 'run', window: 1 }],
    ['other-window', { type: 'tab', browserContextId: 'run', window: 2 }],
    ['other-context', { type: 'page', browserContextId: 'foreign', window: 1 }],
    ['unwrapped-page', { type: 'page', browserContextId: 'run', window: 1 }],
  ]);
  const closed: string[] = [],
    detached: string[] = [];
  const client = Object.assign(new EventEmitter(), {
    detach: vi.fn().mockResolvedValue(undefined),
    send: (method: string, args?: Record<string, unknown>) => {
      if (method === 'Target.getTargetInfo')
        return Promise.resolve({
          targetInfo: {
            targetId: 'own-page',
            type: 'page',
            browserContextId: 'run',
          },
        });
      if (method === 'Browser.getWindowForTarget') {
        if (mode === 'unobservable' && args?.targetId === 'sleeping-tab')
          return Promise.reject(new Error('Generated no window'));
        return Promise.resolve({
          windowId:
            typeof args?.targetId === 'string'
              ? targets.get(args.targetId)!.window
              : 1,
        });
      }
      if (method === 'Target.getTargets')
        return Promise.resolve({
          targetInfos: [...targets]
            .filter(([id]) => mode !== 'missing-owned' || id !== 'own-page')
            .map(([targetId, value]) => ({
              targetId,
              ...value,
            })),
        });
      if (method === 'Target.attachToTarget')
        return Promise.resolve({ sessionId: args?.targetId });
      if (method === 'Target.sendMessageToTarget') {
        if (args?.sessionId === 'own-tab')
          client.emit('Target.receivedMessageFromTarget', {
            sessionId: 'own-tab',
            message: JSON.stringify({
              method: 'Target.attachedToTarget',
              params: { targetInfo: { targetId: 'own-page', type: 'page' } },
            }),
          });
        client.emit('Target.receivedMessageFromTarget', {
          sessionId: args?.sessionId,
          message: JSON.stringify({ id: 1, result: {} }),
        });
        return Promise.resolve();
      }
      if (method === 'Target.detachFromTarget') {
        detached.push(
          typeof args?.sessionId === 'string' ? args.sessionId : 'invalid',
        );
        return Promise.resolve();
      }
      if (method === 'Target.closeTarget') {
        const id =
          typeof args?.targetId === 'string' ? args.targetId : 'invalid';
        closed.push(id);
        if (mode !== 'unclosed') targets.delete(id);
        return Promise.resolve({ success: true });
      }
      throw new Error('Unexpected method');
    },
  });
  const page = { isClosed: () => false } as Page;
  return {
    context: {
      newCDPSession: () => Promise.resolve(client),
    } as unknown as BrowserContext,
    page,
    closed,
    detached,
    client,
  };
}
test('browser audit closes unattached tab wrappers and uncovered pages but not owned or foreign targets', async () => {
  const f = fixture();
  expect(await auditBrowserTabs(f.context, new Set([f.page]), true)).toEqual({
    closed: { page: 1, tab: 1 },
    nonOwned: 0,
    tabs: 1,
  });
  expect(f.closed.sort()).toEqual(['sleeping-tab', 'unwrapped-page']);
  expect(f.detached).not.toContain('other-window');
  expect(f.client.listenerCount('Target.receivedMessageFromTarget')).toBe(0);
});
test.each(['unclosed', 'late'] as const)(
  'browser audit reports %s non-owned state rather than trusting close or Playwright pages',
  async (mode) => {
    const f = fixture(mode);
    expect(
      await auditBrowserTabs(f.context, new Set([f.page]), mode !== 'late'),
    ).toMatchObject({ nonOwned: 2, tabs: 3 });
    if (mode === 'late') expect(f.closed).toHaveLength(0);
  },
);
test('browser inventory fails closed on a same-context target with unobservable window identity', async () => {
  const f = fixture('unobservable');
  await expect(
    auditBrowserTabs(f.context, new Set([f.page]), true),
  ).rejects.toMatchObject({ token: 'tab-inventory' });
  expect(f.closed).toHaveLength(0);
});
test('browser inventory cannot report zero non-owned tabs when an owned target is absent', async () => {
  const f = fixture('missing-owned');
  await expect(
    auditBrowserTabs(f.context, new Set([f.page]), false),
  ).rejects.toMatchObject({ token: 'tab-inventory' });
});
