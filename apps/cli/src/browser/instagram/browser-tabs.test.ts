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
    | 'missing-owned'
    | 'lagging' = 'normal',
) {
  // In lagging mode a closed target stays listed for two more lists and has
  // no window, as a headed browser shows while it tears the tab down.
  const closing = new Map<string, number>();
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
        if (typeof args?.targetId === 'string' && closing.has(args.targetId))
          return Promise.reject(new Error('Generated window gone'));
        return Promise.resolve({
          windowId:
            typeof args?.targetId === 'string'
              ? targets.get(args.targetId)!.window
              : 1,
        });
      }
      if (method === 'Target.getTargets') {
        for (const [id, left] of closing)
          if (left === 0) {
            closing.delete(id);
            targets.delete(id);
          } else closing.set(id, left - 1);
        return Promise.resolve({
          targetInfos: [...targets]
            .filter(([id]) => mode !== 'missing-owned' || id !== 'own-page')
            .map(([targetId, value]) => ({
              targetId,
              ...value,
            })),
        });
      }
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
        if (mode === 'lagging') closing.set(id, 2);
        else if (mode !== 'unclosed') targets.delete(id);
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
/**
 * Real Edge shape (run de31b06a): every tab holds one page, and an attach to
 * a tab target is refused. Closing a page also removes its tab.
 */
function edgeFixture(
  mode: 'restored' | 'late' | 'pageless' | 'lingering' = 'restored',
) {
  const tabOf = new Map([
    ['own-page', 'own-tab'],
    ['restored-page-1', 'restored-tab-1'],
    ['restored-page-2', 'restored-tab-2'],
    ['other-window-page', 'other-window-tab'],
  ]);
  const targets = new Map<
    string,
    { type: string; browserContextId: string; window: number }
  >();
  for (const [page, tab] of tabOf) {
    const window = page.startsWith('other-window') ? 2 : 1;
    if (mode === 'late' && page.startsWith('restored') && page.endsWith('2'))
      continue;
    targets.set(page, { type: 'page', browserContextId: 'run', window });
    targets.set(tab, { type: 'tab', browserContextId: 'run', window });
  }
  if (mode === 'pageless')
    targets.set('sleeping-tab', {
      type: 'tab',
      browserContextId: 'run',
      window: 1,
    });
  targets.set('other-context-page', {
    type: 'page',
    browserContextId: 'foreign',
    window: 1,
  });
  // In lingering mode a closed page's tab stays listed for two lists.
  const lingering = new Map<string, number>();
  const closed: string[] = [],
    attached: string[] = [];
  const client = Object.assign(new EventEmitter(), {
    detach: vi.fn().mockResolvedValue(undefined),
    send: (method: string, args?: Record<string, unknown>) => {
      const target = typeof args?.targetId === 'string' ? args.targetId : '';
      if (method === 'Target.getTargetInfo')
        return Promise.resolve({
          targetInfo: {
            targetId: 'own-page',
            type: 'page',
            browserContextId: 'run',
          },
        });
      if (method === 'Browser.getWindowForTarget')
        return Promise.resolve({
          windowId: target ? targets.get(target)!.window : 1,
        });
      if (method === 'Target.getTargets') {
        for (const [id, left] of lingering)
          if (left === 0) {
            lingering.delete(id);
            targets.delete(id);
          } else lingering.set(id, left - 1);
        return Promise.resolve({
          targetInfos: [...targets].map(([targetId, value]) => ({
            targetId,
            ...value,
          })),
        });
      }
      if (method === 'Target.attachToTarget') {
        attached.push(target);
        return Promise.reject(new Error('Generated attach refused'));
      }
      if (method === 'Target.closeTarget') {
        closed.push(target);
        targets.delete(target);
        const tab = tabOf.get(target);
        if (tab && mode === 'lingering') lingering.set(tab, 2);
        else if (tab) targets.delete(tab);
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
    attached,
    targets,
  };
}
test.each(['restored', 'lingering'] as const)(
  'TABS-EDGE %s: restored tabs close and count without any attach to a tab target',
  async (mode) => {
    const f = edgeFixture(mode);
    expect(await auditBrowserTabs(f.context, new Set([f.page]), true)).toEqual({
      closed: { page: 2, tab: 0 },
      nonOwned: 0,
      tabs: 1,
    });
    expect(f.closed.sort()).toEqual(['restored-page-1', 'restored-page-2']);
    expect(f.attached).toEqual([]);
    expect(f.targets.has('other-window-page')).toBe(true);
    expect(f.targets.has('other-context-page')).toBe(true);
    // A step boundary reads the same state without closing or attaching.
    expect(await auditBrowserTabs(f.context, new Set([f.page]), false)).toEqual(
      { closed: { page: 0, tab: 0 }, nonOwned: 0, tabs: 1 },
    );
    expect(f.attached).toEqual([]);
  },
);
test('TABS-EDGE a later foreign tab at a step boundary counts as non-owned without a close or attach', async () => {
  const f = edgeFixture('late');
  expect(await auditBrowserTabs(f.context, new Set([f.page]), false)).toEqual({
    closed: { page: 0, tab: 0 },
    nonOwned: 1,
    tabs: 2,
  });
  expect(f.closed).toEqual([]);
  expect(f.attached).toEqual([]);
});
test('TABS-EDGE a tab without a page fails closed where the attach is refused', async () => {
  const f = edgeFixture('pageless');
  await expect(
    auditBrowserTabs(f.context, new Set([f.page]), true, { settleMs: 300 }),
  ).rejects.toMatchObject({ token: 'tab-inventory', stage: 'children-attach' });
  // The restored pages are still closed first; the sleeping tab stays open.
  expect(f.closed.sort()).toEqual(['restored-page-1', 'restored-page-2']);
  expect(f.targets.has('sleeping-tab')).toBe(true);
  // At a step boundary the same tab is counted and stops the run.
  expect(
    await auditBrowserTabs(f.context, new Set([f.page]), false),
  ).toMatchObject({ nonOwned: 1, tabs: 2 });
});
test('browser audit closes unattached tab wrappers and uncovered pages but not owned or foreign targets', async () => {
  const f = fixture();
  expect(
    await auditBrowserTabs(f.context, new Set([f.page]), true, {
      settleMs: 300,
    }),
  ).toEqual({
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
      await auditBrowserTabs(f.context, new Set([f.page]), mode !== 'late', {
        settleMs: 300,
      }),
    ).toMatchObject({ nonOwned: 1, tabs: 2 });
    if (mode === 'unclosed')
      expect(
        await auditBrowserTabs(f.context, new Set([f.page]), true, {
          settleMs: 300,
        }),
      ).toMatchObject({ closed: { page: 0, tab: 0 } });
    if (mode === 'late') expect(f.closed).toHaveLength(0);
  },
);
test('browser inventory waits for its own closes to leave the list before the strict re-inspection', async () => {
  const f = fixture('lagging');
  expect(
    await auditBrowserTabs(f.context, new Set([f.page]), true, {
      settleMs: 500,
    }),
  ).toEqual({
    closed: { page: 1, tab: 1 },
    nonOwned: 0,
    tabs: 1,
  });
  expect(f.closed.sort()).toEqual(['sleeping-tab', 'unwrapped-page']);
});
test('browser inventory still fails closed when a closing target outlives the settle bound', async () => {
  const f = fixture('lagging');
  await expect(
    auditBrowserTabs(f.context, new Set([f.page]), true, { settleMs: 0 }),
  ).rejects.toMatchObject({ token: 'tab-inventory', stage: 'window' });
});
test('browser inventory fails closed on a same-context target with unobservable window identity', async () => {
  const f = fixture('unobservable');
  await expect(
    auditBrowserTabs(f.context, new Set([f.page]), true),
  ).rejects.toMatchObject({ token: 'tab-inventory', stage: 'window' });
  expect(f.closed).toHaveLength(0);
});
test('browser inventory cannot report zero non-owned tabs when an owned target is absent', async () => {
  const f = fixture('missing-owned');
  await expect(
    auditBrowserTabs(f.context, new Set([f.page]), false),
  ).rejects.toMatchObject({ token: 'tab-inventory', stage: 'owned-missing' });
});
